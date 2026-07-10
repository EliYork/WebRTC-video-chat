const VOICE_PEER_ID_PATTERN = /^[A-Za-z0-9]+(?:[ _-][A-Za-z0-9]+)*$/;
const VOICE_PEER_ID_MAX_LENGTH = 128;

export const normalizeVoicePeerId = (peerId) => {
    const normalized = String(peerId || '').trim();

    if (
        !normalized ||
        normalized.length > VOICE_PEER_ID_MAX_LENGTH ||
        !VOICE_PEER_ID_PATTERN.test(normalized)
    ) {
        return undefined;
    }

    return normalized;
};

export const createVoiceCallSignaling = ({
    io,
    resolveRoomId,
    logger,
} = {}) => {
    const roomJoinQueues = new Map();

    const enqueueRoomJoin = (roomId, operation) => {
        const previous = roomJoinQueues.get(roomId) || Promise.resolve();
        const current = previous.catch(() => undefined).then(operation);

        roomJoinQueues.set(roomId, current);
        return current.finally(() => {
            if (roomJoinQueues.get(roomId) === current) {
                roomJoinQueues.delete(roomId);
            }
        });
    };

    const join = ({ roomId, peerId } = {}, socket) => {
        const ownedRoomId = resolveRoomId?.(roomId);
        const ownedPeerId = normalizeVoicePeerId(peerId);

        if (!ownedRoomId || !ownedPeerId || !socket) {
            return Promise.resolve({ ok: false, reason: 'invalid-voice-join' });
        }

        return enqueueRoomJoin(ownedRoomId, async () => {
            if (
                socket.data.voiceRoomId === ownedRoomId &&
                socket.data.voicePeerId === ownedPeerId
            ) {
                return { duplicate: true, ok: true, peerIds: [] };
            }

            if (
                socket.data.voiceRoomId &&
                socket.data.voiceRoomId !== ownedRoomId
            ) {
                return {
                    ok: false,
                    reason: 'leave-current-voice-room-first',
                };
            }

            const existingPeerIds = Array.from(
                new Set(
                    (await io.in(ownedRoomId).fetchSockets())
                        .filter(
                            (currentSocket) =>
                                currentSocket.id !== socket.id &&
                                currentSocket.data.voiceRoomId === ownedRoomId
                        )
                        .map((currentSocket) => currentSocket.data.voicePeerId)
                        .filter(Boolean)
                )
            );

            await socket.join(ownedRoomId);
            socket.data.voiceRoomId = ownedRoomId;
            socket.data.voicePeerId = ownedPeerId;
            socket.data.voiceCallRevision = 0;
            socket.emit('voice:call-targets', {
                roomId: ownedRoomId,
                peerIds: existingPeerIds,
            });

            return { ok: true, peerIds: existingPeerIds };
        }).catch((error) => {
            logger?.warn?.('[voice-call] join failed', error);
            return { ok: false, reason: 'voice-join-failed' };
        });
    };

    const requestRefresh = (socket) => {
        const roomId = resolveRoomId?.(socket?.data.voiceRoomId);
        const peerId = normalizeVoicePeerId(socket?.data.voicePeerId);

        if (!roomId || !peerId || roomId !== socket.data.voiceRoomId) {
            return { ok: false, reason: 'voice-owner-missing' };
        }

        const revision = Number(socket.data.voiceCallRevision || 0) + 1;
        socket.data.voiceCallRevision = revision;
        socket.to(roomId).emit('voice:refresh-peer', {
            peerId,
            revision,
            roomId,
        });

        return { ok: true, revision };
    };

    return {
        join,
        requestRefresh,
    };
};
