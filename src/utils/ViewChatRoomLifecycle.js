const VIEW_CHAT_SOCKET_ROOM_PREFIX = 'view-chat:';

export const getViewChatSocketRoom = (roomId) =>
    `${VIEW_CHAT_SOCKET_ROOM_PREFIX}${roomId}`;

const getOwnedViewChatRoomIds = (socket) =>
    new Set(
        [socket?.data?.viewRoomId, socket?.data?.chatRoomId].filter(Boolean)
    );

export const emitViewCursorRemove = (
    socket,
    roomId = socket?.data?.viewRoomId
) => {
    if (!socket || !roomId) {
        return false;
    }

    socket.to(getViewChatSocketRoom(roomId)).emit('cursor:remove', {
        roomId,
        socketId: socket.id,
    });
    return true;
};

const performViewChatRoomSwitch = async (
    socket,
    nextRoomId,
    { isAllowedRoomId = () => true } = {}
) => {
    if (
        !socket ||
        socket.disconnected === true ||
        !nextRoomId ||
        !isAllowedRoomId(nextRoomId)
    ) {
        return { changed: false, roomId: undefined, valid: false };
    }

    const previousViewRoomId = socket.data.viewRoomId;
    const previousRoomIds = getOwnedViewChatRoomIds(socket);
    const previousSocketRooms = new Set(
        Array.from(previousRoomIds, getViewChatSocketRoom)
    );
    const nextSocketRoom = getViewChatSocketRoom(nextRoomId);
    const nextSocketRooms = new Set([nextSocketRoom]);

    if (previousViewRoomId && previousViewRoomId !== nextRoomId) {
        emitViewCursorRemove(socket, previousViewRoomId);
    }

    await Promise.all(
        Array.from(previousSocketRooms)
            .filter((room) => !nextSocketRooms.has(room))
            .map((room) => socket.leave(room))
    );

    if (!socket.rooms.has(nextSocketRoom)) {
        await socket.join(nextSocketRoom);
    }

    if (socket.disconnected === true) {
        await socket.leave(nextSocketRoom);
        return { changed: false, roomId: undefined, valid: false };
    }

    socket.data.viewRoomId = nextRoomId;
    socket.data.chatRoomId = nextRoomId;

    return {
        changed:
            previousViewRoomId !== nextRoomId ||
            previousRoomIds.size !== 1 ||
            !previousRoomIds.has(nextRoomId),
        roomId: nextRoomId,
        valid: true,
    };
};

// Async adapters can yield during leave/join. Serialize each socket's changes
// so a later request sees the preceding owner, never an obsolete snapshot.
const roomTransitions = new WeakMap();
export const switchViewChatRoom = (socket, nextRoomId, options) => {
    if (!socket) return Promise.resolve({ changed: false, valid: false });
    const pending = roomTransitions.get(socket) || Promise.resolve();
    const transition = pending
        .catch(() => {})
        .then(() => performViewChatRoomSwitch(socket, nextRoomId, options));
    roomTransitions.set(socket, transition);
    const cleanup = () => {
        if (roomTransitions.get(socket) === transition)
            roomTransitions.delete(socket);
    };
    transition.then(cleanup, cleanup);
    return transition;
};

export const resolveOwnedViewChatRoom = (socket, requestedRoomId, ownerKey) => {
    const roomId = socket?.data?.[ownerKey];

    if (!roomId || (requestedRoomId && requestedRoomId !== roomId)) {
        return null;
    }

    const socketRoom = getViewChatSocketRoom(roomId);
    if (!socket.rooms.has(socketRoom)) {
        return null;
    }

    return { roomId, socketRoom };
};
