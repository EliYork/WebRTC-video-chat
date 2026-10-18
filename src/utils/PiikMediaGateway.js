import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';

// Only this gateway knows Piik room credentials. Socket.IO's existing voice
// membership is the authority; Piik remains the sole media graph controller.
export function createPiikMediaGateway({
    io,
    getVoiceOwner,
    protocol,
    baseURL,
    onSharing,
    fetchImpl = fetch,
}) {
    const url = new URL(baseURL);
    if (
        url.protocol !== 'http:' ||
        url.hostname !== '127.0.0.1' ||
        url.pathname !== '/'
    ) {
        throw new Error('PIIK_INTERNAL_URL must be an HTTP loopback origin');
    }
    const shares = new Map();
    const connections = new Map();
    const pending = new Map();
    const revisions = new WeakMap();
    let closed = false;
    const sameOwner = (a, b) =>
        a &&
        b &&
        a.roomId === b.roomId &&
        a.peerId === b.peerId &&
        a.voiceSessionGeneration === b.voiceSessionGeneration;
    const current = (connection) =>
        sameOwner(connection.owner, getVoiceOwner(connection.socket)) &&
        shares.get(connection.share.id) === connection.share;
    const snapshot = (socket) => {
        const owner = getVoiceOwner(socket);
        return owner
            ? [...shares.values()]
                  .filter((s) => s.owner.roomId === owner.roomId)
                  .map((s) => ({ id: s.id, peerId: s.owner.peerId }))
            : [];
    };
    const broadcast = (roomId) => {
        for (const socket of io.sockets.sockets.values()) {
            if (getVoiceOwner(socket)?.roomId === roomId)
                socket.emit('piik:shares', snapshot(socket));
        }
    };
    const closeConnection = (connection) => {
        if (!connections.delete(connection.id)) return;
        clearTimeout(connection.timer);
        if (
            connection.role === 'host' &&
            connection.ws.readyState === WebSocket.OPEN
        )
            connection.ws.send(JSON.stringify({ type: 'abandon-room' }));
        connection.ws.close();
        connection.socket.emit('piik:closed', { sessionId: connection.id });
    };
    const stop = (share) => {
        if (!shares.delete(share.id)) return;
        for (const connection of [...connections.values()])
            if (connection.share === share) closeConnection(connection);
        onSharing(share.socket, false, share.owner);
        broadcast(share.owner.roomId);
    };
    const cleanupSocket = (socket) => {
        revisions.set(socket, (revisions.get(socket) || 0) + 1);
        for (const share of [...shares.values()])
            if (share.socket === socket) stop(share);
        for (const connection of [...connections.values()])
            if (connection.socket === socket) closeConnection(connection);
    };
    const abandon = (room) =>
        new Promise((resolve) => {
            const wsURL = new URL('/signal', url);
            wsURL.protocol = 'ws:';
            const ws = new WebSocket(wsURL, {
                origin: url.origin,
                handshakeTimeout: 5000,
            });
            const timer = setTimeout(() => ws.terminate(), 8000);
            ws.on('error', () => {});
            ws.on('close', () => {
                clearTimeout(timer);
                resolve();
            });
            ws.on('open', () =>
                ws.send(
                    JSON.stringify({
                        type: 'authenticate',
                        protocol: protocol.SIGNALING_PROTOCOL,
                        roomId: room.roomId,
                        role: 'host',
                        token: room.hostToken,
                        clientId: randomUUID(),
                        roomOnly: true,
                        routePolicy: {
                            peerOnly: true,
                            topologyOptimization: false,
                            natPrediction: false,
                        },
                    })
                )
            );
            ws.on('message', (bytes) => {
                const message = JSON.parse(bytes.toString());
                if (message.type === 'authenticated') {
                    ws.send(JSON.stringify({ type: 'abandon-room' }));
                    ws.close();
                }
            });
        });
    const open = (socket, share, role) => {
        const owner = getVoiceOwner(socket);
        const existing = [...connections.values()].find(
            (c) => c.socket === socket && c.share === share && c.role === role
        );
        if (existing) return { sessionId: existing.id };
        const wsURL = new URL('/signal', url);
        wsURL.protocol = 'ws:';
        const ws = new WebSocket(wsURL, {
            origin: url.origin,
            maxPayload: 256 * 1024,
            handshakeTimeout: 5000,
        });
        const connection = {
            id: randomUUID(),
            socket,
            owner: { ...owner },
            share,
            role,
            ws,
        };
        connections.set(connection.id, connection);
        connection.timer = setTimeout(() => {
            if (role === 'host') stop(share);
            else closeConnection(connection);
        }, 8000);
        ws.on('open', () => {
            if (!current(connection)) return closeConnection(connection);
            ws.send(
                JSON.stringify({
                    type: 'authenticate',
                    protocol: protocol.SIGNALING_PROTOCOL,
                    roomId: share.room.roomId,
                    role,
                    clientId: connection.id,
                    ...(role === 'host'
                        ? {
                              token: share.room.hostToken,
                              shareGeneration: share.id,
                              qualitySettings: share.quality,
                              routePolicy: {
                                  peerOnly: true,
                                  topologyOptimization: false,
                                  natPrediction: false,
                              },
                          }
                        : { viewerGrant: share.grant }),
                })
            );
        });
        ws.on('message', (bytes) => {
            if (!current(connection)) return closeConnection(connection);
            let message;
            try {
                message = protocol.decodeServerMessage(bytes.toString());
            } catch {
                if (role === 'host') stop(share);
                else closeConnection(connection);
                return;
            }
            if (message.type === 'authenticated') {
                clearTimeout(connection.timer);
                if (role === 'viewer')
                    ws.send(
                        JSON.stringify({
                            type: 'relay-capacity',
                            downstreamEdges: 0,
                        })
                    );
            }
            socket.emit('piik:message', { sessionId: connection.id, message });
        });
        ws.on('error', () => {}); // close owns resource cleanup; credentials never enter logs.
        ws.on('close', () => {
            if (role === 'host') stop(share);
            else closeConnection(connection);
        });
        return { sessionId: connection.id };
    };
    const allowed = new Set([
        'signal',
        'restart-request',
        'route-ready',
        'route-failed',
        'route-transport-connected',
        'route-media-unavailable',
        'signaling-challenge',
    ]);
    const request = async (socket, input) => {
        const authority = getVoiceOwner(socket);
        const owner = authority ? { ...authority } : undefined;
        if (closed) throw new Error('piik-gateway-closed');
        if (!owner || socket.disconnected)
            throw new Error('voice-owner-missing');
        if (!input || typeof input !== 'object')
            throw new Error('invalid-request');
        if (input.action === 'list') return { shares: snapshot(socket) };
        if (input.action === 'publish') {
            if (
                [...shares.values()].some((s) => s.socket === socket) ||
                pending.has(socket)
            )
                throw new Error('already-publishing');
            const quality = protocol.qualitySettingsSchema.parse(input.quality);
            if (
                quality.resolution.width > 8192 ||
                quality.resolution.height > 8192 ||
                quality.maxFramerate > 120 ||
                quality.maxBitrate > 60000000
            )
                throw new Error('quality-out-of-range');
            const revision = revisions.get(socket) || 0;
            const operation = (async () => {
                const response = await fetchImpl(new URL('/api/rooms', url), {
                    method: 'POST',
                    headers: {
                        Origin: url.origin,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ codeEntryPolicy: 'private' }),
                    signal: AbortSignal.timeout(5000),
                });
                if (!response.ok) throw new Error('piik-room-create-failed');
                const room = protocol.createRoomResponseSchema.parse(
                    await response.json()
                );
                const share = {
                    id: randomUUID(),
                    owner: { ...owner },
                    socket,
                    room,
                    quality,
                    grant: new URLSearchParams(
                        new URL(room.inviteUrl).hash.slice(1)
                    ).get('v'),
                };
                // Cancellation still claims and abandons the just-created room.
                if (
                    closed ||
                    !sameOwner(owner, getVoiceOwner(socket)) ||
                    socket.disconnected ||
                    revision !== (revisions.get(socket) || 0)
                ) {
                    await abandon(room);
                    throw new Error('publish-cancelled');
                }
                shares.set(share.id, share);
                const session = open(socket, share, 'host');
                onSharing(socket, true, owner);
                broadcast(owner.roomId);
                return { ...session, shareId: share.id };
            })();
            pending.set(socket, operation);
            try {
                return await operation;
            } finally {
                pending.delete(socket);
            }
        }
        const share = shares.get(input.shareId);
        if (input.action === 'watch') {
            if (
                !share ||
                share.owner.roomId !== owner.roomId ||
                share.socket === socket
            )
                throw new Error('share-access-denied');
            return open(socket, share, 'viewer');
        }
        if (input.action === 'stop') {
            revisions.set(socket, (revisions.get(socket) || 0) + 1);
            for (const owned of [...shares.values()])
                if (owned.socket === socket) stop(owned);
            return {};
        }
        const connection = connections.get(input.sessionId);
        if (!connection || connection.socket !== socket || !current(connection))
            throw new Error('media-session-denied');
        if (input.action === 'close') {
            if (connection.role === 'host') stop(connection.share);
            else closeConnection(connection);
            return {};
        }
        if (input.action !== 'send') throw new Error('invalid-action');
        const encoded = JSON.stringify(input.message);
        if (encoded.length > 128 * 1024) throw new Error('message-too-large');
        const message = protocol.decodeClientMessage(encoded);
        if (!allowed.has(message.type)) throw new Error('media-command-denied');
        if (
            connection.ws.readyState !== WebSocket.OPEN ||
            connection.ws.bufferedAmount > 256 * 1024
        )
            throw new Error('piik-unavailable');
        connection.ws.send(JSON.stringify(message));
        return {};
    };
    return {
        cleanupSocket,
        snapshot,
        request,
        close: () => {
            closed = true;
            for (const share of [...shares.values()]) stop(share);
        },
    };
}
