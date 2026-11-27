import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { WebSocketServer } from 'ws';
import { createPiikMediaGateway } from '../src/utils/PiikMediaGateway.js';

test('Piik reclaims a room after a malformed host response and retries once if cleanup closes without acknowledgement', async (t) => {
    const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await once(upstream, 'listening', { signal: AbortSignal.timeout(2000) });
    t.after(() => {
        for (const client of upstream.clients) client.terminate();
        return new Promise(resolve => upstream.close(resolve));
    });
    const received = [], warnings = [];
    let cleanupAttempts = 0;
    upstream.on('connection', (client) => {
        let shouldAcknowledge = false;
        client.on('message', (bytes) => {
            const payload = JSON.parse(bytes.toString());
            received.push(payload.type);
            if (payload.type === 'abandon-room') {
                if (shouldAcknowledge) client.send(JSON.stringify({ type: 'room-closed' }));
                else client.close();
            } else if (payload.roomOnly) {
                shouldAcknowledge = ++cleanupAttempts === 2;
                client.send(JSON.stringify({ type: 'authenticated' }));
            } else client.send('{invalid frame');
        });
    });

    let stop;
    const ended = new Promise(resolve => { stop = resolve; });
    const owner = { roomId: 'lobby', peerId: 'host', voiceSessionGeneration: 1 };
    const socket = { id: 'host', emit() {} };
    const identity = (value) => value;
    const gateway = createPiikMediaGateway({
        io: { sockets: { sockets: new Map([[socket.id, socket]]) } },
        getVoiceOwner: () => owner,
        baseURL: `http://127.0.0.1:${upstream.address().port}`,
        onSharing: (_socket, sharing) => { if (!sharing) stop(); },
        warn: (message) => warnings.push(message),
        fetchImpl: async () => Response.json({
            roomId: 'fixture', hostToken: 'fixture-token', inviteUrl: 'http://127.0.0.1/#v=fixture-view',
        }),
        protocol: {
            SIGNALING_PROTOCOL: 'fixture',
            qualitySettingsSchema: { parse: identity },
            createRoomResponseSchema: { parse: identity, pick: () => ({ strip: () => ({}) }) },
            decodeServerMessage: JSON.parse,
        },
    });
    t.after(() => gateway.close());
    await gateway.request(socket, { action: 'publish', quality: { resolution: { width: 640, height: 360 } } });
    await ended;
    assert.deepEqual(gateway.snapshot(socket), []);
    await gateway.close();
    assert.deepEqual(received, ['authenticate', 'authenticate', 'abandon-room', 'authenticate', 'abandon-room']);
    assert.deepEqual(warnings, []);
});
