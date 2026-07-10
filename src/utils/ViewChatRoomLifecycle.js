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

export const switchViewChatRoom = async (
    socket,
    nextRoomId,
    { isAllowedRoomId = () => true } = {}
) => {
    if (!socket || !nextRoomId || !isAllowedRoomId(nextRoomId)) {
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
