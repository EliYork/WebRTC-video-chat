(function exposeVoiceChatSocketTransport(global) {
    'use strict';
    let nextJoinRequestId = 0;

    const createChatSocketTransport = ({ getSocket,
        setTimer = global.setTimeout?.bind(global), clearTimer = global.clearTimeout?.bind(global),
    } = {}) => {
        if (typeof getSocket !== 'function') {
            throw new TypeError('Chat transport requires getSocket().');
        }

        let queuedJoin;
        let inFlightJoin;
        let requireJoinRequestId = false;
        const historyFailures = new Set();
        const releaseJoin = () => {
            if (inFlightJoin?.timer !== undefined) clearTimer?.(inFlightJoin.timer);
            inFlightJoin = undefined;
        };
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
                inFlightJoin ||
                !queuedJoin
            ) {
                return false;
            }

            inFlightJoin = queuedJoin;
            queuedJoin = undefined;
            const pending = inFlightJoin;
            pending.joinRequestId = ++nextJoinRequestId;
            pending.timer = setTimer?.(() => {
                if (inFlightJoin !== pending) return;
                releaseJoin();
                // Untagged legacy replies cannot be associated safely after a timeout.
                requireJoinRequestId = true;
                try {
                    historyFailures.forEach(handler => handler({ roomId: pending.roomId,
                        requestRevision: pending.requestRevision, reason: 'timeout' }));
                } finally { flushNextJoin(); }
            }, 8000);
            pending.timer?.unref?.();
            socket.emit('chat:join', { roomId: pending.roomId, joinRequestId: pending.joinRequestId });
            return true;
        };
        const clearPendingJoins = () => {
            queuedJoin = undefined;
            releaseJoin();
        };
        const joinRoom = (roomId, { requestRevision } = {}) => {
            if (!roomId || !getActiveSocket().connected) {
                return false;
            }

            queuedJoin = { roomId, requestRevision };
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

            return new Promise((resolve, reject) => {
                socket
                    .timeout(8000)
                    .emit('chat:send', payload, (error, result) => {
                        if (error || result?.ok !== true) {
                            const failure = new Error(
                                result?.error ||
                                    '消息未获服务端确认，请检查连接。'
                            );
                            failure.deliveryUncertain = Boolean(error || result?.ok !== false);
                            reject(failure);
                            return;
                        }
                        resolve(result);
                    });
            });
        };

        const subscribeHistory = (handler) => {
            const socket = getActiveSocket();
            const listener = (messages, metadata) => {
                const pending = inFlightJoin;
                if (metadata?.joinRequestId !== undefined) {
                    if (!pending || metadata.joinRequestId !== pending.joinRequestId) return;
                } else if (requireJoinRequestId) return;
                const inferredRoomId = inferHistoryRoomId(messages);
                const roomId =
                    metadata?.roomId || inferredRoomId || pending?.roomId;

                try {
                    handler({
                        messages: Array.isArray(messages) ? messages : [],
                        roomId,
                        persistence: metadata?.persistence,
                        requestRevision: roomId === pending?.roomId ? pending?.requestRevision : undefined,
                    });
                } finally {
                    if (pending && roomId === pending.roomId && inFlightJoin === pending) {
                        releaseJoin();
                        flushNextJoin();
                    }
                }
            };

            socket.on('chat:history', listener);
            return () => { socket.off('chat:history', listener); clearPendingJoins(); };
        };
        const subscribeHistoryFailure = handler => {
            historyFailures.add(handler);
            return () => historyFailures.delete(handler);
        };

        const subscribeMessage = (handler) => {
            const socket = getActiveSocket();
            socket.on('chat:message', handler);
            return () => socket.off('chat:message', handler);
        };

        const subscribePersistence = handler => {
            const socket = getActiveSocket();
            socket.on('chat:persistence', handler);
            return () => socket.off('chat:persistence', handler);
        };

        const subscribeConnectionState = (handler) => {
            const socket = getActiveSocket();
            const manager = socket.io;
            const handleDisconnected = () => {
                clearPendingJoins();
                requireJoinRequestId = false;
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
            subscribeHistoryFailure,
            subscribeMessage,
            subscribePersistence,
        };
    };

    global.VoiceChatSocketTransport = { createChatSocketTransport };
})(window);
