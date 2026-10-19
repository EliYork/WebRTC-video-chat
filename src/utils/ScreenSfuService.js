import os from 'node:os';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createScreenSfuBudget } from './ScreenSfuBudget.js';

export const screenRouterCodecs = [
    { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
    { kind: 'video', mimeType: 'video/VP8', clockRate: 90000 },
    { kind: 'video', mimeType: 'video/AV1', clockRate: 90000, parameters: { profile: 0 } },
    {
        kind: 'video',
        mimeType: 'video/H264',
        clockRate: 90000,
        parameters: {
            'packetization-mode': 1,
            'profile-level-id': '42e01f',
            'level-asymmetry-allowed': 1,
        },
    },
];
const codecs = screenRouterCodecs;
const actions = new Set([
    'capabilities',
    'transport',
    'connect',
    'produce',
    'publish',
    'list',
    'consume',
    'resume',
    'ready',
    'unsubscribe',
    'stop',
    'reset',
]);
const fail = (reason) => Object.assign(new Error(reason), { reason });
const safeNumber = (value) => Number.isFinite(value) && value >= 0 ? value : null;
export const summarizeScreenSfuStats = (reports, type) => {
    const video = reports.filter((report) => report.type === type && report.kind === 'video');
    const sum = (key) => video.length && video.every((row) => safeNumber(row[key]) !== null)
        ? video.reduce((total, row) => total + row[key], 0) : null;
    return { 码率_bps: sum('bitrate'), 累计字节: sum('byteCount'), 累计包数: sum('packetCount'),
        累计丢包: sum('packetsLost') };
};
const boundedConsumerStats = (consumer) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve([]), 1000);
    Promise.resolve().then(() => consumer.getStats()).then(resolve, () => resolve([])).finally(() => clearTimeout(timer));
});

// Observe the default uplink's real transmitted bytes, including other sites.
// First sample, unsupported hosts and counter resets remain unknown.
export const createHostEgressSampler = (read = readFile, now = Date.now) => {
    let previous;
    return async () => {
        try {
            const routes = (await read('/proc/net/route', 'utf8')).trim().split('\n').slice(1)
                .map((line) => line.trim().split(/\s+/))
                .filter((row) => row[1] === '00000000' && (parseInt(row[3], 16) & 1))
                .sort((a, b) => Number(a[6]) - Number(b[6]));
            const iface = routes[0]?.[0];
            if (!iface || !/^[\w.-]+$/.test(iface)) throw new Error('no uplink');
            const bytes = Number((await read(`/sys/class/net/${iface}/statistics/tx_bytes`, 'utf8')).trim());
            const at = now();
            const old = previous;
            previous = Number.isSafeInteger(bytes) && bytes >= 0 ? { iface, bytes, at } : undefined;
            return previous && old?.iface === iface && at > old.at && bytes >= old.bytes
                ? (bytes - old.bytes) * 8000 / (at - old.at) : null;
        } catch {
            previous = undefined;
            return null;
        }
    };
};

// Linux keeps reclaimable cache in used memory. MemAvailable reflects what
// applications can allocate without swapping; MemFree would reject this 1GB host.
const availableMemory = async () => {
    if (process.platform === 'linux') {
        try {
            const info = await readFile('/proc/meminfo', 'utf8');
            const match = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(info);
            if (match) return Number(match[1]) * 1024;
        } catch {
            // Keep the conservative platform fallback if procfs is unavailable.
        }
    }
    return os.freemem();
};

export const createScreenSfuService = ({
    config,
    getVoiceOwner,
    logger,
    createWorker,
    resourceSample,
    egressSample = createHostEgressSampler(),
    now = Date.now,
} = {}) => {
    const budget = createScreenSfuBudget(config);
    const rooms = new Map();
    const clients = new Map();
    const publications = new Map();
    const queues = new Map();
    let worker;
    let webRtcServer;
    let startup;
    let stopped = false;
    let unhealthy = false;
    let overloadSamples = 0;
    let healthTimer;
    let trafficTimer;
    let viewerSequence = 0;
    let lastCpu;
    let lastNodeCpu = process.cpuUsage();
    let lastSampleTime = Date.now();
    let health = { available: true };
    let trafficSampling = false;
    let egress = { sampledAt: 0, sfuBps: null, hostBps: null, rtxBps: null, probationBps: null };
    let egressBlocked = false;
    let highSamples = 0;
    let lowSamples = 0;
    let lastReleaseAt = -Infinity;
    const transportTimestamps = new WeakMap();
    const demandFor = (publication) => publication.demandAt !== undefined && now() - publication.demandAt <= 6000
        ? publication.demand : config.initialViewerBitrate + config.audioBitrate;

    const validClient = (client) => {
        const owner = getVoiceOwner(client.socket);
        return (
            !client.socket.disconnected &&
            clients.get(client.socket.id) === client &&
            owner?.peerId === client.peerId &&
            owner?.roomId === client.roomId &&
            owner?.voiceSessionGeneration === client.generation
        );
    };
    const emit = (client, event, data = {}) => {
        if (validClient(client))
            client.socket.emit(event, {
                ...data,
                roomId: client.roomId,
                voiceSessionGeneration: client.generation,
            });
    };
    const notifyRoutes = (publication) =>
        emit(publication.client, 'sfu:routes', {
            publicationId: publication.id,
            uplinkBitrate:
                demandFor(publication),
            videoMaxBitrate:
                publication.videoMaxBitrate || config.initialViewerBitrate,
            peerIds: [...publication.subscriptions.values()]
                .filter((subscription) => subscription.ready)
                .map((subscription) => subscription.client.peerId),
        });
    const dropSubscription = (publication, viewerId, reason = 'closed') => {
        const subscription = publication.subscriptions.get(viewerId);
        if (!subscription) return;
        publication.subscriptions.delete(viewerId);
        budget.release(`${publication.id}:${viewerId}`);
        clearTimeout(subscription.expiry);
        subscription.consumers.forEach((consumer) => consumer.close());
        emit(subscription.client, 'sfu:closed', {
            publicationId: publication.id,
            peerId: publication.client.peerId,
            reason,
        });
        notifyRoutes(publication);
    };
    const stopPublication = (client) => {
        const publication = client.publication;
        if (!publication) return;
        client.publication = undefined;
        clearTimeout(publication.expiry);
        publications.delete(publication.id);
        [...publication.subscriptions.keys()].forEach((id) =>
            dropSubscription(publication, id, 'publisher-stopped')
        );
        publication.producers.forEach((producer) => producer.close());
        emit(client, 'sfu:routes', {
            publicationId: publication.id,
            peerIds: [],
        });
    };
    const stopScreen = (socket) => {
        const client = clients.get(socket.id);
        if (!client) return;
        stopPublication(client);
        for (const [id, transport] of client.transports) {
            if (transport.appData.direction !== 'send') continue;
            client.transports.delete(id);
            transport.close();
        }
    };
    const cleanupSocket = (socket, reason = 'session-left') => {
        const client = clients.get(socket.id);
        if (!client) return;
        stopPublication(client);
        publications.forEach((publication) =>
            dropSubscription(publication, socket.id, reason)
        );
        client.transports.forEach((transport) => transport.close());
        clients.delete(socket.id);
        const room = rooms.get(client.roomId);
        if (
            room &&
            ![...clients.values()].some(
                (other) => other.roomId === client.roomId
            )
        ) {
            room.close();
            rooms.delete(client.roomId);
        }
    };
    const fallbackAll = (reason) => {
        [...clients.values()].forEach((client) => {
            emit(client, 'sfu:fallback', { reason });
            cleanupSocket(client.socket, reason);
        });
    };
    const sampleHealth = async () => {
        try {
            if (!worker || worker.closed) return;
            const usage = await worker.getResourceUsage();
            const now = Date.now();
            const cpu = usage.ru_utime + usage.ru_stime;
            const nodeCpu = process.cpuUsage();
            const cpuPercent =
                lastCpu === undefined
                    ? 0
                    : ((cpu -
                          lastCpu +
                          (nodeCpu.user -
                              lastNodeCpu.user +
                              nodeCpu.system -
                              lastNodeCpu.system) /
                              1000) *
                          100) /
                      Math.max(1, now - lastSampleTime);
            // ru_maxrss is a conservative peak, in KiB on Linux (bytes on macOS).
            const workerPeak =
                usage.ru_maxrss * (process.platform === 'darwin' ? 1 : 1024);
            health = resourceSample
                ? await resourceSample()
                : {
                      memoryBytes: process.memoryUsage().rss + workerPeak,
                      freeBytes: await availableMemory(),
                      cpuPercent,
                  };
            lastCpu = cpu;
            lastNodeCpu = nodeCpu;
            lastSampleTime = now;
            unhealthy =
                health.memoryBytes > config.maxMemoryBytes ||
                health.freeBytes < config.minFreeBytes ||
                health.cpuPercent > config.maxCpuPercent;
            overloadSamples = unhealthy ? overloadSamples + 1 : 0;
            if (overloadSamples >= 3) {
                logger?.warn?.(
                    '[sfu] resource limit reached; returning screen shares to P2P'
                );
                fallbackAll('server-resource-limit');
                overloadSamples = 0;
            }
        } catch (error) {
            logger?.warn?.(`[sfu] resource sampling failed: ${error.message}`);
        }
    };
    const sampleTraffic = async () => {
        if (trafficSampling || stopped) return;
        trafficSampling = true;
        try {
            const currentPublications = [...publications.values()].filter(
                (publication) => publication.published
            );
            await Promise.all(
                currentPublications.map(async (publication) => {
                    const reports = await Promise.all(
                        [...publication.producers.values()].map((producer) =>
                            boundedConsumerStats(producer)
                        )
                    );
                    if (publications.get(publication.id) !== publication)
                        return;
                    const rows = reports.flat().filter((report) => report.type === 'inbound-rtp');
                    const ready = [...publication.subscriptions.values()].some((subscription) => subscription.ready);
                    const valid = reports.length > 0 && reports.every((report) => report.some((row) =>
                        row.type === 'inbound-rtp' && safeNumber(row.bitrate) !== null)) &&
                        rows.every((row) => safeNumber(row.bitrate) !== null);
                    if (valid && ready) {
                        const actual = rows.reduce((sum, row) => sum + row.bitrate, 0);
                        // Only 5% within the media budget; the separate 4Mbps
                        // reserve covers host/protocol headroom. 15Mbps + audio
                        // can fit one viewer without clamping excess demand.
                        publication.demand = Math.max(config.audioBitrate, Math.ceil(actual * 1.05));
                        publication.demandAt = now();
                    } else {
                        publication.demand = undefined;
                        publication.demandAt = undefined;
                    }
                    const videoBytes = reports.flat()
                        .filter((report) => report.type === 'inbound-rtp' && report.kind === 'video')
                        .reduce((sum, report) => sum + (report.byteCount || 0), 0);
                    const ingress = summarizeScreenSfuStats(reports.flat(), 'inbound-rtp');
                    const sampledAt = now();
                    emit(publication.client, 'sfu:health', {
                        publicationId: publication.id, videoBytes,
                        serverHealth: { 采样时间_ms: sampledAt, 入站: ingress },
                    });
                    await Promise.all([...publication.subscriptions.values()].map(async (subscription) => {
                        const outgoing = await Promise.all([...subscription.consumers.values()].map(boundedConsumerStats));
                        if (publications.get(publication.id) !== publication ||
                            publication.subscriptions.get(subscription.client.socket.id) !== subscription) return;
                        emit(subscription.client, 'sfu:health', {
                            publicationId: publication.id, videoBytes,
                            serverHealth: { 采样时间_ms: sampledAt, 入站: ingress,
                                出站: summarizeScreenSfuStats(outgoing.flat(), 'outbound-rtp') },
                        });
                    }));
                    if (publications.get(publication.id) !== publication) return;
                    // Keep the original quality ceiling for active viewing.
                    // Admission and P2P failover handle downstream congestion;
                    // a weak receiver must not lower the shared source bitrate.
                    if (!ready) {
                        // Keep enough video for a pending viewer to decode, but
                        // don't let an unused SFU uplink starve P2P fallback.
                        publication.videoMaxBitrate = publication.subscriptions.size
                            ? config.initialViewerBitrate : 500000;
                    } else publication.videoMaxBitrate = config.videoBitrate;
                })
            );
            const entries = [...publications.values()]
                .flatMap((publication) =>
                    [...publication.subscriptions].map(
                        ([viewerId, subscription]) => ({
                            key: `${publication.id}:${viewerId}`,
                            amount:
                                demandFor(publication),
                            sequence: subscription.sequence,
                            publication,
                            viewerId,
                        })
                    )
                )
                .sort((a, b) => a.sequence - b.sequence);
            budget.refresh(entries);
            const transports = [...new Set([...clients.values()].flatMap((client) =>
                [...client.transports.values()].filter((transport) => !transport.closed && transport.appData.direction === 'recv')))];
            const [outgoing, hostBps] = await Promise.all([
                Promise.all(transports.map(async (transport) => {
                    const rows = await boundedConsumerStats(transport);
                    if (transport.closed) return null;
                    const row = rows.find((item) => item.type === 'webrtc-transport');
                    const previous = transportTimestamps.get(transport);
                    if (!row || safeNumber(row.sendBitrate) === null || !Number.isFinite(row.timestamp) ||
                        (previous !== undefined && row.timestamp <= previous)) return null;
                    transportTimestamps.set(transport, row.timestamp);
                    return row;
                })),
                Promise.resolve().then(egressSample).catch(() => null),
            ]);
            if (stopped) return;
            const known = outgoing.every(Boolean);
            const total = (key) => known && outgoing.every((row) => safeNumber(row[key]) !== null)
                ? outgoing.reduce((sum, row) => sum + row[key], 0) : null;
            egress = { sampledAt: now(), sfuBps: total('sendBitrate'), hostBps: safeNumber(hostBps),
                rtxBps: total('rtxSendBitrate'), probationBps: total('probationSendBitrate') };
            const high = (egress.sfuBps !== null && egress.sfuBps > config.payloadBudget) ||
                (egress.hostBps !== null && egress.hostBps > config.payloadBudget);
            const low = egress.sfuBps !== null && egress.sfuBps < config.payloadBudget * .9 &&
                (egress.hostBps === null || egress.hostBps < config.payloadBudget * .9);
            highSamples = high ? highSamples + 1 : 0;
            lowSamples = low ? lowSamples + 1 : 0;
            if (high && !egressBlocked) {
                egressBlocked = true;
                logger?.warn?.(`[sfu] egress admission paused; sfu=${egress.sfuBps}bps host=${egress.hostBps}bps`);
            } else if (egressBlocked && lowSamples >= 3) {
                egressBlocked = false;
                logger?.info?.('[sfu] egress recovered; admission resumed');
            }
            // A transient burst never kicks a viewer. Persistent real egress
            // releases at most one newest subscription per 15 seconds.
            if (highSamples >= 3 && now() - lastReleaseAt >= 15000) {
                const latest = entries.filter((entry) => entry.publication.subscriptions.get(entry.viewerId)?.sequence === entry.sequence).at(-1);
                if (latest) {
                    lastReleaseAt = now();
                    highSamples = 0;
                    dropSubscription(latest.publication, latest.viewerId, 'server-bandwidth-priority');
                    logger?.warn?.('[sfu] sustained egress pressure; one viewer returned to P2P');
                }
            }
            currentPublications.forEach((publication) => {
                if (publications.get(publication.id) === publication)
                    notifyRoutes(publication);
            });
        } catch (error) {
            logger?.warn?.(`[sfu] bitrate sampling failed: ${error.message}`);
        } finally {
            trafficSampling = false;
        }
    };
    const start = () => {
        if (!config.enabled || stopped)
            return Promise.reject(fail('sfu-disabled'));
        if (startup) return startup;
        startup = (async () => {
            const factory =
                createWorker || (await import('mediasoup')).createWorker;
            worker = await factory({ logLevel: 'warn' });
            worker.on('died', () => {
                unhealthy = true;
                fallbackAll('worker-unavailable');
                logger?.warn?.(
                    '[sfu] worker exited; screen sharing continues through P2P'
                );
            });
            webRtcServer = await worker.createWebRtcServer({
                listenInfos: ['udp', 'tcp'].map((protocol) => ({
                    protocol,
                    ip: config.listenIp,
                    announcedAddress: config.announcedAddress,
                    port: config.port,
                })),
            });
            healthTimer = setInterval(() => void sampleHealth(), 5000);
            healthTimer.unref?.();
            trafficTimer = setInterval(() => void sampleTraffic(), 2000);
            trafficTimer.unref?.();
            await sampleHealth();
            await sampleTraffic();
            logger?.info?.(
                `[sfu] ready on UDP/TCP ${config.port}; video=${config.videoBitrate}bps total=${config.payloadBudget}bps`
            );
        })().catch((error) => {
            worker?.close();
            logger?.warn?.(`[sfu] unavailable; using P2P: ${error.message}`);
            throw fail('sfu-unavailable');
        });
        return startup;
    };
    const assertCurrent = (client) => {
        if (!validClient(client)) throw fail('stale-voice-session');
    };
    const getClient = async (socket, owner) => {
        let client = clients.get(socket.id);
        if (
            client &&
            (client.generation !== owner.voiceSessionGeneration ||
                client.peerId !== owner.peerId ||
                client.roomId !== owner.roomId)
        ) {
            cleanupSocket(socket);
            client = undefined;
        }
        if (client) return client;
        if (unhealthy || clients.size >= config.maxClients)
            throw fail('server-resource-limit');
        await start();
        if (unhealthy) throw fail('server-resource-limit');
        const current = getVoiceOwner(socket);
        if (
            socket.disconnected ||
            current?.voiceSessionGeneration !== owner.voiceSessionGeneration ||
            current?.peerId !== owner.peerId ||
            current?.roomId !== owner.roomId
        )
            throw fail('stale-voice-session');
        let router = rooms.get(owner.roomId);
        if (!router) {
            // Requests are serialized globally below, including router creation.
            router = await worker.createRouter({ mediaCodecs: codecs });
            rooms.set(owner.roomId, router);
        }
        client = {
            socket,
            peerId: owner.peerId,
            roomId: owner.roomId,
            generation: owner.voiceSessionGeneration,
            router,
            transports: new Map(),
        };
        clients.set(socket.id, client);
        try {
            assertCurrent(client);
        } catch (error) {
            cleanupSocket(socket);
            throw error;
        }
        return client;
    };
    const ownedTransport = (client, id, direction) => {
        const transport = client.transports.get(id);
        if (
            !transport ||
            transport.closed ||
            (direction && transport.appData.direction !== direction)
        )
            throw fail('transport-owner-mismatch');
        return transport;
    };
    const getPublication = (client, id) => {
        const publication = publications.get(id);
        if (
            !publication ||
            !publication.published ||
            publication.client.roomId !== client.roomId ||
            publication.client === client ||
            !validClient(publication.client)
        )
            throw fail('publication-unavailable');
        return publication;
    };
    const perform = async (socket, payload) => {
        if (
            !payload ||
            typeof payload !== 'object' ||
            Array.isArray(payload) ||
            !actions.has(payload.action) ||
            JSON.stringify(payload).length > 65536
        )
            throw fail('invalid-sfu-request');
        const owner = getVoiceOwner(socket);
        if (
            !owner ||
            owner.voiceSessionGeneration !== payload.voiceSessionGeneration
        )
            throw fail('voice-owner-missing');
        if (payload.action === 'reset') {
            cleanupSocket(socket);
            return {};
        }
        const client = await getClient(socket, owner);
        assertCurrent(client);
        if (payload.action === 'capabilities')
            return {
                rtpCapabilities: client.router.rtpCapabilities,
                videoBitrate: config.videoBitrate,
                audioBitrate: config.audioBitrate,
                initialViewerBitrate: config.initialViewerBitrate,
            };
        if (payload.action === 'list')
            return {
                publications: [...publications.values()]
                    .filter(
                        (publication) =>
                            publication.published &&
                            validClient(publication.client) &&
                            publication.client.roomId === client.roomId &&
                            publication.client !== client
                    )
                    .map((publication) => ({
                        id: publication.id,
                        peerId: publication.client.peerId,
                    })),
            };
        if (payload.action === 'transport') {
            if (
                !['send', 'recv'].includes(payload.direction) ||
                client.transports.size >= 2 ||
                unhealthy
            )
                throw fail('transport-limit');
            const transport = await client.router.createWebRtcTransport({
                webRtcServer,
                enableUdp: true,
                enableTcp: true,
                preferUdp: true,
                initialAvailableOutgoingBitrate: config.videoBitrate,
                appData: { direction: payload.direction },
            });
            try {
                assertCurrent(client);
                await transport.setMaxIncomingBitrate(
                    config.videoBitrate + config.audioBitrate
                );
                await transport.setMaxOutgoingBitrate(config.payloadBudget);
                assertCurrent(client);
            } catch (error) {
                transport.close();
                throw error;
            }
            client.transports.set(transport.id, transport);
            transport.on('dtlsstatechange', (state) => {
                if (state !== 'failed' && state !== 'closed') return;
                const handleFailure = () => {
                    if (
                        client.transports.get(transport.id) !== transport ||
                        transport.closed ||
                        !validClient(client)
                    )
                        return;
                    emit(client, 'sfu:fallback', {
                        reason: 'transport-failed',
                    });
                    cleanupSocket(socket, 'transport-failed');
                };
                // UDP close can beat an intentional stop RPC over HTTP polling.
                if (state === 'closed')
                    setTimeout(handleFailure, 1000).unref?.();
                else handleFailure();
            });
            return {
                id: transport.id,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters,
            };
        }
        if (payload.action === 'connect') {
            await ownedTransport(client, payload.transportId).connect({
                dtlsParameters: payload.dtlsParameters,
            });
            assertCurrent(client);
            return {};
        }
        if (payload.action === 'produce') {
            if (unhealthy || socket.data.voiceScreenSharing !== true)
                throw fail('screen-not-sharing');
            const role = payload.role;
            if (
                !['screen-video', 'screen-audio'].includes(role) ||
                payload.kind !== (role === 'screen-video' ? 'video' : 'audio')
            )
                throw fail('invalid-media-role');
            const transport = ownedTransport(
                client,
                payload.transportId,
                'send'
            );
            let publication = client.publication;
            if (!publication) {
                if (
                    publications.size >= config.maxPublishers ||
                    (publications.size + 1) *
                        (config.videoBitrate + config.audioBitrate) >
                        config.ingressBudget
                )
                    throw fail('publisher-limit');
                publication = {
                    id: randomUUID(),
                    client,
                    published: false,
                    producers: new Map(),
                    subscriptions: new Map(),
                };
                client.publication = publication;
                publications.set(publication.id, publication);
                publication.expiry = setTimeout(
                    () => stopScreen(socket),
                    20000
                );
                publication.expiry.unref?.();
            }
            if (publication.published || publication.producers.has(role))
                throw fail('producer-limit');
            const producer = await transport.produce({
                kind: payload.kind,
                rtpParameters: payload.rtpParameters,
                appData: { role },
            });
            try {
                assertCurrent(client);
                if (
                    client.publication !== publication ||
                    publications.get(publication.id) !== publication ||
                    socket.data.voiceScreenSharing !== true
                )
                    throw fail('screen-not-sharing');
            } catch (error) {
                producer.close();
                throw error;
            }
            publication.producers.set(role, producer);
            producer.on('transportclose', () => stopPublication(client));
            return { id: producer.id, publicationId: publication.id };
        }
        if (payload.action === 'publish') {
            const publication = client.publication;
            if (!publication?.producers.has('screen-video'))
                throw fail('video-required');
            publication.published = true;
            clearTimeout(publication.expiry);
            clients.forEach((viewer) => {
                if (viewer !== client && viewer.roomId === client.roomId)
                    emit(viewer, 'sfu:publication', {
                        id: publication.id,
                        peerId: client.peerId,
                    });
            });
            return { publicationId: publication.id };
        }
        if (payload.action === 'stop') {
            stopScreen(socket);
            return {};
        }
        const publication = getPublication(client, payload.publicationId);
        if (payload.action === 'unsubscribe') {
            dropSubscription(publication, socket.id);
            return {};
        }
        let subscription = publication.subscriptions.get(socket.id);
        if (payload.action === 'consume') {
            if (unhealthy) throw fail('server-resource-limit');
            const transport = ownedTransport(
                client,
                payload.transportId,
                'recv'
            );
            if (!subscription) {
                if (egressBlocked || (budget.snapshot().viewers > 0 &&
                    (now() - egress.sampledAt > 6000 || egress.sfuBps === null))) throw fail('server-bandwidth-limit');
                if (
                    !budget.reserve(
                        `${publication.id}:${socket.id}`,
                        demandFor(publication)
                    )
                )
                    throw fail('server-bandwidth-limit');
                subscription = {
                    client,
                    consumers: new Map(),
                    ready: false,
                    sequence: ++viewerSequence,
                };
                publication.subscriptions.set(socket.id, subscription);
                subscription.expiry = setTimeout(
                    () =>
                        dropSubscription(
                            publication,
                            socket.id,
                            'subscription-timeout'
                        ),
                    20000
                );
                subscription.expiry.unref?.();
            }
            try {
                for (const [role, producer] of publication.producers) {
                    if (subscription.consumers.has(role)) continue;
                    if (
                        !client.router.canConsume({
                            producerId: producer.id,
                            rtpCapabilities: payload.rtpCapabilities,
                        })
                    )
                        throw fail('unsupported-codec');
                    // eslint-disable-next-line no-await-in-loop -- Close each native result immediately if its owner was lost.
                    const consumer = await transport.consume({
                        producerId: producer.id,
                        rtpCapabilities: payload.rtpCapabilities,
                        paused: true,
                    });
                    if (
                        !validClient(client) ||
                        publications.get(publication.id) !== publication ||
                        publication.subscriptions.get(socket.id) !==
                            subscription
                    ) {
                        consumer.close();
                        throw fail('stale-voice-session');
                    }
                    subscription.consumers.set(role, consumer);
                    consumer.on('producerclose', () =>
                        dropSubscription(
                            publication,
                            socket.id,
                            'producer-closed'
                        )
                    );
                    consumer.on('transportclose', () =>
                        dropSubscription(
                            publication,
                            socket.id,
                            'transport-closed'
                        )
                    );
                }
            } catch (error) {
                dropSubscription(
                    publication,
                    socket.id,
                    error.reason || 'consume-failed'
                );
                throw error;
            }
            return {
                peerId: publication.client.peerId,
                consumers: [...subscription.consumers].map(
                    ([role, consumer]) => ({
                        id: consumer.id,
                        producerId: consumer.producerId,
                        kind: consumer.kind,
                        rtpParameters: consumer.rtpParameters,
                        role,
                    })
                ),
            };
        }
        if (!subscription) throw fail('subscription-missing');
        if (payload.action === 'resume') {
            await Promise.all(
                [...subscription.consumers.values()].map((consumer) =>
                    consumer.resume()
                )
            );
            assertCurrent(client);
            return {};
        }
        if (payload.action === 'ready') {
            if (
                [...subscription.consumers.values()].some(
                    (consumer) => consumer.paused || consumer.closed
                )
            )
                throw fail('consumer-not-resumed');
            if (!subscription.ready) {
                // The first decoded frame may precede binding the visible player.
                // Ask once for a fresh keyframe at the playback handover.
                await Promise.all([...subscription.consumers.values()]
                    .filter((consumer) => consumer.kind === 'video')
                    .map((consumer) => consumer.requestKeyFrame?.()));
                assertCurrent(client);
            }
            subscription.ready = true;
            clearTimeout(subscription.expiry);
            notifyRoutes(publication);
            return {};
        }
        throw fail('invalid-sfu-request');
    };
    // Native operations are asynchronous. Serialize mutations to make the
    // global budget and room/router ownership atomic, including different sockets.
    let mutationQueue = Promise.resolve();
    const request = (socket, payload) => {
        const pending = queues.get(socket.id) || 0;
        if (pending >= 12)
            return Promise.resolve({ ok: false, reason: 'sfu-request-limit' });
        queues.set(socket.id, pending + 1);
        const operation = mutationQueue
            .catch(() => {})
            .then(() => perform(socket, payload));
        mutationQueue = operation;
        return operation
            .then(
                (result) => ({ ok: true, ...result }),
                (error) => ({
                    ok: false,
                    reason: error.reason || 'sfu-operation-failed',
                })
            )
            .finally(() => {
                const remaining = (queues.get(socket.id) || 1) - 1;
                if (remaining) queues.set(socket.id, remaining);
                else queues.delete(socket.id);
            });
    };
    return {
        request,
        cleanupSocket,
        stopScreen,
        start,
        sampleHealth,
        sampleTraffic,
        snapshot: () => ({
            enabled: config.enabled,
            ready: Boolean(webRtcServer && !worker?.closed),
            clients: clients.size,
            publishers: publications.size,
            ...budget.snapshot(),
            unhealthy,
            health,
            egress: { ...egress, admissionBlocked: egressBlocked },
        }),
        close: () => {
            stopped = true;
            clearInterval(healthTimer);
            clearInterval(trafficTimer);
            fallbackAll('server-stopped');
            budget.clear();
            worker?.close();
        },
    };
};
