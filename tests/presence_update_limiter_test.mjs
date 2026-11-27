import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createPresenceUpdateLimiter } from '../src/utils/PresenceUpdateLimiter.js';

test('Presence updates share a per-connection budget and deliver the latest partial state', async () => {
    const a = { owner: { roomId: 'lobby', peerId: 'a', voiceSessionGeneration: 1 } };
    const b = { owner: { roomId: 'lobby', peerId: 'b', voiceSessionGeneration: 1 } };
    const seen = [];
    const limiter = createPresenceUpdateLimiter({ intervalMs: 15, getOwner: socket => socket.owner,
        apply: (payload, socket) => seen.push([socket.owner.peerId, payload]) });
    limiter.submit(a, { muted: false });
    limiter.submit(a, { muted: true });
    limiter.submit(a, { cameraOn: true });
    limiter.submit(a, { cameraOn: false });
    limiter.submit(b, { muted: true });
    assert.deepEqual(seen, [['a', { muted: false }], ['b', { muted: true }]]);
    await delay(25);
    assert.deepEqual(seen, [['a', { muted: false }], ['b', { muted: true }], ['a', { muted: true, cameraOn: false }]]);
});

test('queued Presence work cannot outlive leave, disconnect or the owning voice generation', async () => {
    const socket = { owner: { roomId: 'lobby', peerId: 'a', voiceSessionGeneration: 1 } };
    const seen = [];
    const limiter = createPresenceUpdateLimiter({ intervalMs: 15, getOwner: s => s.owner,
        apply: (payload) => seen.push(payload) });
    limiter.submit(socket, { muted: false });
    limiter.submit(socket, { muted: true });
    limiter.discard(socket);
    await delay(25);
    assert.deepEqual(seen, [{ muted: false }]);
    limiter.submit(socket, { cameraOn: true });
    limiter.submit(socket, { cameraOn: false });
    socket.owner = { ...socket.owner, voiceSessionGeneration: 2 };
    await delay(25);
    assert.deepEqual(seen, [{ muted: false }, { cameraOn: true }]);
    limiter.submit(socket, { muted: true });
    limiter.submit(socket, { muted: false });
    limiter.clear(socket);
    await delay(25);
    assert.deepEqual(seen, [{ muted: false }, { cameraOn: true }, { muted: true }]);
});
