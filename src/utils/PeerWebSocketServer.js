import { WebSocket, WebSocketServer } from 'ws';
import { readPeerHandshake } from './VoicePeerIdentity.js';

const relayTypes = new Set(['OFFER', 'ANSWER', 'CANDIDATE', 'LEAVE']);

// PeerJS and Socket.IO share the HTTP server. A ws server attached directly
// rejects upgrades for other paths, corrupting Socket.IO's accepted handshake.
export const createPeerWebSocketServer = ({ server, path, bindings, canRelay, ...options }) => {
    const handshakes = new WeakMap();
    class VoicePeerSocket extends WebSocket {
        emit(event, ...args) {
            if (event !== 'message') return super.emit(event, ...args);
            const sender = bindings.source(this);
            if (!sender) return false;
            // PeerServer reports malformed messages through its existing error hook.
            let message;
            try { message = JSON.parse(args[0].toString()); }
            catch { return super.emit(event, ...args); }
            if (!message || typeof message !== 'object' || Array.isArray(message)) return super.emit(event, ...args);
            if (message.type !== 'HEARTBEAT' &&
                (!relayTypes.has(message.type) || typeof message.dst !== 'string' ||
                 !bindings.isConnected(message.dst) || !canRelay(sender, message.dst))) return false;
            return super.emit(event, ...args);
        }
    }
    const websocket = new WebSocketServer({
        ...options,
        path,
        noServer: true,
        WebSocket: VoicePeerSocket,
        verifyClient: ({ req }) => {
            const handshake = readPeerHandshake(req.url);
            if (!handshake) return false;
            handshakes.set(req, handshake);
            return true;
        },
    });
    const upgrade = (request, socket, head) => {
        if (request.url?.split('?')[0] !== path) return;
        websocket.handleUpgrade(request, socket, head, (connection) => {
            bindings.observe(connection, handshakes.get(request));
            websocket.emit('connection', connection, request);
        });
    };
    server.on('upgrade', upgrade);
    websocket.once('close', () => server.off('upgrade', upgrade));
    return websocket;
};
