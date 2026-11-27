import { createHash, timingSafeEqual } from 'node:crypto';
import { WebSocket } from 'ws';

const peerIdPattern = /^voice-[a-f0-9]{64}$/;
const tokenPattern = /^[a-f0-9]{64}$/;
const isToken = (value) => typeof value === 'string' && value.length === 64 && tokenPattern.test(value);

// The PeerJS signalling ID commits to a private token. A disconnected ID
// cannot be reclaimed by someone who only saw it in room presence.
export const isVoicePeerIdentity = (peerId, token) => {
    if (typeof peerId !== 'string' || peerId.length !== 70 || !peerIdPattern.test(peerId) || !isToken(token)) return false;
    return timingSafeEqual(
        Buffer.from(peerId.slice('voice-'.length), 'hex'),
        createHash('sha256').update(token).digest(),
    );
};

export function readPeerHandshake(target) {
    // Use the same URL parser as PeerServer. Reject ambiguous credentials before
    // the request is handed to PeerServer's own registration handler.
    if (typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//') || /[\\#\s]/.test(target)) return;
    const { searchParams } = new URL(target, 'https://peerjs');
    for (const key of ['id', 'token', 'key']) {
        if (searchParams.getAll(key).length !== 1 || !searchParams.get(key)) return;
    }
    const id = searchParams.get('id');
    const token = searchParams.get('token');
    if (isVoicePeerIdentity(id, token)) return { id, token };
}

const matchesToken = (left, right) => isToken(left) && isToken(right) &&
    timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));

export function createVoicePeerBindings() {
    const handshakes = new WeakMap();
    const connections = new Map();
    const active = (id) => {
        const entry = connections.get(id);
        return entry?.socket.readyState === WebSocket.OPEN && entry.client.getSocket() === entry.socket ? entry : undefined;
    };
    return {
        observe(socket, handshake) {
            handshakes.set(socket, handshake);
            socket.once('close', () => {
                if (connections.get(handshake.id)?.socket === socket) connections.delete(handshake.id);
            });
        },
        register(client) {
            const socket = client.getSocket();
            const id = client.getId();
            const handshake = handshakes.get(socket);
            if (handshake?.id !== id || !matchesToken(handshake.token, client.getToken())) {
                socket?.terminate();
                return false;
            }
            const previous = connections.get(id);
            connections.set(id, { client, socket });
            if (previous && previous.socket !== socket) {
                previous.socket.terminate();
                // PeerServer sends OPEN when creating a Client, but not when
                // a verified reconnection replaces that Client's transport.
                if (previous.client === client) client.send({ type: 'OPEN' });
            }
            return true;
        },
        authorizes: (id, token) => matchesToken(active(id)?.client.getToken(), token),
        source(socket) {
            const handshake = handshakes.get(socket);
            return handshake && active(handshake.id)?.socket === socket ? handshake.id : undefined;
        },
        isConnected: id => Boolean(active(id)),
    };
}
