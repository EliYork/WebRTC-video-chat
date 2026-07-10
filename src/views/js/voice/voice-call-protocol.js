(function exposeVoiceCallProtocol(global) {
    'use strict';

    const REFRESH_METADATA_FLAG = 'voiceCallRefresh';
    const REFRESH_METADATA_KEY = 'voiceCallRefreshKey';

    const createRefreshRevisionGate = () => {
        const revisions = new Map();

        const apply = (peerId, revision, operation) => {
            const normalizedRevision = Number(revision);
            const previousRevision = revisions.get(peerId) || 0;

            if (
                !peerId ||
                !Number.isInteger(normalizedRevision) ||
                normalizedRevision <= previousRevision
            ) {
                return undefined;
            }

            const result = operation?.();
            if (result) {
                revisions.set(peerId, normalizedRevision);
            }
            return result;
        };

        return {
            apply,
            releasePeer: (peerId) => revisions.delete(peerId),
            reset: () => revisions.clear(),
        };
    };

    const createCallGate = ({ onStream, onWarning } = {}) => {
        const entries = new Map();
        let boundCalls = new WeakSet();

        const warn = (message, error) => onWarning?.(message, error);

        const releasePeer = (peerId, expectedCall) => {
            const entry = entries.get(peerId);

            if (!entry || (expectedCall && entry.call !== expectedCall)) {
                return false;
            }

            entries.delete(peerId);
            return true;
        };

        const bindCall = (call, peerId) => {
            if (!call || boundCalls.has(call)) {
                return;
            }

            boundCalls.add(call);
            call.on('stream', (stream) => onStream?.({ call, peerId, stream }));
            call.on('close', () => releasePeer(peerId, call));
            call.on('error', () => releasePeer(peerId, call));
        };

        const activateCall = ({ call, direction, peerId, refreshKey }) => {
            entries.set(peerId, {
                call,
                direction,
                refreshKey,
                state: 'active',
            });
            bindCall(call, peerId);
            return call;
        };

        const callPeer = ({
            peer,
            peerId,
            stream,
            options = {},
            refreshKey,
        } = {}) => {
            if (!peer || !peerId || !stream) {
                return undefined;
            }

            const existing = entries.get(peerId);
            const refreshing = refreshKey !== undefined;

            if (existing) {
                if (
                    !refreshing ||
                    existing.direction !== 'outgoing' ||
                    existing.refreshKey === refreshKey
                ) {
                    return existing.state === 'active'
                        ? existing.call
                        : undefined;
                }

                existing.call?.close?.();
                releasePeer(peerId, existing.call);
            }

            const pendingToken = {};
            entries.set(peerId, {
                call: pendingToken,
                direction: 'outgoing',
                refreshKey,
                state: 'pending',
            });

            let call;
            try {
                const metadata = refreshing
                    ? {
                          ...options.metadata,
                          [REFRESH_METADATA_FLAG]: true,
                          [REFRESH_METADATA_KEY]: refreshKey,
                      }
                    : options.metadata;
                call = peer.call(peerId, stream, {
                    ...options,
                    metadata,
                });
            } catch (error) {
                releasePeer(peerId, pendingToken);
                warn(`Could not call peer ${peerId}.`, error);
                return undefined;
            }

            if (!call) {
                releasePeer(peerId, pendingToken);
                warn(`Peer call for ${peerId} returned no MediaConnection.`);
                return undefined;
            }

            try {
                return activateCall({
                    call,
                    direction: 'outgoing',
                    peerId,
                    refreshKey,
                });
            } catch (error) {
                releasePeer(peerId, call);
                call.close?.();
                warn(`Could not bind outgoing call for ${peerId}.`, error);
                return undefined;
            }
        };

        const answerCall = ({ call, stream } = {}) => {
            const peerId = call?.peer;
            if (!call || !peerId || !stream) {
                call?.close?.();
                return undefined;
            }

            const existing = entries.get(peerId);
            const refreshing = call.metadata?.[REFRESH_METADATA_FLAG] === true;
            const refreshKey = call.metadata?.[REFRESH_METADATA_KEY];

            if (existing) {
                if (existing.call === call) {
                    return call;
                }

                if (
                    !refreshing ||
                    existing.direction !== 'incoming' ||
                    existing.refreshKey === refreshKey
                ) {
                    call.close?.();
                    return existing.call;
                }

                existing.call?.close?.();
                releasePeer(peerId, existing.call);
            }

            const pendingToken = {};
            entries.set(peerId, {
                call: pendingToken,
                direction: 'incoming',
                refreshKey,
                state: 'pending',
            });

            try {
                activateCall({
                    call,
                    direction: 'incoming',
                    peerId,
                    refreshKey,
                });
                call.answer(stream);
                return call;
            } catch (error) {
                releasePeer(peerId, call);
                call.close?.();
                warn(`Could not answer peer ${peerId}.`, error);
                return undefined;
            }
        };

        const getCall = (peerId) => entries.get(peerId)?.call;

        const closePeer = (peerId) => {
            const call = getCall(peerId);
            if (!call) {
                return false;
            }

            call.close?.();
            releasePeer(peerId, call);
            return true;
        };

        const getPeerIds = ({ direction } = {}) =>
            Array.from(entries.entries())
                .filter(
                    ([, entry]) =>
                        entry.state === 'active' &&
                        (!direction || entry.direction === direction)
                )
                .map(([peerId]) => peerId);

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

        const reset = () => {
            entries.clear();
            boundCalls = new WeakSet();
        };

        return {
            answerCall,
            callPeer,
            closePeer,
            getCall,
            getPeerIds,
            getState,
            releasePeer,
            replaceTrack,
            reset,
        };
    };

    global.VoiceCallProtocol = {
        REFRESH_METADATA_FLAG,
        REFRESH_METADATA_KEY,
        createCallGate,
        createRefreshRevisionGate,
    };
})(window);
