(function exposeVoiceSidebarSocketTransport(global) {
    'use strict';

    const createSidebarSocketTransport = ({ getSocket } = {}) => {
        if (typeof getSocket !== 'function') {
            throw new TypeError('Sidebar transport requires getSocket().');
        }

        const getActiveSocket = () => {
            const socket = getSocket();
            if (!socket) {
                throw new Error('Sidebar transport could not obtain a Socket.');
            }
            return socket;
        };

        const subscribePresence = (handler) => {
            const socket = getActiveSocket();
            socket.on('presence:state', handler);
            return () => socket.off('presence:state', handler);
        };

        const subscribeConnectionState = (handler) => {
            const socket = getActiveSocket();
            const manager = socket.io;
            const listeners = [
                [socket, 'connect', () => handler('connected')],
                [socket, 'disconnect', () => handler('reconnecting')],
                [socket, 'connect_error', () => handler('reconnecting')],
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
            };
        };

        return { subscribeConnectionState, subscribePresence };
    };

    global.VoiceSidebarSocketTransport = { createSidebarSocketTransport };
})(window);
