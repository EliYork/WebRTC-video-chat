(function exposeVoiceChatSocketTransport(global) {
    'use strict';

    const createChatSocketTransport = ({ getSocket } = {}) => {
        if (typeof getSocket !== 'function') {
            throw new TypeError('Chat transport requires getSocket().');
        }

        const queuedJoinRoomIds = [];
        let inFlightJoinRoomId;
        const getActiveSocket = () => {
            const socket = getSocket();

            if (!socket) {
                throw new Error('Chat transport could not obtain a Socket.');
            }

            return socket;
        };
        const inferHistoryRoomId = (messages) => {
            const roomIds = new Set(
                (Array.isArray(messages) ? messages : [])
                    .map((message) => message?.roomId)
                    .filter(Boolean)
            );

            if (roomIds.size === 1) {
                return Array.from(roomIds)[0];
            }

            return undefined;
        };

        const flushNextJoin = () => {
            const socket = getActiveSocket();
            if (
                !socket.connected ||
                inFlightJoinRoomId ||
                !queuedJoinRoomIds.length
            ) {
                return false;
            }

            inFlightJoinRoomId = queuedJoinRoomIds.shift();
            socket.emit('chat:join', { roomId: inFlightJoinRoomId });
            return true;
        };
        const clearPendingJoins = () => {
            queuedJoinRoomIds.length = 0;
            inFlightJoinRoomId = undefined;
        };
        const joinRoom = (roomId) => {
            if (!roomId || !getActiveSocket().connected) {
                return false;
            }

            queuedJoinRoomIds.push(roomId);
            flushNextJoin();
            return true;
        };

        const sendMessage = (payload) => {
            const socket = getActiveSocket();
            if (!socket.connected) {
                return Promise.reject(
                    new Error('Chat transport is not connected.')
                );
            }

            socket.emit('chat:send', payload);
            return Promise.resolve({ ok: true });
        };

        const subscribeHistory = (handler) => {
            const socket = getActiveSocket();
            const listener = (messages) => {
                const inferredRoomId = inferHistoryRoomId(messages);
                const roomId = inferredRoomId || inFlightJoinRoomId;

                handler({
                    messages: Array.isArray(messages) ? messages : [],
                    roomId,
                });
                inFlightJoinRoomId = undefined;
                flushNextJoin();
            };

            socket.on('chat:history', listener);
            return () => socket.off('chat:history', listener);
        };

        const subscribeMessage = (handler) => {
            const socket = getActiveSocket();
            socket.on('chat:message', handler);
            return () => socket.off('chat:message', handler);
        };

        const subscribeConnectionState = (handler) => {
            const socket = getActiveSocket();
            const manager = socket.io;
            const handleDisconnected = () => {
                clearPendingJoins();
                handler('reconnecting');
            };
            const listeners = [
                [socket, 'connect', () => handler('connected')],
                [socket, 'disconnect', handleDisconnected],
                [socket, 'connect_error', handleDisconnected],
                [manager, 'reconnect_attempt', () => handler('reconnecting')],
                [manager, 'reconnect_failed', () => handler('failed')],
            ];

            listeners.forEach(([owner, eventName, listener]) =>
                owner?.on?.(eventName, listener)
            );
            handler(socket.connected ? 'connected' : 'connecting');

            return () => {
                listeners.forEach(([owner, eventName, listener]) =>
                    owner?.off?.(eventName, listener)
                );
                clearPendingJoins();
            };
        };

        return {
            joinRoom,
            sendMessage,
            subscribeConnectionState,
            subscribeHistory,
            subscribeMessage,
        };
    };

    global.VoiceChatSocketTransport = { createChatSocketTransport };
})(window);
