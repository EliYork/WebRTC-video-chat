import { WebSocketServer } from 'ws';

// PeerJS and Socket.IO share the HTTP server. A ws server attached directly
// rejects upgrades for other paths, corrupting Socket.IO's accepted handshake.
export const createPeerWebSocketServer = ({ server, path, ...options }) => {
    const websocket = new WebSocketServer({ ...options, path, noServer: true });
    const upgrade = (request, socket, head) => {
        if (request.url?.split('?')[0] !== path) return;
        websocket.handleUpgrade(request, socket, head, (connection) => {
            websocket.emit('connection', connection, request);
        });
    };
    server.on('upgrade', upgrade);
    websocket.once('close', () => server.off('upgrade', upgrade));
    return websocket;
};
