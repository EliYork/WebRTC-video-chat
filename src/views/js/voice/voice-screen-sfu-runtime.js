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
        onRemoteStream,
        onRouteEvent,
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
                    const maxBitrate = Math.min(config.videoBitrate || 22000000, videoMaxBitrate);
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
        const statsConnections = new WeakMap();
        const statsConnection = (transport) => {
            if (!transport) return undefined;
            let connection = statsConnections.get(transport);
            if (!connection) {
                connection = { getStats: () => transport.getStats(), screenRoute: 'SFU',
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
            const allowedReasons = ['server-bandwidth-limit', 'server-bandwidth-priority', 'server-resource-limit', 'publisher-stopped', 'producer-closed', 'transport-closed', 'subscription-timeout', 'sfu-video-not-arriving', 'sfu-timeout', 'unsupported-codec', 'closed', 'session-left', 'transport-failed', 'sfu-transport-failed', 'receiver-video-stalled', 'receiver-stats-timeout', 'receiver-ready-failed', 'receiver-unsubscribed'];
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
            // Budget changes still update senders, but are not path switches.
            if (membersChanged) recordRoute('sender-routes-changed');
            onRoutes?.([...routes]);
        };
        const dropSubscription = (id) => {
            const entry = subscriptions.get(id);
            if (!entry) return;
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
                    const baseline = { time: now, id: report?.id, frames: report?.framesDecoded, sourceBytes: entry.sourceBytes };
                    entry.healthBaseline = baseline;
                    entry.statsFailures = 0;
                    if (previous && baseline.sourceBytes > previous.sourceBytes) entry.sourceActiveAt = now;
                    // Hidden pages and a stationary source should never trigger
                    // failover merely because the browser stops rendering frames.
                    const active = !global.document?.hidden && previous && baseline.id === previous.id && Number.isFinite(baseline.frames) && Number.isFinite(previous.frames) &&
                        now - (entry.sourceActiveAt || 0) < 4500 && baseline.frames >= previous.frames;
                    const fps = active ? (baseline.frames - previous.frames) * 1000 / Math.max(1, now - previous.time) : undefined;
                    entry.slowSamples = fps !== undefined && fps < 5 ? (entry.slowSamples || 0) + 1 : 0;
                    if (entry.slowSamples >= 3) {
                        entry.slowSamples = 0;
                        receiverCooldowns.set(publication.id, Date.now() + 120000);
                        if (await releaseSubscription(publication.id, token, 'receiver-video-stalled'))
                            onWarning?.('服务器画面持续卡顿，已切换直连');
                        return;
                    }
                } catch (error) {
                    if (current(token) && subscriptions.get(publication.id) === entry) {
                        entry.statsFailures = (entry.statsFailures || 0) + 1;
                        if (entry.statsFailures >= 3) {
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
                        subscriptions.has(publication.id) ||
                        (receiverCooldowns.get(publication.id) || 0) > Date.now() ||
                        publication.peerId === session.peerId
                    )
                        return;
                    const entry = {
                        peerId: publication.peerId,
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
                            transport
                        );
                        if (
                            !current(token) ||
                            subscriptions.get(publication.id) !== entry
                        )
                            throw new Error('stale-sfu-session');
                        const stream = new MediaStreamCtor(
                            entry.consumers.map((consumer) => consumer.track)
                        );
                        entry.attached = true;
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
                        if (current(token)) {
                            recordRoute('subscribe-failed', error?.message);
                            if (['server-bandwidth-limit', 'server-resource-limit'].includes(error?.message))
                                receiverCooldowns.set(publication.id, Date.now() + 120000);
                            await releaseSubscription(publication.id, token, 'receiver-ready-failed');
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
                    const selectedCodec = decision ? global.VoiceScreenCodecs.findCodec(device.sendRtpCapabilities?.codecs || device.rtpCapabilities?.codecs, decision.primary) : undefined;
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
                    try {
                        producer = await sendTransport.produce(produceOptions);
                    } catch (error) {
                        const fallbackCodec = video && decision && global.VoiceScreenCodecs.findCodec(
                            device.sendRtpCapabilities?.codecs || device.rtpCapabilities?.codecs, 'vp8'
                        );
                        if (!current(token) || version !== publicationVersion ||
                            !/^video\/h264$/i.test(selectedCodec?.mimeType || '') || !fallbackCodec ||
                            !(error.name === 'UnsupportedError' || /unsupported.codec|codec.*not.supported/i.test(error.message || ''))) throw error;
                        onWarning?.('SFU H.264 不兼容，本次服务器发布回退 VP8');
                        producer = await sendTransport.produce({ ...produceOptions, codec: fallbackCodec });
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
                    recordRoute('subscription-closed', payload.reason);
                    if (payload.reason === 'server-bandwidth-priority')
                        receiverCooldowns.set(payload.publicationId, Date.now() + 120000);
                    dropSubscription(payload.publicationId);
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
                    if (entry) entry.serverHealth = safe;
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
                routeHistory.length = 0;
            },
            usesServer: (peerId) => routes.has(peerId),
            forgetPeer(peerId) {
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
            snapshot: () => ({
                state,
                serverViewers: routes.size,
                hasUplink: Boolean(publicationId),
                routeHistory: routeHistory.map((row) => ({ ...row })),
            }),
        };
    };
    const waitForDecodedVideo = async (consumers) => {
        const video = consumers.find((consumer) => consumer.kind === 'video');
        if (!video) throw new Error('video-required');
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline && !video.closed) {
            const reports = await video.getStats();
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
