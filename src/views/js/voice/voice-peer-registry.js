(function exposeVoicePeerRegistry(global) {
    'use strict';

    const protocol = global.VoiceCallProtocol || {};
    const {
        MEDIA_DIRECTION_METADATA = 'voiceMediaDirection',
        MEDIA_GENERATION_METADATA = 'voiceMediaGeneration',
        MEDIA_KINDS_METADATA = 'voiceMediaKinds',
        SEND_DIRECTION = 'send',
    } = protocol;

    const isCall = (value) => Boolean(value && typeof value.on === 'function');
    const isGeneration = (value) =>
        Number.isInteger(Number(value)) && Number(value) > 0;
    const getLiveTracks = (stream) =>
        (stream?.getTracks?.() || []).filter(
            (track) => track?.readyState !== 'ended'
        );

    const createRegistry = ({
        attachRemoteStream,
        createRemoteStream,
        detachRemoteStream,
        onDebug,
        onPeerCleanup,
        onRemoteMediaState,
        onWarning,
        removeRemoteTile,
    } = {}) => {
        const entries = new Map();
        let closedCalls = new WeakSet();
        let sessionDisconnected = false;

        const warn = (message, error) => onWarning?.(message, error);
        const debug = (event) => onDebug?.(event);

        const createDirectionState = () => ({
            current: null,
            pending: null,
        });

        const createEntry = (peerId) => ({
            callListeners: new Map(),
            cleanupGeneration: 0,
            incoming: createDirectionState(),
            lastIncomingGeneration: 0,
            lastIncomingStream: null,
            lastOutgoingGeneration: 0,
            outgoing: createDirectionState(),
            outgoingCreatingGeneration: 0,
            peerId,
            remoteStream: null,
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

        const unbindCall = (entry, record) => {
            const listeners = entry?.callListeners.get(record?.call);
            if (!listeners) {
                return;
            }

            listeners.forEach(({ event, listener, target, type }) => {
                if (type === 'event-target') {
                    target?.removeEventListener?.(event, listener);
                } else {
                    removeEmitterListener(target, event, listener);
                }
            });
            entry.callListeners.delete(record.call);
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

        const retireRecord = (entry, record, { close = true } = {}) => {
            if (!record) {
                return;
            }
            unbindCall(entry, record);
            if (close) {
                closeCallOnce(record.call);
            }
        };

        const detachStreamListeners = (entry) => {
            entry.streamListeners.forEach(({ event, listener, target }) =>
                target?.removeEventListener?.(event, listener)
            );
            entry.streamListeners = [];
        };

        const addStreamListener = (entry, target, event, listener) => {
            if (typeof target?.addEventListener !== 'function') {
                return;
            }
            target.addEventListener(event, listener);
            entry.streamListeners.push({ event, listener, target });
        };

        const getDirectionState = (entry, direction) => entry[direction];
        const isOwnedRecord = (entry, direction, record) => {
            const state = getDirectionState(entry, direction);
            return state.current === record || state.pending === record;
        };

        const notifyState = (entry, reason) =>
            onRemoteMediaState?.({
                incomingState:
                    entry.incoming.current?.state ||
                    entry.incoming.pending?.state ||
                    'idle',
                outgoingState:
                    entry.outgoing.current?.state ||
                    entry.outgoing.pending?.state ||
                    'idle',
                peerId: entry.peerId,
                reason,
                stream: entry.remoteStream,
                tile: entry.tile,
            });

        const clearRemoteMedia = (entry, reason) => {
            const stream = entry.remoteStream;
            detachStreamListeners(entry);
            entry.lastIncomingStream = null;
            entry.remoteStream = null;
            try {
                detachRemoteStream?.({
                    peerId: entry.peerId,
                    reason,
                    stream,
                    tile: entry.tile,
                });
            } catch (error) {
                warn(
                    `Could not detach remote stream for ${entry.peerId}.`,
                    error
                );
            }
            notifyState(entry, reason);
        };

        const bindRemoteStream = (entry, stream, generation, metadata) => {
            const isCurrent = () =>
                entries.get(entry.peerId) === entry &&
                entry.remoteStream === stream &&
                entry.incoming.current?.generation === generation;

            addStreamListener(entry, stream, 'inactive', () => {
                if (isCurrent()) {
                    clearRemoteMedia(entry, 'stream-inactive');
                }
            });

            stream?.getTracks?.().forEach((track) => {
                addStreamListener(entry, track, 'ended', () => {
                    if (!isCurrent()) {
                        return;
                    }

                    stream.removeTrack?.(track);
                    const liveTracks = getLiveTracks(stream);
                    if (liveTracks.length === 0) {
                        clearRemoteMedia(entry, 'all-tracks-ended');
                        return;
                    }

                    entry.tile =
                        attachRemoteStream?.({
                            generation,
                            metadata,
                            peerId: entry.peerId,
                            stream,
                            tile: entry.tile,
                        }) || entry.tile;
                    notifyState(entry, `${track.kind || 'remote'}-track-ended`);
                });
            });
        };

        const promoteOutgoing = (entry, record, reason) => {
            if (!isOwnedRecord(entry, 'outgoing', record)) {
                return false;
            }

            record.state = 'active';
            debug({
                direction: 'outgoing',
                event: reason,
                generation: record.generation,
                peerId: entry.peerId,
            });
            return true;
        };

        const registerRemoteStream = (entry, record, incomingStream) => {
            if (
                !incomingStream ||
                !isOwnedRecord(entry, 'incoming', record) ||
                (entry.incoming.current === record &&
                    entry.lastIncomingStream === incomingStream)
            ) {
                return false;
            }

            let nextStream;
            try {
                nextStream =
                    createRemoteStream?.({
                        currentStream: entry.remoteStream,
                        incomingStream,
                        peerId: entry.peerId,
                        replaceAll: true,
                    }) || incomingStream;

                detachStreamListeners(entry);
                entry.remoteStream = nextStream;
                entry.lastIncomingStream = incomingStream;
                record.state = 'active';
                bindRemoteStream(
                    entry,
                    nextStream,
                    record.generation,
                    record.call?.metadata
                );
                entry.tile =
                    attachRemoteStream?.({
                        generation: record.generation,
                        metadata: record.call?.metadata,
                        peerId: entry.peerId,
                        stream: nextStream,
                        tile: entry.tile,
                    }) || entry.tile;
            } catch (error) {
                warn(
                    `Could not attach remote stream for ${entry.peerId}.`,
                    error
                );
                handleCallTerminal(entry, 'incoming', record, 'stream-error');
                return false;
            }

            debug({
                direction: 'incoming',
                event: 'remote-stream',
                generation: record.generation,
                peerId: entry.peerId,
                tracks: getLiveTracks(nextStream).map(({ kind }) => kind),
            });
            notifyState(entry, 'stream');
            return true;
        };

        const handleCallTerminal = (
            entry,
            direction,
            record,
            reason,
            error
        ) => {
            if (!entry || !isOwnedRecord(entry, direction, record)) {
                return;
            }

            const state = getDirectionState(entry, direction);
            const wasPending = state.pending === record;
            unbindCall(entry, record);
            if (reason === 'call-error' || reason === 'stream-error') {
                closeCallOnce(record.call);
            }

            if (wasPending) {
                state.pending = null;
            } else {
                state.current = null;
                if (state.pending) {
                    state.current = state.pending;
                    state.pending = null;
                }
            }

            if (direction === 'incoming' && !state.current) {
                clearRemoteMedia(entry, reason);
            }

            debug({
                direction,
                error: error?.name || undefined,
                event: reason,
                generation: record.generation,
                peerId: entry.peerId,
            });
        };

        const bindCall = (entry, direction, record) => {
            const call = record.call;
            const listeners = [
                {
                    event: 'stream',
                    listener: (stream) => {
                        if (direction === 'incoming') {
                            registerRemoteStream(entry, record, stream);
                        }
                    },
                    target: call,
                    type: 'emitter',
                },
                {
                    event: 'close',
                    listener: () =>
                        handleCallTerminal(
                            entry,
                            direction,
                            record,
                            'call-close'
                        ),
                    target: call,
                    type: 'emitter',
                },
                {
                    event: 'error',
                    listener: (error) =>
                        handleCallTerminal(
                            entry,
                            direction,
                            record,
                            'call-error',
                            error
                        ),
                    target: call,
                    type: 'emitter',
                },
            ];

            const peerConnection = call.peerConnection;
            if (typeof peerConnection?.addEventListener === 'function') {
                const handleConnectionState = () => {
                    debug({
                        connection:
                            protocol.describePeerConnection?.(peerConnection),
                        direction,
                        event: 'connection-state',
                        generation: record.generation,
                        peerId: entry.peerId,
                    });

                    if (
                        direction === 'outgoing' &&
                        (peerConnection.connectionState === 'connected' ||
                            peerConnection.iceConnectionState === 'connected' ||
                            peerConnection.iceConnectionState === 'completed')
                    ) {
                        promoteOutgoing(entry, record, 'connected');
                    }
                };

                ['connectionstatechange', 'iceconnectionstatechange'].forEach(
                    (event) => {
                        peerConnection.addEventListener(
                            event,
                            handleConnectionState
                        );
                        listeners.push({
                            event,
                            listener: handleConnectionState,
                            target: peerConnection,
                            type: 'event-target',
                        });
                    }
                );
            }

            entry.callListeners.set(call, listeners);
            listeners
                .filter(({ type }) => type === 'emitter')
                .forEach(({ event, listener, target }) =>
                    target.on(event, listener)
                );
        };

        const callPeer = ({
            generation,
            options = {},
            peer,
            peerId,
            stream,
        } = {}) => {
            const normalizedGeneration = Number(generation);
            const tracks = getLiveTracks(stream);
            if (
                sessionDisconnected ||
                !peer ||
                !peerId ||
                !isGeneration(normalizedGeneration)
            ) {
                return undefined;
            }

            if (tracks.length === 0) {
                stopOutgoing(peerId, {
                    generation: normalizedGeneration,
                    reason: 'local-no-media',
                });
                return undefined;
            }

            const entry = ensureEntry(peerId);
            if (
                normalizedGeneration <= entry.lastOutgoingGeneration ||
                entry.outgoingCreatingGeneration
            ) {
                return (
                    entry.outgoing.pending?.call ||
                    entry.outgoing.current?.call ||
                    undefined
                );
            }

            entry.outgoingCreatingGeneration = normalizedGeneration;
            let call;
            try {
                const metadata = {
                    ...options.metadata,
                    [MEDIA_DIRECTION_METADATA]: SEND_DIRECTION,
                    [MEDIA_GENERATION_METADATA]: normalizedGeneration,
                    [MEDIA_KINDS_METADATA]: tracks.map(({ kind }) => kind),
                };
                call = peer.call(peerId, stream, { ...options, metadata });
            } catch (error) {
                warn(`Could not call peer ${peerId}.`, error);
                return undefined;
            } finally {
                entry.outgoingCreatingGeneration = 0;
            }

            if (!isCall(call)) {
                warn(`Peer call for ${peerId} returned no MediaConnection.`);
                return undefined;
            }

            const record = {
                call,
                generation: normalizedGeneration,
                state: 'pending',
            };
            const previousCurrent = entry.outgoing.current;
            const previousPending = entry.outgoing.pending;
            entry.outgoing.current = record;
            entry.outgoing.pending = null;
            entry.lastOutgoingGeneration = normalizedGeneration;
            bindCall(entry, 'outgoing', record);
            retireRecord(entry, previousPending);
            retireRecord(entry, previousCurrent);

            debug({
                direction: 'outgoing',
                event: 'offer-start',
                generation: normalizedGeneration,
                peerId,
                tracks: tracks.map(({ kind }) => kind),
            });
            return call;
        };

        const replaceOutgoingTracks = async ({
            generation,
            peerId,
            stream,
        } = {}) => {
            const entry = entries.get(peerId);
            const record = entry?.outgoing.current;
            const normalizedGeneration = Number(generation);
            const peerConnection =
                record?.call?.peerConnection || record?.call?._pc;
            const senders = peerConnection?.getSenders?.() || [];
            if (
                sessionDisconnected ||
                !record ||
                !isGeneration(normalizedGeneration) ||
                normalizedGeneration <= entry.lastOutgoingGeneration ||
                senders.some(
                    (sender) => typeof sender?.replaceTrack !== 'function'
                )
            ) {
                return { ok: false, reason: 'replacement-unavailable' };
            }

            const nextTracksByKind = new Map();
            getLiveTracks(stream).forEach((track) => {
                const tracks = nextTracksByKind.get(track.kind) || [];
                tracks.push(track);
                nextTracksByKind.set(track.kind, tracks);
            });
            const senderSlotsByKind = new Map();
            senders.forEach((sender) => {
                const kind = sender.track?.kind || sender.__voiceTrackKind;
                if (!kind) {
                    return;
                }
                sender.__voiceTrackKind = kind;
                const slots = senderSlotsByKind.get(kind) || [];
                slots.push(sender);
                senderSlotsByKind.set(kind, slots);
            });
            if (
                Array.from(nextTracksByKind).some(
                    ([kind, tracks]) =>
                        tracks.length >
                        (senderSlotsByKind.get(kind)?.length || 0)
                )
            ) {
                return { ok: false, reason: 'renegotiation-required' };
            }

            await Promise.all(
                Array.from(senderSlotsByKind).flatMap(([kind, slots]) => {
                    const tracks = nextTracksByKind.get(kind) || [];
                    return slots.map((sender, index) =>
                        sender.replaceTrack(tracks[index] || null)
                    );
                })
            );
            record.generation = normalizedGeneration;
            entry.lastOutgoingGeneration = normalizedGeneration;
            debug({
                direction: 'outgoing',
                event: 'tracks-replaced',
                generation: normalizedGeneration,
                peerId,
                tracks: getLiveTracks(stream).map(({ kind }) => kind),
            });
            return { ok: true };
        };

        const answerCall = ({ call } = {}) => {
            const peerId = call?.peer;
            const generation = Number(
                call?.metadata?.[MEDIA_GENERATION_METADATA]
            );
            const direction = call?.metadata?.[MEDIA_DIRECTION_METADATA];
            if (
                sessionDisconnected ||
                !isCall(call) ||
                !peerId ||
                direction !== SEND_DIRECTION ||
                !isGeneration(generation)
            ) {
                closeCallOnce(call);
                return undefined;
            }

            const entry = ensureEntry(peerId);
            if (generation <= entry.lastIncomingGeneration) {
                closeCallOnce(call);
                return (
                    entry.incoming.pending?.call ||
                    entry.incoming.current?.call ||
                    undefined
                );
            }

            const record = { call, generation, state: 'pending' };
            const previousCurrent = entry.incoming.current;
            const previousPending = entry.incoming.pending;
            entry.incoming.current = record;
            entry.incoming.pending = null;

            try {
                bindCall(entry, 'incoming', record);
                call.answer();
            } catch (error) {
                unbindCall(entry, record);
                entry.incoming.current = previousCurrent;
                entry.incoming.pending = previousPending;
                closeCallOnce(call);
                warn(`Could not answer peer ${peerId}.`, error);
                return undefined;
            }

            entry.lastIncomingGeneration = generation;
            retireRecord(entry, previousPending);
            retireRecord(entry, previousCurrent);
            debug({
                direction: 'incoming',
                event: 'answer-receive-only',
                generation,
                offeredKinds: call.metadata?.[MEDIA_KINDS_METADATA] || [],
                peerId,
            });
            return call;
        };

        const stopOutgoing = (
            peerId,
            { generation, reason = 'stop-outgoing' } = {}
        ) => {
            const entry = entries.get(peerId);
            if (!entry) {
                return false;
            }

            const normalizedGeneration = Number(generation);
            if (isGeneration(normalizedGeneration)) {
                if (normalizedGeneration < entry.lastOutgoingGeneration) {
                    return false;
                }
                entry.lastOutgoingGeneration = normalizedGeneration;
            }

            const records = [
                entry.outgoing.pending,
                entry.outgoing.current,
            ].filter(Boolean);
            entry.outgoing.pending = null;
            entry.outgoing.current = null;
            records.forEach((record) => retireRecord(entry, record));
            debug({
                direction: 'outgoing',
                event: reason,
                generation: entry.lastOutgoingGeneration,
                peerId,
            });
            return records.length > 0;
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
                        replaceAll: true,
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

        const cleanupPeer = (peerId, reason = 'cleanup') => {
            const entry = entries.get(peerId);
            if (!entry) {
                return false;
            }

            entry.cleanupGeneration += 1;
            [entry.incoming, entry.outgoing].forEach((state) => {
                retireRecord(entry, state.pending);
                retireRecord(entry, state.current);
                state.pending = null;
                state.current = null;
            });
            detachStreamListeners(entry);

            try {
                detachRemoteStream?.({
                    peerId,
                    reason,
                    stream: entry.remoteStream,
                    tile: entry.tile,
                });
            } catch (error) {
                warn(`Could not detach remote stream for ${peerId}.`, error);
            }
            try {
                removeRemoteTile?.({ peerId, reason, tile: entry.tile });
            } catch (error) {
                warn(`Could not remove remote tile for ${peerId}.`, error);
            }

            entries.delete(peerId);
            onPeerCleanup?.({ peerId, reason });
            debug({ event: 'peer-cleanup', peerId, reason });
            return true;
        };

        const getPeerIds = ({ direction } = {}) =>
            Array.from(entries.values())
                .filter((entry) => {
                    if (direction === 'incoming' || direction === 'outgoing') {
                        const state = entry[direction];
                        return Boolean(state.current || state.pending);
                    }
                    return Boolean(
                        entry.incoming.current ||
                            entry.incoming.pending ||
                            entry.outgoing.current ||
                            entry.outgoing.pending
                    );
                })
                .map(({ peerId }) => peerId);

        const getState = (peerId) => {
            const entry = entries.get(peerId);
            return entry
                ? {
                      incoming:
                          entry.incoming.pending?.state ||
                          entry.incoming.current?.state ||
                          'idle',
                      outgoing:
                          entry.outgoing.pending?.state ||
                          entry.outgoing.current?.state ||
                          'idle',
                  }
                : undefined;
        };

        const getQualitySource = (peerId) => {
            const entry = entries.get(peerId);
            const incoming = entry?.incoming.current;
            return entry
                ? {
                      call: incoming?.call,
                      generation:
                          incoming?.generation || entry.lastIncomingGeneration,
                      pc: incoming?.call?.peerConnection || incoming?.call?._pc,
                      peerId,
                      stream: entry.remoteStream,
                      tile: entry.tile,
                  }
                : undefined;
        };

        const getSnapshot = (peerId) => {
            const entry = entries.get(peerId);
            return entry
                ? {
                      cleanupGeneration: entry.cleanupGeneration,
                      incomingCall: entry.incoming.current?.call,
                      incomingGeneration: entry.lastIncomingGeneration,
                      incomingPendingCall: entry.incoming.pending?.call,
                      outgoingCall: entry.outgoing.current?.call,
                      outgoingGeneration: entry.lastOutgoingGeneration,
                      outgoingPendingCall: entry.outgoing.pending?.call,
                      peerId,
                      remoteStream: entry.remoteStream,
                      state: getState(peerId),
                      tile: entry.tile,
                  }
                : undefined;
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
            getPeerIds,
            getQualitySource,
            getSnapshot,
            getState,
            isSessionDisconnected: () => sessionDisconnected,
            reset,
            replaceOutgoingTracks,
            setSessionDisconnected: (value) => {
                sessionDisconnected = Boolean(value);
            },
            stopOutgoing,
            teardown,
        };
    };

    global.VoicePeerRegistry = {
        createRegistry,
    };
})(window);
