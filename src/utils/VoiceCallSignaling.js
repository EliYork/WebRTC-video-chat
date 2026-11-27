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
    authorizePeer = () => false,
} = {}) => {
    const roomJoinQueues = new Map();
    const peerOwners = new Map();
    const socketRevisions = new WeakMap();
    const codecFeedbackTimes = new WeakMap();
    const routePressureTimes = new WeakMap();
    const advanceRevision = (socket) => {
        const revision = (socketRevisions.get(socket) || 0) + 1;
        socketRevisions.set(socket, revision);
        return revision;
    };

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

    const ownedPeer = (id) => {
        const socket = peerOwners.get(id)?.socket;
        const owner = getVoiceOwner(socket);
        return !socket?.disconnected && owner?.peerId === id ? owner : undefined;
    };

    const publishScreenShare = (socket, { peerId, roomId, voiceSessionGeneration }, sharing) => {
        onScreenShareChange?.({ peerId, roomId, sharing, voiceSessionGeneration, socket });
        for (const member of io.sockets?.sockets?.values() || []) {
            const target = getVoiceOwner(member);
            if (member === socket || target?.roomId !== roomId) continue;
            member.emit('screen:share', {
                peerId,
                roomId,
                sharing,
                sourceVoiceSessionGeneration: voiceSessionGeneration,
                voiceSessionGeneration: target.voiceSessionGeneration,
            });
        }
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
        return [...new Set(roomSockets
            .filter(member => member.id !== socket.id && member.data.voiceRoomId === roomId)
            .map(member => member.data.voicePeerId)
            .filter(Boolean))];
    };

    const join = ({ clientSessionEpoch, roomId, peerId, peerToken } = {}, socket) => {
        const ownedRoomId = resolveRoomId?.(roomId);
        const ownedPeerId = normalizeVoicePeerId(peerId);
        const ownedClientEpoch =
            normalizeClientSessionEpoch(clientSessionEpoch);

        if (!ownedRoomId || !ownedPeerId || !socket) {
            return Promise.resolve({ ok: false, reason: 'invalid-voice-join' });
        }
        if (!authorizePeer(ownedPeerId, peerToken)) {
            return Promise.resolve({ ok: false, reason: 'voice-peer-unverified' });
        }
        const revision = advanceRevision(socket);
        const cancelled = () => socketRevisions.get(socket) !== revision;

        return enqueueRoomJoin(ownedRoomId, async () => {
            if (socket.disconnected === true) {
                return { ok: false, reason: 'socket-disconnected' };
            }
            if (cancelled()) return { ok: false, reason: 'voice-join-cancelled' };
            const existingPeerIds = await getPeerIds(ownedRoomId, socket);
            if (socket.disconnected === true) {
                return { ok: false, reason: 'socket-disconnected' };
            }
            if (cancelled()) return { ok: false, reason: 'voice-join-cancelled' };
            if (!authorizePeer(ownedPeerId, peerToken)) return { ok: false, reason: 'voice-peer-unverified' };
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

            if (peerOwners.has(ownedPeerId) && peerOwners.get(ownedPeerId).socket !== socket) {
                return { ok: false, reason: 'voice-peer-id-in-use' };
            }

            const replacedPeerId =
                socket.data.voiceRoomId === ownedRoomId &&
                socket.data.voicePeerId !== ownedPeerId
                    ? normalizeVoicePeerId(socket.data.voicePeerId)
                    : undefined;

            // Reserve the ID before joining. Joins in different rooms run concurrently.
            const claim = { socket };
            const alreadyInRoom = socket.rooms?.has(ownedRoomId);
            let admitted = false;
            peerOwners.set(ownedPeerId, claim);
            try {
                await socket.join(ownedRoomId);
                if (socket.disconnected === true || cancelled()) {
                    if (!alreadyInRoom) await socket.leave(ownedRoomId);
                    return { ok: false, reason: socket.disconnected ? 'socket-disconnected' : 'voice-join-cancelled' };
                }
                if (!authorizePeer(ownedPeerId, peerToken)) {
                    if (!alreadyInRoom) await socket.leave(ownedRoomId);
                    return { ok: false, reason: 'voice-peer-unverified' };
                }
                admitted = true;
            } finally {
                if (!admitted && peerOwners.get(ownedPeerId) === claim) peerOwners.delete(ownedPeerId);
            }

            if (replacedPeerId) {
                if (peerOwners.get(replacedPeerId)?.socket === socket) peerOwners.delete(replacedPeerId);
                if (socket.data.voiceScreenSharing === true) {
                    publishScreenShare(socket, {
                        peerId: replacedPeerId,
                        roomId: ownedRoomId,
                        voiceSessionGeneration: socket.data.voiceSessionGeneration,
                    }, false);
                }
                socket.to(ownedRoomId).emit('removeUserVideo', {
                    peerId: replacedPeerId,
                    roomId: ownedRoomId,
                });
            }

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
        const peerIds = await getPeerIds(owner.roomId, socket);
        const current = getVoiceOwner(socket);
        if (current?.voiceSessionGeneration !== owner.voiceSessionGeneration ||
            current.clientSessionEpoch !== owner.clientSessionEpoch) {
            return { ok: false, reason: 'voice-owner-changed' };
        }
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
        publishScreenShare(socket, owner, sharing);
        return { ok: true, sharing };
    };

    const leave = async (socket, { reason = 'voice-leave' } = {}) => {
        if (socket) advanceRevision(socket);
        const owner = getVoiceOwner(socket, { requireMembership: false });

        if (!owner) {
            return { duplicate: true, ok: true };
        }

        const { peerId, roomId } = owner;
        if (peerOwners.get(peerId)?.socket === socket) peerOwners.delete(peerId);
        if (socket.data.voiceScreenSharing === true) {
            socket.data.voiceScreenSharing = false;
            publishScreenShare(socket, owner, false);
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
        canRelay(sender, recipient) {
            if (sender === recipient) return false;
            const owner = ownedPeer(sender);
            return Boolean(owner && ownedPeer(recipient)?.roomId === owner.roomId);
        },
        relayRoutePressure(payload, socket) {
            const owner = getVoiceOwner(socket);
            if (!owner || socket.data.voiceScreenSharing !== true || payload?.voiceSessionGeneration !== owner.voiceSessionGeneration ||
                !['sender-encoder-pressure', 'sender-uplink-pressure'].includes(payload.reason)) return false;
            const previous = routePressureTimes.get(socket);
            if (previous !== undefined && Date.now() - previous < 5000) return false;
            routePressureTimes.set(socket, Date.now());
            for (const member of io.sockets?.sockets?.values() || []) {
                const target = getVoiceOwner(member);
                if (member === socket || target?.roomId !== owner.roomId) continue;
                member.emit('screen:route-pressure', { peerId: owner.peerId, roomId: owner.roomId,
                    voiceSessionGeneration: target.voiceSessionGeneration, reason: payload.reason });
            }
            return true;
        },
        relayCodecFeedback(payload, socket) {
            const owner = getVoiceOwner(socket);
            if (!owner || payload?.voiceSessionGeneration !== owner.voiceSessionGeneration ||
                payload.reason !== 'decoder-start-failed' || !Number.isSafeInteger(payload.generation) || payload.generation <= 0 ||
                !Number.isSafeInteger(payload.targetSessionGeneration) ||
                normalizeVoicePeerId(payload.peerId) !== payload.peerId) return false;
            const previous = codecFeedbackTimes.get(socket);
            if (previous !== undefined && Date.now() - previous < 1000) return false;
            const target = [...(io.sockets?.sockets?.values() || [])].find((member) => {
                const current = getVoiceOwner(member);
                return member !== socket && current?.roomId === owner.roomId && current.peerId === payload.peerId &&
                    current.voiceSessionGeneration === payload.targetSessionGeneration && member.data.voiceScreenSharing === true;
            });
            if (!target) return false;
            codecFeedbackTimes.set(socket, Date.now());
            target.emit('screen:codec-feedback', { peerId: owner.peerId, generation: payload.generation,
                reason: 'decoder-start-failed', voiceSessionGeneration: payload.targetSessionGeneration });
            return true;
        },
        getVoiceOwner,
        getSnapshot,
        join,
        leave,
        updateScreenShare,
    };
};
