// Platform adapter, not a routing controller. Piik's Go controller decides all
// assignments; its upstream peer classes own WebRTC. No Piik page/chat is mounted.
import { HostProvisionalChild } from './.deps/upstream/src/client/media/host-provisional-child';
import { ViewerPeer } from './.deps/upstream/src/client/webrtc/viewer-peer';
import { decodeServerMessage } from './.deps/upstream/src/shared/protocol';
import { NativeSenderPeer } from './.deps/upstream/src/client/native/native-sender-peer';
import { createNativeCapture } from './native';
import { SCREEN_AUDIO_BITRATE } from './share-audio';
import { diagnosticConnection } from './diagnostics';
import { applyVideoCaptureProfile } from './.deps/upstream/src/client/media/quality';
import type { HostMediaPeer } from './.deps/upstream/src/client/webrtc/host-peer';
import type { BrowserVideoCodecPreference } from './.deps/upstream/src/client/webrtc/video-codec';
import type {
    IceConfig,
    ParticipantRouteAssignment,
    ServerMessage,
} from './.deps/upstream/src/shared/protocol';

type PreparedTarget = {
    revision: number;
    connectionId: string;
    promoted?: HostMediaPeer;
};

const WATCH_RETRY_DELAYS = [500, 1500, 3000];

function createRuntime({
    onRemoteStream,
    onWarning,
    onRouteEvent,
    onPublicationFailure,
}: any) {
    let socket: any;
    let session: any;
    let epoch = 0;
    let local: any;
    let desired: { stream: MediaStream; options: any; codecPrimary?: BrowserVideoCodecPreference['primary'] } | null = null;
    let publicationVersion = 0;
    let remoteShares: any[] = [];
    const edges = new Map<string, any>();
    const watchers = new Map<string, any>();
    const watchRetries = new Map<string, { attempt: number; timer?: number; exhausted?: boolean }>();
    const clearWatchRetry = (shareId: string) => {
        window.clearTimeout(watchRetries.get(shareId)?.timer);
        watchRetries.delete(shareId);
    };
    const diagnosticClocks = new WeakMap<object, { timestamp: number | null; observedAt: number }>();
    const observeDiagnostic = (owner: object, snapshot: any) => {
        const now = performance.now();
        let clock = diagnosticClocks.get(owner);
        if (!clock || clock.timestamp !== snapshot.metrics.sampleTimestampMs) {
            clock = { timestamp: snapshot.metrics.sampleTimestampMs, observedAt: now };
            diagnosticClocks.set(owner, clock);
        }
        return now - clock.observedAt;
    };
    const diagnostic = (owner: object, snapshot: any, sending: boolean, native: boolean) =>
        diagnosticConnection(snapshot, sending, native, observeDiagnostic(owner, snapshot));
    const request = (input: any): Promise<any> =>
        new Promise((resolve, reject) => {
            // Never let cleanup/publication commands from an old owner sit in
            // Socket.IO's reconnect buffer and execute in a later voice session.
            if (!socket?.connected) {
                reject(new Error('Piik 连接已断开，请重新加入语音后重试'));
                return;
            }
            socket
                .timeout(8000)
                .emit('piik:request', input, (error: any, result: any) => {
                    if (error || !result?.ok)
                        reject(new Error(result?.reason || 'Piik 请求超时'));
                    else resolve(result);
                });
        });
    const nativeCapture = createNativeCapture(
        () => request({ action: 'list' }),
        (message?: string) => {
            desired = null;
            if (message) onWarning?.(message);
            onPublicationFailure?.(message);
        }
    );
    const send = (edge: any, message: any) => {
        if (edge.closed) return false;
        void request({ action: 'send', sessionId: edge.id, message }).catch(
            (error) => onWarning?.('Piik 信令失败', error)
        );
        return true;
    };
    const reportFailed = (
        edge: any,
        revision: number,
        phase: string,
        connectionId: string | null
    ) => send(edge, { type: 'route-failed', revision, phase, connectionId });
    const dispose = (edge: any) => {
        if (!edge || edge.closed) return;
        edge.closed = true;
        if (watchers.get(edge.shareId) === edge) watchers.delete(edge.shareId);
        if (!edge.id) return;
        edge.prepared?.discard();
        for (const peer of edge.peers?.values() || []) peer.dispose();
        edge.pending?.peer.dispose();
        edge.active?.peer.dispose();
        edges.delete(edge.id);
        if (edge.peerId)
            onRemoteStream?.({
                peerId: edge.peerId,
                publicationId: edge.shareId,
                stream: null,
                trackRoles: [],
            });
        void request({ action: 'close', sessionId: edge.id }).catch(() => {});
    };
    const activeChildren = (
        edge: any,
        assignment: ParticipantRouteAssignment
    ) => {
        for (const [id, peer] of edge.peers as Map<string, HostMediaPeer>) {
            if (!assignment.childPeerIds.includes(id)) {
                peer.dispose();
                edge.peers.delete(id);
            }
        }
    };
    const reset = () => {
        epoch++;
        for (const edge of [...edges.values()]) dispose(edge);
        for (const shareId of watchRetries.keys()) clearWatchRetry(shareId);
        watchers.clear();
        local = null;
        session = null;
        remoteShares = [];
    };
    function hostEdge(
        id: string,
        shareId: string,
        stream: MediaStream,
        quality: any,
        codec: any
    ) {
        const edge: any = {
            id,
            shareId,
            role: 'host',
            stream,
            quality,
            peers: new Map(),
            revision: 0,
            activeRevision: 0,
        };
        const signal = (targetPeerId: string, payload: any) =>
            send(edge, { type: 'signal', targetPeerId, payload });
        const prepare = () =>
            new HostProvisionalChild({
                createPeer: nativeCapture.get(stream)
                    ? (candidate, input, events) => {
                          const native = nativeCapture.get(stream);
                          if (!native) throw new Error('Native share ended');
                          return new NativeSenderPeer(
                              candidate.childPeerId,
                              candidate.connectionId,
                              native.shareId,
                              input.iceConfig,
                              false,
                              native.client,
                              events,
                              native.codec,
                              undefined,
                              (candidate.connectionAttempt?.current ?? 1) > 1
                          );
                      }
                    : undefined,
                sendSignal: signal,
                activeConnectionId: (peerId) =>
                    edge.peers.get(peerId)?.connectionId ?? null,
                onPreparedChildFailed: (revision, connectionId) =>
                    reportFailed(edge, revision, 'prepare', connectionId),
                onPreparedChildConnected: (revision, connectionId) =>
                    send(edge, {
                        type: 'route-transport-connected',
                        revision,
                        connectionId,
                    }),
                onPromotedUpdate: (peer, snapshot) => {
                    observeDiagnostic(peer, snapshot);
                    if (
                        snapshot.connectionState === 'failed' &&
                        edge.peers.get(peer.peerId) === peer
                    )
                        reportFailed(
                            edge,
                            edge.activeRevision,
                            'active',
                            peer.connectionId
                        );
                },
            });
        edge.receive = (message: ServerMessage) => {
            if (message.type === 'authenticated') {
                edge.ice = message.iceConfig;
                edge.capacity = message.endpointMediaCopyCapacity;
                edge.prepared?.discard();
                edge.prepared = null;
                edge.preparedTarget = null;
                edge.activeRevision = edge.revision = message.routeRevision;
                activeChildren(edge, message.routeAssignment);
            } else if (message.type === 'route-update') {
                if (message.revision < edge.revision) return;
                edge.revision = message.revision;
                const input = {
                    revision: message.revision,
                    assignment: message.assignment,
                    activeChildPeerIds: [...edge.peers.keys()],
                    maxMediaEdges: edge.capacity,
                };
                if (message.phase === 'prepare') {
                    edge.prepared ??= prepare();
                    const connectionId = message.candidate.connectionId;
                    if (edge.preparedTarget?.revision !== message.revision || edge.preparedTarget.connectionId !== connectionId)
                        edge.preparedTarget = { revision: message.revision, connectionId } satisfies PreparedTarget;
                    if (
                        !edge.prepared.prepare({
                            ...input,
                            candidate: message.candidate,
                            iceConfig: edge.ice,
                            stream: edge.stream,
                            profile: edge.quality,
                            videoCodec: codec,
                            natPredictionEnabled: false,
                        })
                    )
                        reportFailed(
                            edge,
                            message.revision,
                            'prepare',
                            message.candidate.connectionId
                        );
                } else {
                    const promoted = edge.prepared?.activate(input);
                    if (promoted?.kind === 'promote') {
                        if (edge.preparedTarget) edge.preparedTarget.promoted = promoted.peer;
                        edge.peers.get(promoted.peerId)?.dispose();
                        edge.peers.set(promoted.peerId, promoted.peer);
                    }
                    edge.prepared = null;
                    edge.preparedTarget = null;
                    edge.activeRevision = message.revision;
                    activeChildren(edge, message.assignment);
                }
            } else if (message.type === 'signal') {
                if (
                    !edge.prepared?.acceptSignal(
                        message.fromPeerId,
                        message.payload
                    )
                )
                    void edge.peers
                        .get(message.fromPeerId)
                        ?.acceptSignal(message.payload);
            } else if (message.type === 'restart-request') {
                const peer = edge.peers.get(message.fromPeerId);
                if (peer?.connectionId === message.connectionId) {
                    // Rebuild is routed back through the same authoritative graph.
                    if (message.rebuild)
                        reportFailed(
                            edge,
                            edge.activeRevision,
                            'active',
                            peer.connectionId
                        );
                    else void peer.restartIce();
                }
            }
        };
        edges.set(id, edge);
        return edge;
    }
    function viewerEdge(id: string, share: any) {
        const edge: any = {
            id,
            shareId: share.id,
            peerId: share.peerId,
            role: 'viewer',
            revision: 0,
        };
        const emitStream = (binding: any) =>
            onRemoteStream?.({
                peerId: share.peerId,
                publicationId: share.id,
                stream: binding?.stream || null,
                trackRoles:
                    binding?.stream
                        ?.getAudioTracks()
                        .map((track: MediaStreamTrack) => ({
                            trackId: track.id,
                            role: 'screen-share-audio',
                        })) || [],
            });
        function receiving(
            revision: number,
            connectionId: string,
            parentPeerId: string,
            preparing: boolean
        ) {
            const binding: any = {
                revision,
                connectionId,
                parentPeerId,
                stream: null,
                ready: false,
                preparing,
            };
            const peer = new ViewerPeer(
                edge.ice as IceConfig,
                {
                    sendSignal: (targetPeerId, payload) =>
                        send(edge, { type: 'signal', targetPeerId, payload }),
                    sendRestartRequest: (targetPeerId, connectionId, rebuild) =>
                        edge.active === binding &&
                        send(edge, {
                            type: 'restart-request',
                            targetPeerId,
                            connectionId,
                            rebuild,
                        }),
                    onStream: (stream) => {
                        binding.stream = stream;
                        if (edge.active === binding) emitStream(binding);
                    },
                    onVideoTrackEnded: (connectionId) => {
                        if (edge.active !== binding || binding.connectionId !== connectionId ||
                            watchers.get(edge.shareId) !== edge) return false;
                        // Direct-only rooms have no alternate route once this edge is marked failed.
                        dispose(edge);
                        retryWatch(edge.shareId);
                        return true;
                    },
                    onFirstDecodedFrame: (connectionId) => {
                        if (watchers.get(edge.shareId) === edge && connectionId === binding.connectionId &&
                            (edge.pending === binding || edge.active === binding)) clearWatchRetry(edge.shareId);
                        if (
                            edge.pending === binding &&
                            connectionId === binding.connectionId
                        ) {
                            binding.ready = true;
                            return send(edge, {
                                type: 'route-ready',
                                revision: binding.revision,
                                phase: 'prepare',
                            });
                        }
                        return true;
                    },
                    onUpdate: (snapshot) => {
                        observeDiagnostic(binding, snapshot);
                        binding.metrics = snapshot;
                        edge.metrics = snapshot;
                        if (
                            edge.pending === binding &&
                            snapshot.connectionState === 'connected' &&
                            !binding.connected
                        ) {
                            binding.connected = true;
                            send(edge, {
                                type: 'route-transport-connected',
                                revision: binding.revision,
                                connectionId: binding.connectionId,
                            });
                        }
                    },
                    onRecoveryExhausted: (_parentId, cid) =>
                        reportFailed(
                            edge,
                            binding.revision,
                            edge.pending === binding ? 'prepare' : 'active',
                            cid
                        ),
                },
                { recoveryOwner: preparing ? 'route' : 'viewer' }
            );
            binding.peer = peer;
            return binding;
        }
        function assignment(
            revision: number,
            next: ParticipantRouteAssignment,
            connectionId?: string | null
        ) {
            edge.revision = revision;
            if (next.upstream.kind === 'peer') {
                const upstream = next.upstream;
                edge.parentPeerId = upstream.peerId;
                if (
                    edge.pending &&
                    edge.pending.parentPeerId === upstream.peerId &&
                    edge.pending.revision === revision
                ) {
                    edge.active?.peer.dispose();
                    edge.active = edge.pending;
                    edge.pending = null;
                    edge.active.revision = revision;
                    edge.active.peer.activatePreparedRoute();
                    emitStream(edge.active);
                } else if (
                    edge.active?.parentPeerId !== upstream.peerId ||
                    (connectionId && edge.active?.connectionId !== connectionId)
                ) {
                    edge.active?.peer.dispose();
                    edge.pending?.peer.dispose();
                    edge.pending = null;
                    edge.active = connectionId
                        ? receiving(
                              revision,
                              connectionId,
                              upstream.peerId,
                              false
                          )
                        : null;
                } else edge.active.revision = revision;
            } else {
                edge.active?.peer.dispose();
                edge.active = null;
                edge.pending?.peer.dispose();
                edge.pending = null;
                emitStream(null);
            }
        }
        edge.receive = (message: ServerMessage) => {
            if (message.type === 'authenticated') {
                edge.ice = message.iceConfig;
                assignment(
                    message.routeRevision,
                    message.routeAssignment,
                    message.connectionId
                );
            } else if (message.type === 'route-update') {
                if (message.revision < edge.revision) return;
                if (message.phase === 'active')
                    assignment(message.revision, message.assignment);
                else if (
                    message.assignment.upstream.kind === 'peer' &&
                    message.candidate.childPeerId === edge.selfPeerId
                ) {
                    if (
                        edge.pending?.connectionId ===
                        message.candidate.connectionId
                    )
                        return;
                    edge.pending?.peer.dispose();
                    edge.pending = receiving(
                        message.revision,
                        message.candidate.connectionId,
                        message.assignment.upstream.peerId,
                        true
                    );
                    edge.revision = message.revision;
                }
            } else if (message.type === 'signal') {
                if (
                    !edge.pending &&
                    !edge.active &&
                    edge.parentPeerId === message.fromPeerId
                )
                    edge.active = receiving(
                        edge.revision,
                        message.payload.connectionId,
                        message.fromPeerId,
                        false
                    );
                const binding = [edge.pending, edge.active].find(
                    (b) =>
                        b?.connectionId === message.payload.connectionId &&
                        b.parentPeerId === message.fromPeerId
                );
                void binding?.peer.acceptSignal(
                    message.fromPeerId,
                    message.payload
                );
            } else if (
                message.type === 'route-status' &&
                message.state === 'failed'
            )
                onWarning?.('Piik 没有可用的直连路径');
        };
        edges.set(id, edge);
        return edge;
    }
    function retryWatch(shareId: string) {
        if (!session || !socket?.connected || !remoteShares.some((share) => share.id === shareId && share.peerId !== session.peerId)) return;
        const retry = watchRetries.get(shareId) ?? { attempt: 0 };
        if (retry.timer !== undefined || retry.exhausted) return;
        if (retry.attempt >= WATCH_RETRY_DELAYS.length) {
            retry.exhausted = true;
            return;
        }
        watchRetries.set(shareId, retry);
        retry.timer = window.setTimeout(() => {
            retry.timer = undefined;
            void reconcile();
        }, WATCH_RETRY_DELAYS[retry.attempt++]);
    }

    async function reconcile() {
        if (!session || !socket?.connected) return;
        const token = epoch;
        const wanted = remoteShares.filter(
            (share) => share.peerId !== session.peerId
        );
        for (const shareId of watchRetries.keys())
            if (!wanted.some((share) => share.id === shareId)) clearWatchRetry(shareId);
        for (const [shareId, edge] of watchers)
            if (!wanted.some((s) => s.id === shareId)) dispose(edge);
        for (const share of wanted) {
            if (token !== epoch) return;
            const retry = watchRetries.get(share.id);
            if (watchers.has(share.id) || retry?.timer !== undefined || retry?.exhausted ||
                !remoteShares.some((current) => current.id === share.id)) continue;
            const marker = { closed: false, shareId: share.id };
            watchers.set(share.id, marker);
            try {
                const result = await request({
                    action: 'watch',
                    shareId: share.id,
                });
                if (token !== epoch || watchers.get(share.id) !== marker) {
                    void request({
                        action: 'close',
                        sessionId: result.sessionId,
                    }).catch(() => {});
                    continue;
                }
                watchers.set(share.id, viewerEdge(result.sessionId, share));
            } catch (error) {
                if (watchers.get(share.id) !== marker) continue;
                watchers.delete(share.id);
                retryWatch(share.id);
                onWarning?.('Piik 观看失败', error);
            }
        }
    }
    return {
        attachSocket(next: any) {
            socket = next;
            socket.on('piik:shares', (shares: any[]) => {
                remoteShares = shares;
                void reconcile();
            });
            socket.on('piik:message', ({ sessionId, message }: any) => {
                const edge = edges.get(sessionId);
                if (!edge) return;
                try {
                    const decoded = decodeServerMessage(
                        JSON.stringify(message)
                    );
                    if (decoded.type === 'authenticated')
                        edge.selfPeerId = decoded.peerId;
                    onRouteEvent?.({
                        provider: 'piik',
                        type: decoded.type,
                        revision:
                            'revision' in decoded
                                ? decoded.revision
                                : undefined,
                    });
                    edge.receive(decoded);
                    if (decoded.type === 'error')
                        onWarning?.(`Piik: ${decoded.code}`);
                } catch (error) {
                    onWarning?.('Piik 协议失败', error);
                    dispose(edge);
                }
            });
            socket.on('piik:closed', ({ sessionId }: any) => {
                const edge = edges.get(sessionId);
                const publicationLost = edge && edge === local;
                dispose(edge);
                if (publicationLost) {
                    local = null;
                    desired = null;
                    onWarning?.('Piik 共享连接已结束，请重新开始共享');
                    onPublicationFailure?.();
                } else if (edge?.role === 'viewer') retryWatch(edge.shareId);
            });
            socket.on('disconnect', () => {
                reset();
                if (nativeCapture.isActive()) {
                    nativeCapture.stop();
                    desired = null;
                    onPublicationFailure?.();
                }
            });
        },
        setSession(next: any) {
            if (
                session?.roomId === next.roomId &&
                session?.peerId === next.peerId &&
                session?.voiceSessionGeneration === next.voiceSessionGeneration
            )
                return;
            // Native capture is authorized for this voice owner. A different
            // owner/channel must start it explicitly rather than inherit it.
            if (session && nativeCapture.isActive()) {
                nativeCapture.stop();
                desired = null;
                onPublicationFailure?.();
            }
            reset();
            session = next;
            const token = epoch;
            void request({ action: 'list' })
                .then((result) => {
                    if (token === epoch) {
                        remoteShares = result.shares;
                        void reconcile();
                    }
                })
                .catch((error) => onWarning?.('Piik 会话失败', error));
            if (desired?.stream.getVideoTracks()[0]?.readyState === 'live') {
                const recovering = this.publish(desired.stream, desired.options, desired.codecPrimary);
                const version = publicationVersion;
                void recovering.catch((error) => {
                    if (token !== epoch || version !== publicationVersion) return;
                    onWarning?.('Piik 共享恢复失败', error);
                    onPublicationFailure?.();
                });
            }
        },
        async publish(stream: MediaStream, options: any, codecPrimary?: BrowserVideoCodecPreference['primary']) {
            const token = epoch;
            const version = ++publicationVersion;
            desired = { stream, options, codecPrimary };
            const settings = stream.getVideoTracks()[0].getSettings();
            const native = nativeCapture.get(stream);
            const quality = native?.profile || {
                resolution: {
                    width: settings.width || 1920,
                    height: settings.height || 1080,
                },
                maxFramerate: options.frameRate || 60,
                maxBitrate: options.maxBitrate || 15000000,
                maxAudioBitrate: SCREEN_AUDIO_BITRATE,
                degradationPreference: 'maintain-resolution',
            };
            const result = await request({ action: 'publish', quality });
            if (token !== epoch || version !== publicationVersion) {
                void request({ action: 'close', sessionId: result.sessionId }).catch(() => {});
                throw new Error('Piik 分享已取消');
            }
            const primary = native?.codec || codecPrimary ||
                (options.codecMode === 'vp8' || options.codecMode === 'av1' ? options.codecMode : 'h264');
            local = hostEdge(
                result.sessionId,
                result.shareId,
                stream,
                quality,
                {
                    primary,
                    vp8Fallback: !native && primary !== 'vp8',
                }
            );
        },
        stopPublishing() {
            desired = null;
            publicationVersion++;
            if (local) dispose(local);
            local = null;
            nativeCapture.stop();
            if (socket?.connected)
                void request({ action: 'stop' }).catch(() => {});
        },
        leave() {
            nativeCapture.stop();
            desired = null;
            publicationVersion++;
            reset();
        },
        captureNative: (options: any, signal: AbortSignal) =>
            nativeCapture.capture(options, signal),
        async updateNative(stream: MediaStream, options: any, changeSource: boolean) {
            const owner = local;
            const profile = await nativeCapture.update(stream, options, changeSource);
            if (!owner || local !== owner || owner.stream !== stream) throw new Error('共享已结束');
            owner.quality = profile;
            desired = { stream, options };
        },
        async updateWeb(stream: MediaStream, options: any, replacement?: MediaStream) {
            const owner = local;
            if (!owner || owner.stream !== stream) throw new Error('共享已结束');
            const nextStream = replacement ?? stream;
            const track = nextStream.getVideoTracks()[0];
            if (track?.readyState !== 'live') throw new Error('共享画面已结束');
            const sizes: Record<string, { width: number; height: number }> = {
                '720p': { width: 1280, height: 720 }, '1080p': { width: 1920, height: 1080 },
                '1440p': { width: 2560, height: 1440 }, '2160p': { width: 3840, height: 2160 },
            };
            const settings = track.getSettings();
            const previous = owner.quality;
            const profile = { ...previous, resolution: sizes[options.resolutionPreset] ||
                (options.resolutionPreset === 'auto' ? sizes['1080p'] : { width: settings.width || 1920, height: settings.height || 1080 }),
                maxFramerate: options.frameRate, maxBitrate: options.maxBitrate };
            const apply = async (source: MediaStream, next: typeof profile) => {
                const video = source.getVideoTracks()[0];
                if (video?.readyState !== 'live') throw new Error('共享画面已结束');
                await applyVideoCaptureProfile(video, next);
                if (local !== owner) throw new Error('共享已结束');
                if (video.readyState !== 'live') throw new Error('共享画面已结束');
                // Route preparations that arrive while these mutations are pending use the same source and profile.
                owner.stream = source;
                owner.quality = next;
                const update = (peer: Pick<HostMediaPeer, 'replaceStream'>, updateProfile: () => Promise<boolean>, isOwned: () => boolean) => {
                    // Enqueue both on the same peer before a prepared connection can be promoted.
                    const mutations = replacement ? [peer.replaceStream(source)] : [];
                    mutations.push(updateProfile());
                    return Promise.allSettled(mutations).then((results) => ({
                        isOwned,
                        succeeded: results.every((result) => result.status === 'fulfilled' && result.value),
                    }));
                };
                const isActive = (peer: HostMediaPeer) => owner.peers.get(peer.peerId) === peer;
                const peers: Iterable<HostMediaPeer> = owner.peers.values();
                const updates = Array.from(peers, (peer) => update(peer, () => peer.updateCaptureProfile(next), () => isActive(peer)));
                const prepared: HostProvisionalChild | undefined = owner.prepared;
                const target: PreparedTarget | undefined = owner.preparedTarget;
                if (prepared && target) updates.push(update(prepared, () => prepared.updateProfile(next), () =>
                    owner.preparedTarget === target || Boolean(target.promoted && isActive(target.promoted))
                ));
                const results = await Promise.all(updates);
                if (results.some(({ isOwned, succeeded }) => isOwned() && !succeeded) || video.readyState !== 'live')
                    throw new Error(replacement ? '新画面未能发送，请重试' : '部分观看连接未能应用画质，请重试');
            };
            try {
                await apply(nextStream, profile);
            } catch (error) {
                if (local === owner && owner.stream === nextStream) {
                    try {
                        await apply(stream, previous);
                    } catch {
                        if (local === owner) onPublicationFailure?.();
                    }
                }
                throw error;
            }
            if (local !== owner) throw new Error('共享已结束');
            desired = { stream: nextStream, options, codecPrimary: desired?.codecPrimary };
        },
        forgetPeer(peerId: string) {
            for (const edge of [...edges.values()])
                if (edge.peerId === peerId) dispose(edge);
        },
        snapshot: () => ({
            provider: 'piik',
            route: 'p2p',
            sharing: !!local,
            原生共享音频: nativeCapture.audioDiagnostics(),
            viewing: watchers.size,
            sfu: false,
            relay: false,
            received: [...edges.values()]
                .filter((e) => e.role === 'viewer')
                .map((e) => ({
                    codec: e.metrics?.metrics.codec ?? null,
                    fps: e.metrics?.metrics.framesPerSecond ?? null,
                    resolution: e.metrics?.metrics.resolution ?? null,
                })),
            sent: [...(local?.peers.values() || [])].map((p: HostMediaPeer) => {
                const m = p.getSnapshot().metrics;
                return {
                    codec: m.codec,
                    fps: m.framesPerSecond,
                    resolution: m.resolution,
                };
            }),
        }),
        // Existing UI diagnostics can query this without claiming SFU transport.
        getDiagnosticConnections: (peerId?: string) => {
            if (!peerId) return [...(local?.peers.values() || [])].map((peer: HostMediaPeer, i: number) => ({
                序号: i + 1,
                ...diagnostic(peer, peer.getSnapshot(), true, !!nativeCapture.get(local.stream)),
            }));
            const edge = [...watchers.values()].find((e) => e.peerId === peerId && !e.closed);
            const binding = edge?.active;
            return binding?.metrics ? [{ 序号: 1, ...diagnostic(binding, binding.metrics, false, false) }] : [];
        },
        usesServer: () => false,
        getRemoteSource: () => null,
        getSendConnection: () => null,
        getSendHealth: () => null,
        getReceiverHealth: () => [],
        getReceiveRoute: () => ({ mode: 'p2p' }),
        setReceiveRoute: () => {},
        observeSender: () => {},
        observeP2p: () => {},
        receivePressure: () => {},
        getUplinkBitrate: () => 0,
    };
}
(window as any).PiikScreenMedia = { createRuntime };
