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
    onScreenShareChange,
} = {}) => {
    const roomJoinQueues = new Map();

    const normalizeClientSessionEpoch = (value) => {
        const epoch = Number(value);
        return Number.isInteger(epoch) && epoch > 0 ? epoch : undefined;
    };

    const getVoiceOwner = (socket, { requireMembership = true } = {}) => {
        const roomId = resolveRoomId?.(socket?.data.voiceRoomId);
        const peerId = normalizeVoicePeerId(socket?.data.voicePeerId);
        const voiceSessionGeneration = Number(
            socket?.data.voiceSessionGeneration
        );

        if (
            !socket ||
            !roomId ||
            !peerId ||
            roomId !== socket.data.voiceRoomId ||
            !Number.isInteger(voiceSessionGeneration) ||
            voiceSessionGeneration <= 0 ||
            (requireMembership && !socket.rooms?.has(roomId))
        ) {
            return undefined;
        }

        return {
            clientSessionEpoch: normalizeClientSessionEpoch(
                socket.data.voiceClientSessionEpoch
            ),
            peerId,
            roomId,
            voiceSessionGeneration,
        };
    };

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

    const getPeerIds = async (roomId, socket) => {
        const roomSockets = await io.in(roomId).fetchSockets();
        return {
            peerIds: Array.from(
                new Set(
                    roomSockets
                        .filter(
                            (currentSocket) =>
                                currentSocket.id !== socket.id &&
                                currentSocket.data.voiceRoomId === roomId
                        )
                        .map((currentSocket) => currentSocket.data.voicePeerId)
                        .filter(Boolean)
                )
            ),
            roomSockets,
        };
    };

    const join = ({ clientSessionEpoch, roomId, peerId } = {}, socket) => {
        const ownedRoomId = resolveRoomId?.(roomId);
        const ownedPeerId = normalizeVoicePeerId(peerId);
        const ownedClientEpoch =
            normalizeClientSessionEpoch(clientSessionEpoch);

        if (!ownedRoomId || !ownedPeerId || !socket) {
            return Promise.resolve({ ok: false, reason: 'invalid-voice-join' });
        }

        return enqueueRoomJoin(ownedRoomId, async () => {
            const { peerIds: existingPeerIds, roomSockets } = await getPeerIds(
                ownedRoomId,
                socket
            );
            if (
                socket.data.voiceRoomId === ownedRoomId &&
                socket.data.voicePeerId === ownedPeerId &&
                socket.rooms?.has(ownedRoomId)
            ) {
                if (ownedClientEpoch) {
                    socket.data.voiceClientSessionEpoch = ownedClientEpoch;
                }
                return {
                    duplicate: true,
                    ok: true,
                    peerIds: existingPeerIds,
                    voiceSessionGeneration: socket.data.voiceSessionGeneration,
                };
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

            if (
                roomSockets.some(
                    (currentSocket) =>
                        currentSocket.id !== socket.id &&
                        currentSocket.data.voiceRoomId === ownedRoomId &&
                        currentSocket.data.voicePeerId === ownedPeerId
                )
            ) {
                return { ok: false, reason: 'voice-peer-id-in-use' };
            }

            const replacedPeerId =
                socket.data.voiceRoomId === ownedRoomId &&
                socket.data.voicePeerId !== ownedPeerId
                    ? normalizeVoicePeerId(socket.data.voicePeerId)
                    : undefined;

            if (replacedPeerId) {
                if (socket.data.voiceScreenSharing === true) {
                    const event = {
                        peerId: replacedPeerId,
                        roomId: ownedRoomId,
                        sharing: false,
                        voiceSessionGeneration:
                            socket.data.voiceSessionGeneration,
                    };
                    onScreenShareChange?.({ ...event, socket });
                    socket.to(ownedRoomId).emit('screen:share', event);
                }
                socket.to(ownedRoomId).emit('removeUserVideo', {
                    peerId: replacedPeerId,
                    roomId: ownedRoomId,
                });
            }

            await socket.join(ownedRoomId);
            const voiceSessionGeneration =
                Number(socket.data.voiceSessionGeneration || 0) + 1;
            socket.data.voiceRoomId = ownedRoomId;
            socket.data.voicePeerId = ownedPeerId;
            socket.data.voiceScreenSharing = false;
            socket.data.voiceSessionGeneration = voiceSessionGeneration;
            if (ownedClientEpoch) {
                socket.data.voiceClientSessionEpoch = ownedClientEpoch;
            } else {
                delete socket.data.voiceClientSessionEpoch;
            }
            const targetEvent = {
                roomId: ownedRoomId,
                peerIds: existingPeerIds,
                voiceSessionGeneration,
            };
            if (ownedClientEpoch) {
                targetEvent.clientSessionEpoch = ownedClientEpoch;
            }
            socket.emit('voice:call-targets', targetEvent);
            socket.to(ownedRoomId).emit('voice:peer-joined', {
                peerId: ownedPeerId,
                roomId: ownedRoomId,
            });

            return {
                ok: true,
                peerIds: existingPeerIds,
                voiceSessionGeneration,
            };
        }).catch((error) => {
            logger?.warn?.('[voice-call] join failed', error);
            return { ok: false, reason: 'voice-join-failed' };
        });
    };

    const getSnapshot = async (socket) => {
        const owner = getVoiceOwner(socket);
        if (!owner) {
            return { ok: false, reason: 'voice-owner-missing' };
        }
        const { peerIds } = await getPeerIds(owner.roomId, socket);
        return { ok: true, peerIds, ...owner };
    };

    const updateScreenShare = (
        { sharing, voiceSessionGeneration } = {},
        socket
    ) => {
        const owner = getVoiceOwner(socket);
        if (!owner) {
            return { ok: false, reason: 'voice-owner-missing' };
        }
        if (
            typeof sharing !== 'boolean' ||
            !Number.isInteger(voiceSessionGeneration) ||
            voiceSessionGeneration !== owner.voiceSessionGeneration
        ) {
            return { ok: false, reason: 'invalid-screen-share-state' };
        }
        if (socket.data.voiceScreenSharing === sharing) {
            return { duplicate: true, ok: true, sharing };
        }

        socket.data.voiceScreenSharing = sharing;
        const event = {
            peerId: owner.peerId,
            roomId: owner.roomId,
            sharing,
            voiceSessionGeneration: owner.voiceSessionGeneration,
        };
        onScreenShareChange?.({ ...event, socket });
        socket.to(owner.roomId).emit('screen:share', event);
        return { ok: true, sharing };
    };

    const leave = async (socket, { reason = 'voice-leave' } = {}) => {
        const owner = getVoiceOwner(socket, { requireMembership: false });

        if (!owner) {
            return { duplicate: true, ok: true };
        }

        const { peerId, roomId } = owner;
        if (socket.data.voiceScreenSharing === true) {
            socket.data.voiceScreenSharing = false;
            const event = {
                peerId,
                roomId,
                sharing: false,
                voiceSessionGeneration: owner.voiceSessionGeneration,
            };
            onScreenShareChange?.({ ...event, socket });
            socket.to(roomId).emit('screen:share', event);
        }

        delete socket.data.voiceRoomId;
        delete socket.data.voicePeerId;
        delete socket.data.voiceScreenSharing;
        delete socket.data.voiceClientSessionEpoch;

        socket.to(roomId).emit('removeUserVideo', { peerId, roomId });
        await socket.leave?.(roomId);
        return { ok: true, peerId, reason, roomId };
    };

    return {
        getVoiceOwner,
        getSnapshot,
        join,
        leave,
        updateScreenShare,
    };
};
