/* eslint-disable no-await-in-loop -- Track negotiation and decoded-frame polling are deliberately sequential. */
(function exposeScreenSfuRuntime(global) {
    'use strict';
    const boundedStats = (consumer) => new Promise((resolve, reject) => {
        const timer = global.setTimeout(() => reject(new Error('sfu-stats-timeout')), 3000);
        Promise.resolve().then(() => consumer.getStats()).then(resolve, reject).finally(() => global.clearTimeout(timer));
    });
    const createRuntime = ({
        config = {},
        Device = global.ScreenSfuClient?.Device,
        MediaStreamCtor = global.MediaStream,
        onRoutes,
        onUplinkBudget,
        onRemoteStream,
        onRouteEvent,
        onReceiverFailure,
        onReceiverIssue,
        onCodecEvent,
        onState,
        onWarning,
        waitForMedia,
    } = {}) => {
        let socket;
        let session;
        let epoch = 0;
        let initPromise;
        let device;
        let sendTransport;
        let recvTransport;
        let desired;
        let publishing;
        let videoMaxBitrate = config.initialViewerBitrate || 5500000;
        let bitrateQueue = Promise.resolve();
        const applyVideoBitrate = () => {
            const token = epoch;
            bitrateQueue = bitrateQueue.catch(() => {}).then(async () => {
                if (!current(token)) return;
                for (const producer of producers) {
                    if (producer.kind !== 'video' || producer.closed || !producer.rtpSender?.setParameters) continue;
                    const parameters = producer.rtpSender.getParameters();
                    const maxBitrate = Math.min(config.videoBitrate || 15000000, videoMaxBitrate);
                    if (!parameters.encodings?.length || parameters.encodings.every((encoding) => encoding.maxBitrate === maxBitrate)) continue;
                    parameters.encodings.forEach((encoding) => { encoding.maxBitrate = maxBitrate; });
                    global.VoiceScreenSendPolicy?.observe(producer.rtpSender, parameters, {
                        path: 'SFU', startBitrateKbps: producer.appData?.startBitrateKbps, status: 'pending',
                    });
                    try {
                        await producer.rtpSender.setParameters(parameters);
                    } catch (error) {
                        global.VoiceScreenSendPolicy?.observe(producer.rtpSender, parameters, {
                            path: 'SFU', startBitrateKbps: producer.appData?.startBitrateKbps, status: 'failed',
                        });
                        throw error;
                    }
                    global.VoiceScreenSendPolicy?.observe(producer.rtpSender, parameters, {
                        path: 'SFU', startBitrateKbps: producer.appData?.startBitrateKbps,
                    });
                }
            }).catch((error) => onWarning?.('共享自适应码率未生效', error));
            return bitrateQueue;
        };
        let publicationId;
        let uplinkBitrate = (config.initialViewerBitrate || 5500000) + 128000;
        let publicationVersion = 0;
        let retryTimer;
        let discoveryTimer;
        let cooldownUntil = 0;
        const producers = new Set();
        const subscriptions = new Map();
        const receiverCooldowns = new Map();
        // Viewing preferences live only for this voice session, independently
        // for each sharer. They never change the publisher's capture settings.
        const receivePreferences = new Map();
        const p2pSamples = new Map();
        let pressureSamples = 0;
        let lastPressureAt = 0;
        const receiveMode = (peerId) => {
            if (session && peerId && !receivePreferences.has(peerId) && config.defaultReceiveMode === 'p2p-first') {
                receivePreferences.set(peerId, { mode: 'p2p-first', pending: false, error: '', startedAt: Date.now(), fallback: false });
            }
            return receivePreferences.get(peerId)?.mode || 'auto';
        };
        const automaticReceive = (peerId) => ['auto', 'p2p-first'].includes(receiveMode(peerId));
        const maySubscribe = (peerId) => receiveMode(peerId) !== 'p2p' &&
            (receiveMode(peerId) !== 'p2p-first' || receivePreferences.get(peerId)?.fallback);
        const receiverFailures = [];
        const receiverIssues = [];
        let receiverOrdinal = 0;
        const copyHealth = (value) => JSON.parse(JSON.stringify(value));
        const healthDelta = (row, previous, key) =>
            Number.isFinite(row?.[key]) && Number.isFinite(previous?.[key]) && row[key] >= previous[key]
                ? row[key] - previous[key] : null;
        const keepHealthSample = (entry, row) => {
            entry.healthSamples ||= [];
            entry.healthSamples.push(row);
            // Eight existing two-second checks cover about 14 seconds. Do not
            // poll any faster or retain raw RTP reports, IDs or candidates.
            while (entry.healthSamples.length > 8 ||
                row.采样时间_ms - entry.healthSamples[0].采样时间_ms > 15000) entry.healthSamples.shift();
        };
        const retainReceiverFailure = (entry, reason) => {
            const failure = { 序号: entry.healthOrdinal, 时间: new Date().toISOString(), reason,
                健康采样: copyHealth(entry.healthSamples || []) };
            receiverFailures.push(failure);
            if (receiverFailures.length > 3) receiverFailures.shift();
            // Persist before disposal, so later P2P statistics cannot erase
            // the evidence which triggered this receiver's release.
            try { onReceiverFailure?.(copyHealth(failure)); } catch { /* Diagnostics must not prevent recovery. */ }
        };
        const retainReceiverIssue = (entry, reason) => {
            if (entry.issueRecorded) return;
            entry.issueRecorded = true;
            const issue = { 序号: entry.healthOrdinal, 时间: new Date().toISOString(), reason,
                健康采样: copyHealth(entry.healthSamples || []) };
            receiverIssues.push(issue);
            if (receiverIssues.length > 3) receiverIssues.shift();
            try { onReceiverIssue?.(copyHealth(issue)); } catch { /* Keep media running if diagnostics fail. */ }
        };
        const statsConnections = new WeakMap();
        const statsConnection = (transport) => {
            if (!transport) return undefined;
            let connection = statsConnections.get(transport);
            if (!connection) {
                connection = { getStats: (track) => {
                    const consumer = track && [...subscriptions.values()]
                        .flatMap((entry) => entry.consumers).find((item) => item.track === track);
                    return consumer ? consumer.getStats() : transport.getStats();
                }, screenRoute: 'SFU',
                    getSenders: () => transport === sendTransport ? [...producers].map((producer) => producer.rtpSender).filter(Boolean) : [],
                };
                statsConnections.set(transport, connection);
            }
            return connection;
        };
        let routes = new Set();
        let routeBudget;
        let sendServerHealth;
        let state = 'p2p';
        const routeHistory = [];
        const recordRoute = (event, reason) => {
            const allowedReasons = ['server-bandwidth-limit', 'server-bandwidth-priority', 'server-resource-limit', 'publisher-stopped', 'producer-closed', 'transport-closed', 'subscription-timeout', 'sfu-video-not-arriving', 'sfu-timeout', 'unsupported-codec', 'closed', 'session-left', 'transport-failed', 'sfu-transport-failed', 'receiver-video-stalled', 'receiver-stats-timeout', 'receiver-ready-failed', 'receiver-unsubscribed', 'p2p-connection-failed', 'p2p-video-stalled', 'turn-relay', 'sender-encoder-pressure', 'sender-uplink-pressure'];
            routeHistory.push({ time: Date.now(), event, reason: reason ? allowedReasons.includes(reason) ? reason : 'other' : null, serverViewers: routes.size });
            onRouteEvent?.({ ...routeHistory[routeHistory.length - 1] });
            if (routeHistory.length > 12) routeHistory.shift();
        };
        const changeState = (next) => {
            if (state !== next) recordRoute(next);
            state = next;
            onState?.(next);
        };
        const current = (token) =>
            token === epoch && Boolean(session && socket?.connected);
        const request = (action, data = {}, token = epoch) =>
            new Promise((resolve, reject) => {
                if (!current(token))
                    return reject(new Error('stale-sfu-session'));
                const generation = session.voiceSessionGeneration;
                const timeout = global.setTimeout(
                    () => reject(new Error('sfu-timeout')),
                    8000
                );
                socket.emit(
                    'sfu:request',
                    { ...data, action, voiceSessionGeneration: generation },
                    (result) => {
                        global.clearTimeout(timeout);
                        if (!current(token))
                            return reject(new Error('stale-sfu-session'));
                        if (!result?.ok)
                            return reject(
                                new Error(
                                    result?.reason || 'sfu-request-failed'
                                )
                            );
                        resolve(result);
                    }
                );
            });
        const updateRoutes = (next) => {
            const nextRoutes = new Set(next);
            const nextBudget = Math.round(uplinkBitrate / 500000);
            const membersChanged = nextRoutes.size !== routes.size || [...nextRoutes].some((peerId) => !routes.has(peerId));
            if (
                nextBudget === routeBudget &&
                nextRoutes.size === routes.size &&
                [...nextRoutes].every((peerId) => routes.has(peerId))
            )
                return;
            routeBudget = nextBudget;
            routes = nextRoutes;
            if (membersChanged) {
                recordRoute('sender-routes-changed');
                onRoutes?.([...routes]);
            } else {
                // Reapply bitrate limits without rebuilding media snapshots or
                // replacing tracks when the viewer routes have not changed.
                onUplinkBudget?.();
            }
        };
        const dropSubscription = (id) => {
            const entry = subscriptions.get(id);
            if (!entry) return;
            if (entry.slowSamples > 0) retainReceiverIssue(entry, 'receiver-video-stalled');
            subscriptions.delete(id);
            global.clearTimeout(entry.healthTimer);
            entry.consumers.forEach((consumer) => consumer.close());
            if (entry.attached)
                onRemoteStream?.({
                    peerId: entry.peerId,
                    stream: null,
                    publicationId: id,
                });
        };
        const monitorSubscription = (publication, entry, token) => {
            const video = entry.consumers.find((consumer) => consumer.kind === 'video');
            const sample = async () => {
                if (!current(token) || subscriptions.get(publication.id) !== entry || !entry.attached) return;
                try {
                    const reports = await boundedStats(video);
                    if (!current(token) || subscriptions.get(publication.id) !== entry) return;
                    const report = [...reports.values()]
                        .filter((row) => row.type === 'inbound-rtp' && (row.kind === 'video' || row.mediaType === 'video'))
                        .sort((a, b) => (b.framesDecoded || 0) - (a.framesDecoded || 0))[0];
                    const now = Date.now();
                    const previous = entry.healthBaseline;
                    const baseline = { time: now, id: report?.id, frames: report?.framesDecoded, sourceBytes: entry.sourceBytes,
                        report, serverHealth: entry.serverHealth };
                    entry.healthBaseline = baseline;
                    entry.statsFailures = 0;
                    if (previous && baseline.sourceBytes > previous.sourceBytes) entry.sourceActiveAt = now;
                    // Hidden pages and a stationary source should never trigger
                    // failover merely because the browser stops rendering frames.
                    const active = !global.document?.hidden && previous && baseline.id === previous.id && Number.isFinite(baseline.frames) && Number.isFinite(previous.frames) &&
                        now - (entry.sourceActiveAt || 0) < 4500 && baseline.frames >= previous.frames;
                    const fps = active ? (baseline.frames - previous.frames) * 1000 / Math.max(1, now - previous.time) : undefined;
                    entry.slowSamples = fps !== undefined && fps < 5 ? (entry.slowSamples || 0) + 1 : 0;
                    const comparable = previous && report?.id === previous.id && report?.timestamp > previous.report?.timestamp;
                    const delta = (key) => comparable ? healthDelta(report, previous.report, key) : null;
                    const server = entry.serverHealth;
                    const serverElapsed = server?.采样时间_ms - previous?.serverHealth?.采样时间_ms;
                    const serverDelta = (direction) => serverElapsed > 0
                        ? healthDelta(server?.[direction], previous?.serverHealth?.[direction], '累计字节') : null;
                    const ingress = serverDelta('入站');
                    const egress = serverDelta('出站');
                    const received = delta('bytesReceived');
                    const decoded = delta('framesDecoded');
                    const measuredFps = decoded === null ? null : decoded * 1000 / (report.timestamp - previous.report.timestamp);
                    const serverAge = Number.isFinite(entry.serverHealthReceivedAt) ? now - entry.serverHealthReceivedAt : null;
                    let clue = measuredFps === null ? '证据不足' : '未观察到低解码帧率';
                    if (measuredFps !== null && measuredFps < 5) {
                        clue = '证据不足';
                        if (serverAge === null || serverAge > 4500) clue = '服务器统计缺失或过期';
                        else if (ingress > 0 && egress === 0) clue = '服务器入站增长但出站未增长';
                        else if (egress > 0 && received === 0) clue = '服务器出站增长但本端未收数据';
                        else if (received > 0 && decoded === 0) clue = '本端收到数据但未解码出帧';
                    }
                    keepHealthSample(entry, {
                        采样时间_ms: now, 采样间隔_ms: previous ? now - previous.time : null, 状态: '已采样',
                        页面后台: Boolean(global.document?.hidden), 判定有效: Boolean(active),
                        来源活跃: now - (entry.sourceActiveAt || 0) < 4500,
                        统计对象变化: Boolean(previous && report?.id !== previous.id),
                        接收统计间隔_ms: comparable ? report.timestamp - previous.report.timestamp : null,
                        完整接收帧数: Number.isFinite(report?.framesReceived) ? report.framesReceived : null,
                        解码帧数: Number.isFinite(report?.framesDecoded) ? report.framesDecoded : null,
                        区间解码帧率: measuredFps === null ? null : Math.round(measuredFps * 100) / 100,
                        判定解码帧率: fps === undefined ? null : Math.round(fps * 100) / 100,
                        连续低帧次数: entry.slowSamples, 服务器统计距接收_ms: serverAge,
                        服务器采样间隔_ms: serverElapsed > 0 ? serverElapsed : null,
                        服务器入站字节增长: ingress, 服务器出站字节增长: egress,
                        源视频字节增长: healthDelta(baseline, previous, 'sourceBytes'),
                        接收字节增长: received, 完整接收帧增长: delta('framesReceived'), 解码帧增长: decoded,
                        接收包增长: delta('packetsReceived'), 丢包增长: delta('packetsLost'),
                        NACK增长: delta('nackCount'), PLI增长: delta('pliCount'),
                        卡顿次数增长: delta('freezeCount'),
                        区间卡顿时长_ms: delta('totalFreezesDuration') === null ? null : Math.round(delta('totalFreezesDuration') * 1000),
                        停滞线索: clue,
                    });
                    // Manual SFU mode intentionally doesn't fail over. It must
                    // still preserve the low-FPS window before a route change.
                    if (!entry.slowSamples) entry.issueRecorded = false;
                    if (entry.slowSamples >= 3 && !automaticReceive(entry.peerId))
                        retainReceiverIssue(entry, 'receiver-video-stalled');
                    if (entry.slowSamples >= 3 && automaticReceive(entry.peerId)) {
                        retainReceiverFailure(entry, 'receiver-video-stalled');
                        entry.slowSamples = 0;
                        receiverCooldowns.set(publication.id, Date.now() + 120000);
                        if (await releaseSubscription(publication.id, token, 'receiver-video-stalled'))
                            onWarning?.('服务器画面持续卡顿，已切换直连');
                        return;
                    }
                } catch (error) {
                    if (current(token) && subscriptions.get(publication.id) === entry) {
                        entry.statsFailures = (entry.statsFailures || 0) + 1;
                        keepHealthSample(entry, { 采样时间_ms: Date.now(), 状态: '统计读取失败或超时',
                            页面后台: Boolean(global.document?.hidden), 判定有效: false, 连续统计失败次数: entry.statsFailures });
                        if (entry.statsFailures >= 3 && !automaticReceive(entry.peerId))
                            retainReceiverIssue(entry, 'receiver-stats-timeout');
                        if (entry.statsFailures >= 3 && automaticReceive(entry.peerId)) {
                            retainReceiverFailure(entry, 'receiver-stats-timeout');
                            receiverCooldowns.set(publication.id, Date.now() + 120000);
                            if (await releaseSubscription(publication.id, token, 'receiver-stats-timeout'))
                                onWarning?.('服务器共享统计无响应，已切换直连', error);
                            return;
                        }
                    }
                }
                if (current(token) && subscriptions.get(publication.id) === entry)
                    entry.healthTimer = global.setTimeout(() => void sample(), 2000);
            };
            entry.healthTimer = global.setTimeout(() => void sample(), 2000);
        };
        const clearLocal = () => {
            sendServerHealth = undefined;
            epoch++;
            pressureSamples = 0;
            lastPressureAt = 0;
            publicationVersion++;
            global.clearTimeout(retryTimer);
            global.clearInterval(discoveryTimer);
            producers.forEach((producer) => producer.close());
            producers.clear();
            [...subscriptions.keys()].forEach(dropSubscription);
            sendTransport?.close();
            recvTransport?.close();
            sendTransport =
                recvTransport =
                device =
                initPromise =
                publishing =
                    undefined;
            publicationId = undefined;
            updateRoutes([]);
            changeState('p2p');
        };
        const retryLater = () => {
            global.clearTimeout(retryTimer);
            if (!session || !config.enabled) return;
            retryTimer = global.setTimeout(
                () =>
                    void initialize()
                        .then(() => publishDesired())
                        .catch(() => {}),
                Math.max(1000, cooldownUntil - Date.now())
            );
        };
        const fallback = (error, token = epoch) => {
            if (token !== epoch) return;
            recordRoute('fallback', error?.message);
            // Ask the server to release reservations before starting a new session.
            if (current(token)) void request('reset').catch(() => {});
            clearLocal();
            cooldownUntil = Date.now() + 60000;
            onWarning?.('服务器共享暂不可用，已回到直连', error);
            retryLater();
        };
        const releaseSubscription = async (id, token = epoch, reason = 'receiver-unsubscribed') => {
            recordRoute('receiver-release', reason);
            dropSubscription(id);
            try {
                await request('unsubscribe', { publicationId: id }, token);
                return true;
            } catch (error) {
                // Local disposal is insufficient: the publisher still suppresses
                // P2P until the server releases this receiver's reservation.
                fallback(error, token);
                return false;
            }
        };
        const guardEvent = (payload) =>
            session &&
            payload?.roomId === session.roomId &&
            payload.voiceSessionGeneration === session.voiceSessionGeneration;
        const bindTransport = (transport, token, sending) => {
            transport.on('connect', ({ dtlsParameters }, callback, errback) => {
                request(
                    'connect',
                    { transportId: transport.id, dtlsParameters },
                    token
                ).then(() => callback(), errback);
            });
            if (sending)
                transport.on(
                    'produce',
                    ({ kind, rtpParameters, appData }, callback, errback) => {
                        request(
                            'produce',
                            {
                                transportId: transport.id,
                                kind,
                                rtpParameters,
                                role: appData.role,
                            },
                            token
                        ).then(
                            (result) => callback({ id: result.id }),
                            errback
                        );
                    }
                );
            let disconnectTimer;
            transport.on('connectionstatechange', (next) => {
                global.clearTimeout(disconnectTimer);
                if (next === 'failed')
                    fallback(new Error('sfu-transport-failed'), token);
                if (next === 'disconnected')
                    disconnectTimer = global.setTimeout(
                        () =>
                            fallback(
                                new Error('sfu-transport-disconnected'),
                                token
                            ),
                        5000
                    );
            });
        };
        const receiveTransport = async (token) => {
            if (recvTransport) return recvTransport;
            const parameters = await request(
                'transport',
                { direction: 'recv' },
                token
            );
            if (!current(token)) throw new Error('stale-sfu-session');
            recvTransport = device.createRecvTransport(parameters);
            bindTransport(recvTransport, token, false);
            return recvTransport;
        };
        // Serialize subscriptions: mediasoup receive transport has its own SDP
        // negotiation queue, and only one receive transport is created.
        let receiveQueue = Promise.resolve();
        const subscribe = (publication, token = epoch) => {
            const operation = receiveQueue
                .catch(() => {})
                .then(async () => {
                    if (
                        !current(token) ||
                        !device ||
                        !maySubscribe(publication.peerId) ||
                        subscriptions.has(publication.id) ||
                        (receiverCooldowns.get(publication.id) || 0) > Date.now() ||
                        publication.peerId === session.peerId
                    )
                        return;
                    const entry = {
                        peerId: publication.peerId,
                        healthOrdinal: ++receiverOrdinal,
                        consumers: [],
                        attached: false,
                    };
                    subscriptions.set(publication.id, entry);
                    try {
                        const transport = await receiveTransport(token);
                        const result = await request(
                            'consume',
                            {
                                publicationId: publication.id,
                                transportId: transport.id,
                                rtpCapabilities:
                                    device.recvRtpCapabilities ||
                                    device.rtpCapabilities,
                            },
                            token
                        );
                        entry.peerId = result.peerId;
                        for (const parameters of result.consumers) {
                            const consumer = await transport.consume({
                                ...parameters,
                                appData: { role: parameters.role },
                            });
                            if (
                                !current(token) ||
                                subscriptions.get(publication.id) !== entry
                            ) {
                                consumer.close();
                                throw new Error('stale-sfu-session');
                            }
                            entry.consumers.push(consumer);
                        }
                        await request(
                            'resume',
                            { publicationId: publication.id },
                            token
                        );
                        // A connected transport alone doesn't prove video arrived.
                        // Wait for actual decoded video before suppressing P2P.
                        await (waitForMedia || waitForDecodedVideo)(
                            entry.consumers,
                            transport,
                            (reports) => {
                                const row = [...reports.values()].find((item) => item.type === 'inbound-rtp' && (item.kind === 'video' || item.mediaType === 'video'));
                                const previous = entry.startupStats;
                                const now = Date.now();
                                if (previous && now - previous.time < 1000) return;
                                const comparable = row && previous?.row?.id === row.id && row.timestamp > previous.row.timestamp;
                                const delta = (key) => comparable ? healthDelta(row, previous.row, key) : null;
                                keepHealthSample(entry, {
                                    采样时间_ms: now, 状态: '等待首帧', 页面后台: Boolean(global.document?.hidden), 判定有效: false,
                                    接收统计间隔_ms: comparable ? row.timestamp - previous.row.timestamp : null,
                                    接收字节增长: delta('bytesReceived'), 完整接收帧增长: delta('framesReceived'), 解码帧增长: delta('framesDecoded'),
                                    完整接收帧数: Number.isFinite(row?.framesReceived) ? row.framesReceived : null,
                                    解码帧数: Number.isFinite(row?.framesDecoded) ? row.framesDecoded : null,
                                    NACK增长: delta('nackCount'), PLI增长: delta('pliCount'),
                                    停滞线索: delta('bytesReceived') > 0 && row?.framesDecoded === 0 ? '首帧等待期间收到数据但未解码出帧' : '首帧等待中',
                                });
                                entry.startupStats = { time: now, row };
                            }
                        );
                        if (
                            !current(token) ||
                            subscriptions.get(publication.id) !== entry
                        )
                            throw new Error('stale-sfu-session');
                        if (!maySubscribe(entry.peerId)) {
                            await releaseSubscription(publication.id, token);
                            return;
                        }
                        const stream = new MediaStreamCtor(
                            entry.consumers.map((consumer) => consumer.track)
                        );
                        entry.attached = true;
                        const preference = receivePreferences.get(entry.peerId);
                        if (preference) preference.error = '';
                        recordRoute('subscription-ready');
                        entry.stream = stream;
                        entry.transport = transport;
                        onRemoteStream?.({
                            peerId: entry.peerId,
                            stream,
                            publicationId: publication.id,
                            trackRoles: entry.consumers
                                .filter((consumer) => consumer.kind === 'audio')
                                .map((consumer) => ({
                                    trackId: consumer.track.id,
                                    role: 'screen-share-audio',
                                })),
                        });
                        await request(
                            'ready',
                            { publicationId: publication.id },
                            token
                        );
                        monitorSubscription(publication, entry, token);
                    } catch (error) {
                        if (current(token) && subscriptions.get(publication.id) === entry) {
                            if (!entry.attached) {
                                if (!entry.healthSamples?.length) keepHealthSample(entry, {
                                    采样时间_ms: Date.now(), 状态: '首帧准备失败', 判定有效: false,
                                    停滞线索: '首帧准备失败，未取得可用接收统计',
                                });
                                retainReceiverIssue(entry, 'receiver-ready-failed');
                            }
                            recordRoute('subscribe-failed', error?.message);
                            if (['server-bandwidth-limit', 'server-resource-limit', 'unsupported-codec'].includes(error?.message))
                                receiverCooldowns.set(publication.id, Date.now() + 120000);
                            await releaseSubscription(publication.id, token, 'receiver-ready-failed');
                            if (!current(token)) return;
                            const preference = receivePreferences.get(publication.peerId) || { mode: 'auto', pending: false, error: '' };
                            if (!receivePreferences.has(publication.peerId)) receivePreferences.set(publication.peerId, preference);
                            if (preference && preference.mode !== 'p2p') preference.error = receiveError(error?.message);
                            onWarning?.('该共享使用直连观看', error);
                        }
                    }
                });
            receiveQueue = operation;
            return operation;
        };
        const initialize = () => {
            if (!config.enabled || !Device || !session || !socket?.connected)
                return Promise.resolve(false);
            if (Date.now() < cooldownUntil) {
                retryLater();
                return Promise.resolve(false);
            }
            if (initPromise) return initPromise;
            const token = epoch;
            initPromise = (async () => {
                const capabilities = await request('capabilities', {}, token);
                const nextDevice = new Device();
                await nextDevice.load({
                    routerRtpCapabilities: capabilities.rtpCapabilities,
                });
                if (!current(token)) return false;
                device = nextDevice;
                config.videoBitrate = capabilities.videoBitrate;
                config.audioBitrate = capabilities.audioBitrate;
                config.initialViewerBitrate = capabilities.initialViewerBitrate;
                const result = await request('list', {}, token);
                result.publications.forEach(
                    (publication) => void subscribe(publication, token)
                );
                discoveryTimer = global.setInterval(() => {
                    if (current(token))
                        void request('list', {}, token)
                            .then((snapshot) =>
                                snapshot.publications.forEach(
                                    (publication) =>
                                        void subscribe(publication, token)
                                )
                            )
                            .catch((error) => fallback(error, token));
                }, 60000);
                return true;
            })().catch((error) => {
                fallback(error, token);
                return false;
            });
            return initPromise;
        };
        const publishDesired = () => {
            if (!desired || publishing || publicationId)
                return publishing || Promise.resolve();
            const token = epoch;
            const version = publicationVersion;
            const capture = desired;
            publishing = (async () => {
                if (
                    !(await initialize()) ||
                    !current(token) ||
                    desired !== capture ||
                    version !== publicationVersion
                )
                    return;
                changeState('connecting');
                const parameters = await request(
                    'transport',
                    { direction: 'send' },
                    token
                );
                if (
                    !current(token) ||
                    desired !== capture ||
                    version !== publicationVersion
                )
                    return;
                sendTransport = device.createSendTransport(parameters);
                bindTransport(sendTransport, token, true);
                for (const track of capture.stream
                    .getTracks()
                    .filter((item) => item.readyState !== 'ended')) {
                    if (
                        !current(token) ||
                        desired !== capture ||
                        version !== publicationVersion
                    )
                        return;
                    const video = track.kind === 'video';
                    const decision = video ? global.VoiceScreenCodecs?.getDecision(track) : undefined;
                    const codecPrimary = capture.codecPrimary || decision?.primary;
                    const availableCodecs = device.sendRtpCapabilities?.codecs || device.rtpCapabilities?.codecs;
                    let selectedCodec = decision ? global.VoiceScreenCodecs.findCodec(availableCodecs, codecPrimary) : undefined;
                    if (video && decision && !selectedCodec) throw new Error('screen-codec-unavailable');
                    const bitrate = Math.min(config.videoBitrate, videoMaxBitrate);
                    const startBitrateKbps = ['1500', '5500'].includes(String(capture.options.startBitrate))
                        ? Math.min(Number(capture.options.startBitrate), Math.floor(bitrate / 1000)) : undefined;
                    const produceOptions = {
                        track,
                        stopTracks: false,
                        appData: {
                            role: video ? 'screen-video' : 'screen-audio',
                            ...(video ? { startBitrateKbps } : {}),
                        },
                        ...(video
                            ? {
                                  encodings: [
                                      {
                                          maxBitrate: bitrate,
                                          maxFramerate:
                                              capture.options.frameRate || 60,
                                          scaleResolutionDownBy: 1,
                                          ...(selectedCodec?.mimeType?.toLowerCase() === 'video/av1' ? { scalabilityMode: 'L1T1' } : {}),
                                      },
                                  ],
                                  ...(selectedCodec ? { codec: selectedCodec } : {}),
                                  ...(startBitrateKbps ? { codecOptions: { videoGoogleStartBitrate: startBitrateKbps } } : {}),
                              }
                            : {
                                  codecOptions: {
                                      opusStereo: true,
                                      opusMaxAverageBitrate:
                                          config.audioBitrate,
                                  },
                              }),
                    };
                    let producer;
                    const codecTrials = video && decision ? global.VoiceScreenCodecs.candidates(codecPrimary)
                        .map((key) => availableCodecs?.find(global.VoiceScreenCodecs.codecs[key].matches)).filter(Boolean) : [undefined];
                    for (let index = 0; index < codecTrials.length; index++) {
                        selectedCodec = codecTrials[index];
                        try {
                            const encodings = produceOptions.encodings?.map((encoding) => {
                                const value = { ...encoding };
                                if (selectedCodec?.mimeType?.toLowerCase() === 'video/av1') value.scalabilityMode = 'L1T1';
                                else delete value.scalabilityMode;
                                return value;
                            });
                            producer = await sendTransport.produce({ ...produceOptions, ...(encodings ? { encodings } : {}),
                                ...(selectedCodec ? { codec: selectedCodec } : {}) });
                            break;
                        } catch (error) {
                            if (!current(token) || desired !== capture || version !== publicationVersion || index === codecTrials.length - 1 ||
                                !(error.name === 'UnsupportedError' || /unsupported.codec|codec.*not.supported|encoder/i.test(error.message || ''))) throw error;
                            onCodecEvent?.({ 路径: 'SFU', primary: selectedCodec?.mimeType, reason: 'producer-codec-failed' });
                        }
                    }
                    if (
                        !current(token) ||
                        desired !== capture ||
                        version !== publicationVersion
                    ) {
                        producer.close();
                        return;
                    }
                    producers.add(producer);
                    if (video && decision?.mode === 'av1') {
                        const primary = Object.keys(global.VoiceScreenCodecs.codecs).find((key) => global.VoiceScreenCodecs.codecs[key].matches(selectedCodec));
                        onCodecEvent?.({ 路径: 'SFU', primary, reason: primary === decision.primary ? 'producer-created' : 'router-codec-fallback' });
                        global.VoiceScreenCodecs.registerConnection(statsConnection(sendTransport), {
                            sending: true, requested: decision.mode, primary,
                            isCurrent: () => current(token) && version === publicationVersion && desired === capture && !producer.closed && track.readyState !== 'ended',
                            onFallback: (reason) => {
                                if (primary === 'vp8') return;
                                const next = primary === 'av1' ? 'h264' : 'vp8';
                                onCodecEvent?.({ 路径: 'SFU', primary: next, reason });
                                stopPublishing();
                                desired = { ...capture, codecPrimary: next };
                                void publishDesired();
                            },
                        });
                        global.VoiceScreenCodecs.markConnected(statsConnection(sendTransport));
                    }
                    if (video && producer.rtpSender?.setParameters) {
                        const value = producer.rtpSender.getParameters();
                        value.degradationPreference = 'maintain-resolution';
                        value.encodings?.forEach((encoding) => {
                            encoding.maxBitrate = bitrate;
                            encoding.maxFramerate = capture.options.frameRate || 60;
                            encoding.scaleResolutionDownBy = 1;
                        });
                        global.VoiceScreenSendPolicy?.observe(producer.rtpSender, value, { path: 'SFU', startBitrateKbps, status: 'pending' });
                        try {
                            await producer.rtpSender.setParameters(value);
                            global.VoiceScreenSendPolicy?.observe(producer.rtpSender, value, { path: 'SFU', startBitrateKbps });
                        } catch (error) {
                            global.VoiceScreenSendPolicy?.observe(producer.rtpSender, value, { path: 'SFU', startBitrateKbps, status: 'failed' });
                            onWarning?.('浏览器不支持共享降级偏好', error);
                        }
                    }
                }
                if (
                    !current(token) ||
                    desired !== capture ||
                    version !== publicationVersion
                )
                    return;
                const result = await request('publish', {}, token);
                if (
                    !current(token) ||
                    desired !== capture ||
                    version !== publicationVersion
                )
                    return;
                publicationId = result.publicationId;
                changeState('sfu');
            })()
                .catch((error) => {
                    if (version === publicationVersion) fallback(error, token);
                })
                .finally(() => {
                    if (token === epoch && version === publicationVersion)
                        publishing = undefined;
                });
            return publishing;
        };
        const stopPublishing = () => {
            sendServerHealth = undefined;
            const hadPublication = Boolean(
                desired || publicationId || publishing || sendTransport
            );
            desired = undefined;
            publicationVersion++;
            if (hadPublication && session && socket?.connected)
                void request('stop').catch(() => {});
            producers.forEach((producer) => producer.close());
            producers.clear();
            publicationId = undefined;
            sendTransport?.close();
            sendTransport = publishing = undefined;
            updateRoutes([]);
            changeState('p2p');
        };
        const getReceiveRoute = (peerId) => {
            const preference = receivePreferences.get(peerId);
            const attached = [...subscriptions.values()].some((entry) => entry.peerId === peerId && entry.attached);
            return { mode: receiveMode(peerId), route: attached ? 'sfu' : 'p2p', transport: attached ? 'SFU' : p2pSamples.get(peerId)?.path || 'unknown',
                reason: preference?.fallbackReason || null,
                pending: Boolean(preference?.pending), available: Boolean(config.enabled && Device),
                error: preference?.error || (preference?.mode === 'sfu' && !attached
                    ? '服务器转发当前不可用，当前使用 P2P；可重试或更改设置' : '') };
        };
        const receiveError = (reason) => ({
            'unsupported-codec': '此设备不能解码服务器共享编码，当前保留 P2P 兼容协商',
            'server-bandwidth-limit': '服务器带宽名额不足，当前使用 P2P',
            'server-resource-limit': '服务器资源不足，当前使用 P2P',
            'publication-unavailable': '这位共享者尚未提供服务器转发，当前使用 P2P',
        })[reason] || '服务器转发不可用，当前使用 P2P';
        const setReceiveRoute = async (peerId, mode) => {
            if (!peerId || !['auto', 'p2p', 'sfu', 'p2p-first'].includes(mode) || receivePreferences.get(peerId)?.pending)
                return getReceiveRoute(peerId);
            const preference = { mode, pending: true, error: '', startedAt: Date.now(), fallback: false };
            p2pSamples.delete(peerId);
            receivePreferences.set(peerId, preference);
            const voiceSession = session;
            try {
                if (mode === 'p2p' || mode === 'p2p-first') {
                    // Drain pending consume/ready requests before releasing the
                    // reservation, so a late response cannot park P2P again.
                    await receiveQueue.catch(() => {});
                    if (session !== voiceSession || receivePreferences.get(peerId) !== preference) return getReceiveRoute(peerId);
                    for (const [id, entry] of subscriptions) {
                        if (entry.peerId === peerId) await releaseSubscription(id);
                    }
                } else {
                    if (!(await initialize())) throw new Error('unavailable');
                    const token = epoch;
                    const result = await request('list', {}, token);
                    if (session !== voiceSession || receivePreferences.get(peerId) !== preference) return getReceiveRoute(peerId);
                    const publication = result.publications.find((item) => item.peerId === peerId);
                    if (!publication) throw new Error('publication-unavailable');
                    // An explicit retry is allowed; automatic discovery retains
                    // the original cooldown after receiver failure.
                    if (mode === 'sfu') receiverCooldowns.delete(publication.id);
                    await subscribe(publication, token);
                    if (mode === 'sfu' && getReceiveRoute(peerId).route !== 'sfu' && !preference.error)
                        throw new Error('unavailable');
                }
            } catch (error) {
                preference.error = getReceiveRoute(peerId).route === 'sfu'
                    ? '路径设置未完成，当前仍为服务器转发' : receiveError(error?.message);
            } finally {
                preference.pending = false;
            }
            return getReceiveRoute(peerId);
        };
        const requestP2pFallback = async (peerId, reason) => {
            const preference = receivePreferences.get(peerId);
            if (!current(epoch) || preference?.mode !== 'p2p-first' || preference.pending || preference.fallback || global.document?.hidden) return;
            preference.fallback = true;
            preference.fallbackReason = reason;
            preference.pending = true;
            recordRoute('p2p-fallback-requested', reason);
            try {
                if (!(await initialize()) || receivePreferences.get(peerId) !== preference) return;
                const token = epoch;
                const result = await request('list', {}, token);
                if (!current(token) || receivePreferences.get(peerId) !== preference) return;
                const publication = result.publications.find((item) => item.peerId === peerId);
                if (!publication) throw new Error('publication-unavailable');
                await subscribe(publication, token);
            } catch (error) { preference.error = receiveError(error?.message); }
            finally { preference.pending = false; }
        };
        const observeP2p = (peerId, pc, reports) => {
            if (!session || [...subscriptions.values()].some((entry) => entry.peerId === peerId && entry.attached)) return;
            const preference = receivePreferences.get(peerId);
            const before = p2pSamples.get(peerId);
            const rows = Array.from(reports?.values?.() || reports || []);
            const row = rows.filter((item) => item.type === 'inbound-rtp' && (item.kind === 'video' || item.mediaType === 'video'))
                .sort((a, b) => (b.framesDecoded || 0) - (a.framesDecoded || 0))[0];
            const path = reports ? global.VoiceScreenCodecs?.describePath?.(pc, reports) || 'unknown' : before?.path || 'unknown';
            if (!global.document?.hidden && row && before?.pc === pc && row.id === before.row?.id && row.timestamp - before.row.timestamp >= 900) {
                const stalled = Number.isFinite(row.framesDecoded) && row.framesDecoded === before.row.framesDecoded && row.bytesReceived > before.row.bytesReceived;
                const stalls = stalled ? (before.stalls || 0) + 1 : 0;
                p2pSamples.set(peerId, { pc, row, path, stalls });
                if (stalls >= 3) void requestP2pFallback(peerId, 'p2p-video-stalled');
            } else if (!before || before.pc !== pc || (row && row.id !== before.row?.id)) p2pSamples.set(peerId, { pc, row, path, stalls: 0 });
            if (preference?.mode !== 'p2p-first' || Date.now() - preference.startedAt < 10000) return;
            if (!pc || ['failed', 'closed', 'disconnected'].includes(pc.connectionState) || ['failed', 'closed', 'disconnected'].includes(pc.iceConnectionState))
                void requestP2pFallback(peerId, 'p2p-connection-failed');
            else if (path === 'TURN') void requestP2pFallback(peerId, 'turn-relay');
            else if (Date.now() - preference.startedAt >= 20000 && !['connected', 'completed'].includes(pc.connectionState) && !['connected', 'completed'].includes(pc.iceConnectionState))
                void requestP2pFallback(peerId, 'p2p-connection-failed');
        };
        const handlers = {
            'sfu:publication': (payload) => {
                if (guardEvent(payload))
                    void initialize().then(() => subscribe(payload));
            },
            'sfu:routes': (payload) => {
                if (
                    guardEvent(payload) &&
                    payload.publicationId === publicationId
                ) {
                    if (Number.isFinite(payload.uplinkBitrate))
                        uplinkBitrate = payload.uplinkBitrate;
                    if (Number.isFinite(payload.videoMaxBitrate) && payload.videoMaxBitrate >= 500000) {
                        videoMaxBitrate = payload.videoMaxBitrate;
                        void applyVideoBitrate();
                    }
                    updateRoutes(payload.peerIds || []);
                }
            },
            'sfu:closed': (payload) => {
                if (guardEvent(payload)) {
                    const entry = subscriptions.get(payload.publicationId);
                    recordRoute('subscription-closed', payload.reason);
                    if (payload.reason === 'server-bandwidth-priority')
                        receiverCooldowns.set(payload.publicationId, Date.now() + 120000);
                    dropSubscription(payload.publicationId);
                    const preference = receivePreferences.get(entry?.peerId);
                    if (preference?.mode === 'sfu') preference.error = '服务器转发已断开，当前使用 P2P';
                }
            },
            'sfu:health': (payload) => {
                if (!guardEvent(payload)) return;
                const entry = subscriptions.get(payload.publicationId);
                if (entry && Number.isFinite(payload.videoBytes)) entry.sourceBytes = payload.videoBytes;
                const sanitize = (row) => row ? Object.fromEntries(['码率_bps', '累计字节', '累计包数', '累计丢包']
                    .map((key) => [key, Number.isFinite(row[key]) && row[key] >= 0 ? row[key] : null])) : null;
                const health = payload.serverHealth;
                if (health && Number.isFinite(health.采样时间_ms)) {
                    const safe = { 采样时间_ms: health.采样时间_ms, 入站: sanitize(health.入站), 出站: sanitize(health.出站) };
                    if (entry) {
                        entry.serverHealth = safe;
                        entry.serverHealthReceivedAt = Date.now();
                    }
                    if (payload.publicationId === publicationId) sendServerHealth = safe;
                }
            },
            'sfu:fallback': (payload) => {
                if (guardEvent(payload)) fallback(new Error(payload.reason));
            },
            disconnect: () => {
                clearLocal();
            },
        };
        return {
            attachSocket(next) {
                if (socket === next) return;
                if (socket)
                    Object.entries(handlers).forEach(([event, handler]) =>
                        socket.off?.(event, handler)
                    );
                socket = next;
                Object.entries(handlers).forEach(([event, handler]) =>
                    socket.on(event, handler)
                );
            },
            setSession(next) {
                if (
                    session &&
                    session.roomId === next?.roomId &&
                    session.peerId === next?.peerId &&
                    session.voiceSessionGeneration ===
                        next?.voiceSessionGeneration
                ) {
                    void initialize().then(() => publishDesired());
                    return;
                }
                clearLocal();
                receivePreferences.clear();
                p2pSamples.clear();
                session = next;
                cooldownUntil = 0;
                if (next) void initialize().then(() => publishDesired());
            },
            publish(stream, options = {}) {
                desired = { stream, options };
                return publishDesired();
            },
            stopPublishing,
            leave() {
                if (session && socket?.connected)
                    void request('reset').catch(() => {});
                desired = undefined;
                clearLocal();
                session = undefined;
                receiverCooldowns.clear();
                receivePreferences.clear();
                p2pSamples.clear();
                routeHistory.length = 0;
                receiverFailures.length = 0;
                receiverIssues.length = 0;
                receiverOrdinal = 0;
            },
            usesServer: (peerId) => routes.has(peerId),
            observeP2p,
            observeSender(snapshot, { directViewers = 0, budget = 24000000 } = {}) {
                if (!current(epoch) || !desired || directViewers < 2) { pressureSamples = 0; return; }
                const rows = (snapshot.连接 || []).filter((connection) => connection.路径 === 'P2P')
                    .flatMap((connection) => connection.视频流 || []).filter((row) => row.统计状态 === '已采样' && row.区间发送帧率 > 0);
                const totalBps = (snapshot.连接 || []).flatMap((connection) => connection.视频流 || [])
                    .filter((row) => row.统计状态 === '已采样' && row.方向 === '发送')
                    .reduce((sum, row) => sum + (row.码率_Mbps || 0) * 1e6, 0);
                const cpu = rows.some((row) => row.编码受限原因 === 'cpu' && row.区间采集帧率 > 0 && row.区间编码帧率 < row.区间采集帧率 * 0.8);
                const bandwidth = rows.some((row) => row.编码受限原因 === 'bandwidth') && totalBps > budget * 0.9;
                pressureSamples = cpu || bandwidth ? pressureSamples + 1 : 0;
                if (pressureSamples < 3 || Date.now() - lastPressureAt < 10000) return;
                lastPressureAt = Date.now();
                socket.emit('screen:route-pressure', { voiceSessionGeneration: session.voiceSessionGeneration,
                    reason: cpu ? 'sender-encoder-pressure' : 'sender-uplink-pressure' });
            },
            receivePressure(payload) {
                if (guardEvent(payload) && ['sender-encoder-pressure', 'sender-uplink-pressure'].includes(payload.reason))
                    void requestP2pFallback(payload.peerId, payload.reason);
            },
            getReceiveRoute,
            setReceiveRoute,
            forgetPeer(peerId) {
                receivePreferences.delete(peerId);
                p2pSamples.delete(peerId);
                for (const [id, entry] of subscriptions) {
                    if (entry.peerId !== peerId) continue;
                    if (session && socket?.connected)
                        void releaseSubscription(id);
                    else dropSubscription(id);
                }
            },
            hasUplink: () => Boolean(publicationId),
            getUplinkBitrate: () => (publicationId ? uplinkBitrate : 0),
            getRemoteSource: (peerId) => {
                const entry = [...subscriptions.values()].find(
                    (item) => item.peerId === peerId && item.attached
                );
                return entry
                    ? {
                          stream: entry.stream,
                          pc: statsConnection(entry.transport),
                          serverHealth: entry.serverHealth,
                      }
                    : undefined;
            },
            getSendConnection: () => statsConnection(sendTransport),
            getSendHealth: () => sendServerHealth,
            getReceiverHealth: () => copyHealth({
                接收健康格式: 1,
                活跃接收: [...subscriptions.values()].filter((entry) => entry.attached).map((entry) => ({
                    序号: entry.healthOrdinal, 健康采样: entry.healthSamples || [],
                })).slice(0, 8),
                最近回退: receiverFailures,
                最近异常: receiverIssues,
            }),
            snapshot: () => ({
                state,
                serverViewers: routes.size,
                hasUplink: Boolean(publicationId),
                uplinkStatus: publicationId ? (routes.size ? 'forwarding' : 'idle') : 'none',
                routeHistory: routeHistory.map((row) => ({ ...row })),
            }),
        };
    };
    const waitForDecodedVideo = async (consumers, transport, onStats) => {
        const video = consumers.find((consumer) => consumer.kind === 'video');
        if (!video) throw new Error('video-required');
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline && !video.closed) {
            const reports = await video.getStats();
            try { onStats?.(reports); } catch { /* Observing startup must not alter readiness. */ }
            if (
                [...reports.values()].some(
                    (report) =>
                        report.type === 'inbound-rtp' &&
                        (report.framesDecoded || 0) > 0
                )
            )
                return;
            await new Promise((resolve) => global.setTimeout(resolve, 200));
        }
        throw new Error('sfu-video-not-arriving');
    };
    const mergeScreenMedia = ({
        baseStream,
        baseTrackRoles = [],
        screenStream,
        screenTrackRoles = [],
        MediaStreamCtor = global.MediaStream,
    } = {}) => {
        if (!screenStream)
            return { stream: baseStream, trackRoles: baseTrackRoles };
        const screenIds = new Set(
            baseTrackRoles
                .filter((role) => role.role === 'screen-share-audio')
                .map((role) => role.trackId)
        );
        const participantTracks = (baseStream?.getAudioTracks?.() || []).filter(
            (track) => !screenIds.has(track.id) && track.readyState !== 'ended'
        );
        return {
            stream: new MediaStreamCtor([
                ...participantTracks,
                ...screenStream
                    .getTracks()
                    .filter((track) => track.readyState !== 'ended'),
            ]),
            trackRoles: [
                ...participantTracks.map((track) => ({
                    trackId: track.id,
                    role: 'participant-audio',
                })),
                ...screenTrackRoles,
            ],
        };
    };
    global.VoiceScreenSfuRuntime = { createRuntime, mergeScreenMedia };
})(window);
