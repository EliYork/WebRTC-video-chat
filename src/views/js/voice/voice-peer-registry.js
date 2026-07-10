(function exposeVoicePeerRegistry(global) {
    'use strict';

    const REFRESH_METADATA_FLAG = 'voiceCallRefresh';
    const REFRESH_METADATA_KEY = 'voiceCallRefreshKey';

    const isCall = (value) => Boolean(value && typeof value.on === 'function');

    const createRegistry = ({
        attachRemoteStream,
        createRemoteStream,
        detachRemoteStream,
        onPeerCleanup,
        onRemoteMediaState,
        onReplacementFailed,
        onWarning,
        removeRemoteTile,
    } = {}) => {
        const entries = new Map();
        let closedCalls = new WeakSet();
        let sessionDisconnected = false;

        const warn = (message, error) => onWarning?.(message, error);

        const notifyState = (entry, reason) =>
            onRemoteMediaState?.({
                peerId: entry.peerId,
                reason,
                state: entry.state,
                stream: entry.remoteStream,
                tile: entry.tile,
            });

        const createEntry = (peerId) => ({
            call: null,
            callListeners: new Map(),
            cleanupGeneration: 0,
            direction: undefined,
            generation: 0,
            lastIncomingStream: null,
            peerId,
            pendingToken: null,
            refreshKey: undefined,
            remoteStream: null,
            replacement: null,
            state: 'idle',
            streamListeners: [],
            tile: null,
        });

        const ensureEntry = (peerId) => {
            if (!peerId) {
                return undefined;
            }

            let entry = entries.get(peerId);
            if (!entry) {
                entry = createEntry(peerId);
                entries.set(peerId, entry);
            }
            return entry;
        };

        const removeEmitterListener = (emitter, event, listener) => {
            if (typeof emitter?.off === 'function') {
                emitter.off(event, listener);
            } else if (typeof emitter?.removeListener === 'function') {
                emitter.removeListener(event, listener);
            }
        };

        const unbindCall = (entry, call) => {
            const listeners = entry?.callListeners.get(call);
            if (!listeners) {
                return;
            }

            listeners.forEach(({ event, listener }) =>
                removeEmitterListener(call, event, listener)
            );
            entry.callListeners.delete(call);
        };

        const closeCallOnce = (call) => {
            if (!isCall(call) || closedCalls.has(call)) {
                return false;
            }

            closedCalls.add(call);
            try {
                call.close?.();
            } catch (error) {
                warn(`Could not close peer call ${call.peer || ''}.`, error);
            }
            return true;
        };

        const retireCall = (entry, call, { close = true } = {}) => {
            if (!isCall(call)) {
                return;
            }

            unbindCall(entry, call);
            if (close) {
                closeCallOnce(call);
            }
        };

        const removeTargetListener = ({ event, listener, target }) =>
            target?.removeEventListener?.(event, listener);

        const detachStreamListeners = (entry) => {
            entry.streamListeners.forEach(removeTargetListener);
            entry.streamListeners = [];
        };

        const addStreamListener = (entry, target, event, listener) => {
            if (typeof target?.addEventListener !== 'function') {
                return;
            }

            target.addEventListener(event, listener);
            entry.streamListeners.push({ event, listener, target });
        };

        const cleanupPeer = (
            peerId,
            reason = 'cleanup',
            { closeCall = true, expectedCall } = {}
        ) => {
            const entry = entries.get(peerId);
            if (!entry || (expectedCall && entry.call !== expectedCall)) {
                return false;
            }

            entry.state = 'closing';
            entry.cleanupGeneration += 1;
            const currentCall = entry.call;
            const previousCall = entry.replacement?.call;
            const stream = entry.remoteStream;
            const tile = entry.tile;

            Array.from(entry.callListeners.keys()).forEach((call) =>
                unbindCall(entry, call)
            );
            detachStreamListeners(entry);

            try {
                detachRemoteStream?.({ peerId, reason, stream, tile });
            } catch (error) {
                warn(`Could not detach remote stream for ${peerId}.`, error);
            }

            if (closeCall) {
                closeCallOnce(currentCall);
            }
            closeCallOnce(previousCall);

            try {
                removeRemoteTile?.({ peerId, reason, tile });
            } catch (error) {
                warn(`Could not remove remote tile for ${peerId}.`, error);
            }

            entry.call = null;
            entry.lastIncomingStream = null;
            entry.pendingToken = null;
            entry.remoteStream = null;
            entry.replacement = null;
            entry.state = 'closed';
            entry.tile = null;
            entries.delete(peerId);
            onPeerCleanup?.({ peerId, reason });
            return true;
        };

        const restorePreviousCall = (entry, failedCall, reason, error) => {
            const previous = entry.replacement;
            unbindCall(entry, failedCall);
            if (reason === 'call-error') {
                closeCallOnce(failedCall);
            }
            entry.replacement = null;

            if (!previous?.call) {
                cleanupPeer(entry.peerId, reason, {
                    closeCall: false,
                    expectedCall: failedCall,
                });
                onReplacementFailed?.({
                    error,
                    peerId: entry.peerId,
                    reason,
                    refreshKey: entry.refreshKey,
                });
                return;
            }

            entry.call = previous.call;
            entry.direction = previous.direction;
            entry.generation = previous.generation;
            entry.refreshKey = previous.refreshKey;
            entry.state = previous.state === 'active' ? 'active' : 'pending';
            onReplacementFailed?.({
                error,
                peerId: entry.peerId,
                reason,
                refreshKey: failedCall?.metadata?.[REFRESH_METADATA_KEY],
            });
            notifyState(entry, reason);
        };

        const handleCallTerminal = (peerId, call, reason, error) => {
            const entry = entries.get(peerId);
            if (!entry) {
                return;
            }

            if (entry.replacement?.call === call) {
                retireCall(entry, call, { close: reason === 'call-error' });
                entry.replacement = null;
                return;
            }

            if (entry.call !== call) {
                return;
            }

            if (entry.replacement) {
                restorePreviousCall(entry, call, reason, error);
                return;
            }

            cleanupPeer(peerId, reason, {
                closeCall: reason === 'call-error',
                expectedCall: call,
            });
        };

        const bindCall = (entry, call) => {
            if (entry.callListeners.has(call)) {
                return;
            }

            const listeners = [
                {
                    event: 'stream',
                    listener: (stream) => registerRemoteStream(call, stream),
                },
                {
                    event: 'close',
                    listener: () =>
                        handleCallTerminal(entry.peerId, call, 'call-close'),
                },
                {
                    event: 'error',
                    listener: (error) =>
                        handleCallTerminal(
                            entry.peerId,
                            call,
                            'call-error',
                            error
                        ),
                },
            ];

            entry.callListeners.set(call, listeners);
            listeners.forEach(({ event, listener }) =>
                call.on(event, listener)
            );
        };

        const bindRemoteStream = (entry, stream) => {
            const generation = entry.generation;
            const isCurrent = () =>
                entries.get(entry.peerId) === entry &&
                entry.remoteStream === stream &&
                entry.generation === generation;

            addStreamListener(entry, stream, 'inactive', () => {
                if (isCurrent()) {
                    cleanupPeer(entry.peerId, 'stream-inactive');
                }
            });

            stream?.getTracks?.().forEach((track) => {
                addStreamListener(entry, track, 'ended', () => {
                    if (!isCurrent()) {
                        return;
                    }

                    stream.removeTrack?.(track);
                    const liveTracks = (stream.getTracks?.() || []).filter(
                        (currentTrack) => currentTrack.readyState !== 'ended'
                    );
                    if (liveTracks.length === 0) {
                        cleanupPeer(entry.peerId, 'all-tracks-ended');
                        return;
                    }

                    entry.tile =
                        attachRemoteStream?.({
                            peerId: entry.peerId,
                            stream,
                            tile: entry.tile,
                        }) || entry.tile;
                    notifyState(entry, `${track.kind || 'remote'}-track-ended`);
                });
            });
        };

        function registerRemoteStream(call, incomingStream) {
            const peerId = call?.peer;
            const entry = entries.get(peerId);
            if (
                !entry ||
                entry.call !== call ||
                !incomingStream ||
                entry.lastIncomingStream === incomingStream
            ) {
                return false;
            }

            detachStreamListeners(entry);
            let nextStream;
            try {
                nextStream =
                    createRemoteStream?.({
                        clearVideo: call.metadata?.videoState === 'audio-only',
                        currentStream: entry.remoteStream,
                        incomingStream,
                        peerId,
                    }) || incomingStream;
                entry.remoteStream = nextStream;
                entry.lastIncomingStream = incomingStream;
                bindRemoteStream(entry, nextStream);
                entry.tile =
                    attachRemoteStream?.({
                        peerId,
                        stream: nextStream,
                        tile: entry.tile,
                    }) || entry.tile;
            } catch (error) {
                warn(`Could not attach remote stream for ${peerId}.`, error);
                cleanupPeer(peerId, 'stream-attach-error', {
                    expectedCall: call,
                });
                return false;
            }

            entry.state = 'active';
            if (entry.replacement?.call) {
                retireCall(entry, entry.replacement.call);
                entry.replacement = null;
            }
            notifyState(entry, 'stream');
            return true;
        }

        const captureCallState = (entry) => ({
            call: entry.call,
            direction: entry.direction,
            generation: entry.generation,
            pendingToken: entry.pendingToken,
            refreshKey: entry.refreshKey,
            replacement: entry.replacement,
            state: entry.state,
        });

        const restoreEntrySnapshot = (entry, snapshot, existed) => {
            entry.pendingToken = null;
            if (existed) {
                Object.assign(entry, snapshot);
                return;
            }

            if (!entry.remoteStream && !entry.tile) {
                entries.delete(entry.peerId);
            } else {
                entry.call = null;
                entry.direction = undefined;
                entry.refreshKey = undefined;
                entry.state = 'idle';
            }
        };

        const installCall = (
            entry,
            call,
            { direction, previous, refreshKey }
        ) => {
            entry.call = call;
            entry.direction = direction;
            entry.generation += 1;
            entry.pendingToken = null;
            entry.refreshKey = refreshKey;
            entry.replacement = isCall(previous?.call) ? previous : null;
            entry.state = entry.replacement
                ? 'replacing'
                : `pending-${direction}`;
            bindCall(entry, call);
            return entries.get(entry.peerId) === entry && entry.call === call;
        };

        const canReplace = (entry, direction, refreshKey) =>
            isCall(entry.call) &&
            refreshKey !== undefined &&
            entry.direction === direction &&
            entry.refreshKey !== refreshKey;

        const callPeer = ({
            options = {},
            peer,
            peerId,
            refreshKey,
            stream,
        } = {}) => {
            if (sessionDisconnected || !peer || !peerId || !stream) {
                return undefined;
            }

            const existed = entries.has(peerId);
            const entry = ensureEntry(peerId);
            if (entry.pendingToken) {
                return undefined;
            }
            if (
                isCall(entry.call) &&
                !canReplace(entry, 'outgoing', refreshKey)
            ) {
                return entry.call;
            }

            const snapshot = captureCallState(entry);
            const previous = isCall(entry.call) ? snapshot : null;
            entry.pendingToken = {};
            entry.state = previous ? 'replacing' : 'pending-outgoing';

            let call;
            try {
                const metadata =
                    refreshKey === undefined
                        ? options.metadata
                        : {
                              ...options.metadata,
                              [REFRESH_METADATA_FLAG]: true,
                              [REFRESH_METADATA_KEY]: refreshKey,
                          };
                call = peer.call(peerId, stream, { ...options, metadata });
            } catch (error) {
                restoreEntrySnapshot(entry, snapshot, existed);
                warn(`Could not call peer ${peerId}.`, error);
                return undefined;
            }

            if (!call) {
                restoreEntrySnapshot(entry, snapshot, existed);
                warn(`Peer call for ${peerId} returned no MediaConnection.`);
                return undefined;
            }

            try {
                if (
                    !installCall(entry, call, {
                        direction: 'outgoing',
                        previous,
                        refreshKey,
                    })
                ) {
                    return undefined;
                }
                return call;
            } catch (error) {
                retireCall(entry, call);
                restoreEntrySnapshot(entry, snapshot, existed);
                warn(`Could not bind outgoing call for ${peerId}.`, error);
                return undefined;
            }
        };

        const answerCall = ({ call, stream } = {}) => {
            const peerId = call?.peer;
            if (sessionDisconnected || !call || !peerId || !stream) {
                closeCallOnce(call);
                return undefined;
            }

            const existed = entries.has(peerId);
            const entry = ensureEntry(peerId);
            if (entry.call === call) {
                return call;
            }

            const refreshKey = call.metadata?.[REFRESH_METADATA_KEY];
            const refreshing = call.metadata?.[REFRESH_METADATA_FLAG] === true;
            if (
                entry.pendingToken ||
                (isCall(entry.call) &&
                    (!refreshing || !canReplace(entry, 'incoming', refreshKey)))
            ) {
                closeCallOnce(call);
                return entry.call || undefined;
            }

            const snapshot = captureCallState(entry);
            const previous = isCall(entry.call) ? snapshot : null;
            entry.pendingToken = {};
            entry.state = previous ? 'replacing' : 'pending-incoming';

            try {
                if (
                    !installCall(entry, call, {
                        direction: 'incoming',
                        previous,
                        refreshKey,
                    })
                ) {
                    return undefined;
                }
                call.answer(stream);
                return call;
            } catch (error) {
                retireCall(entry, call);
                restoreEntrySnapshot(entry, snapshot, existed);
                warn(`Could not answer peer ${peerId}.`, error);
                return undefined;
            }
        };

        const ensurePeerTile = (peerId) => {
            const entry = ensureEntry(peerId);
            if (!entry) {
                return undefined;
            }
            if (entry.tile) {
                return entry.tile;
            }

            if (!entry.remoteStream) {
                entry.remoteStream =
                    createRemoteStream?.({
                        currentStream: null,
                        incomingStream: null,
                        peerId,
                    }) || null;
            }
            entry.tile =
                attachRemoteStream?.({
                    peerId,
                    stream: entry.remoteStream,
                    tile: entry.tile,
                }) || entry.tile;
            return entry.tile;
        };

        const getCall = (peerId) => {
            const call = entries.get(peerId)?.call;
            return isCall(call) ? call : undefined;
        };

        const getPeerIds = ({ direction } = {}) =>
            Array.from(entries.values())
                .filter(
                    (entry) =>
                        isCall(entry.call) &&
                        (!direction || entry.direction === direction)
                )
                .map((entry) => entry.peerId);

        const getState = (peerId) => {
            const entry = entries.get(peerId);
            return entry
                ? {
                      direction: entry.direction,
                      refreshKey: entry.refreshKey,
                      state: entry.state,
                  }
                : undefined;
        };

        const getSnapshot = (peerId) => {
            const entry = entries.get(peerId);
            return entry
                ? {
                      call: getCall(peerId),
                      cleanupGeneration: entry.cleanupGeneration,
                      direction: entry.direction,
                      peerId,
                      refreshKey: entry.refreshKey,
                      remoteStream: entry.remoteStream,
                      state: entry.state,
                      tile: entry.tile,
                  }
                : undefined;
        };

        const replaceTrack = async (peerId, kind, track) => {
            const call = getCall(peerId);
            const peerConnection = call?.peerConnection;
            const senders = peerConnection?.getSenders?.() || [];
            const transceivers = peerConnection?.getTransceivers?.() || [];
            const sender = senders.find((currentSender) => {
                if (currentSender.track?.kind === kind) {
                    return true;
                }

                return transceivers.some(
                    (transceiver) =>
                        transceiver.sender === currentSender &&
                        transceiver.receiver?.track?.kind === kind
                );
            });

            if (!sender) {
                return false;
            }

            try {
                await sender.replaceTrack(track || null);
                return true;
            } catch (error) {
                warn(`Could not replace ${kind} track for ${peerId}.`, error);
                return false;
            }
        };

        const teardown = (reason = 'teardown') => {
            const peerIds = Array.from(entries.keys());
            peerIds.forEach((peerId) => cleanupPeer(peerId, reason));
            return peerIds.length;
        };

        const reset = () => {
            teardown('reset');
            closedCalls = new WeakSet();
            sessionDisconnected = false;
        };

        return {
            answerCall,
            callPeer,
            cleanupPeer,
            ensurePeerTile,
            getCall,
            getPeerIds,
            getSnapshot,
            getState,
            isSessionDisconnected: () => sessionDisconnected,
            replaceTrack,
            reset,
            setSessionDisconnected: (value) => {
                sessionDisconnected = Boolean(value);
            },
            teardown,
        };
    };

    global.VoicePeerRegistry = {
        createRegistry,
    };
})(window);
