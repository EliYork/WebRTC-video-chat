/* eslint-disable no-await-in-loop -- Await the real server's asynchronous events. */
import assert from 'node:assert/strict';
import { createPiikMediaGateway } from '../src/utils/PiikMediaGateway.js';
import * as protocol from '../integrations/piik/.build/protocol.mjs';
import { startPiikLocal } from './piik-local-service.mjs';
const piik = await startPiikLocal();
const sockets = new Map();
const socket = (id, roomId) => {
    const events = [];
    const result = {
        id,
        owner: roomId
            ? { roomId, peerId: id, voiceSessionGeneration: 1 }
            : null,
        emit: (name, value) => events.push({ name, value }),
        events,
    };
    sockets.set(id, result);
    return result;
};
let holdCreate = false,
    releaseCreate;
const gateway = createPiikMediaGateway({
    io: { sockets: { sockets } },
    getVoiceOwner: (s) => s.owner,
    protocol,
    baseURL: piik.baseURL,
    onSharing() {},
    fetchImpl: async (...args) => {
        const response = await fetch(...args);
        if (holdCreate) {
            holdCreate = false;
            await new Promise((done) => {
                releaseCreate = done;
            });
        }
        return response;
    },
});
const wait = async (predicate) => {
    for (let i = 0; i < 100; i++) {
        const value = predicate();
        if (value) return value;
        await new Promise((done) => setTimeout(done, 50));
    }
    throw new Error('gateway event timeout');
};
try {
    const a = socket('alice', 'lobby'),
        b = socket('bob', 'lobby'),
        c = socket('charlie', 'game'),
        outsider = socket('outsider');
    const published = await gateway.request(a, {
        action: 'publish',
        quality: protocol.DEFAULT_QUALITY_SETTINGS,
        roomId: 'game',
        hostToken: 'forged',
    });
    await wait(() =>
        a.events.find(
            (e) =>
                e.name === 'piik:message' &&
                e.value.message.type === 'authenticated'
        )
    );
    assert.deepEqual(gateway.snapshot(b), [
        { id: published.shareId, peerId: 'alice' },
    ]);
    assert.deepEqual(gateway.snapshot(c), []);
    await assert.rejects(
        gateway.request(outsider, {
            action: 'watch',
            shareId: published.shareId,
        }),
        /voice-owner-missing/
    );
    await assert.rejects(
        gateway.request(c, { action: 'watch', shareId: published.shareId }),
        /share-access-denied/
    );
    const viewed = await gateway.request(b, {
        action: 'watch',
        shareId: published.shareId,
    });
    await wait(() =>
        b.events.find(
            (e) =>
                e.name === 'piik:message' &&
                e.value.message.type === 'authenticated'
        )
    );
    await assert.rejects(
        gateway.request(c, {
            action: 'send',
            sessionId: viewed.sessionId,
            message: { type: 'signaling-challenge', sequence: 1 },
        }),
        /media-session-denied/
    );
    await assert.rejects(
        gateway.request(b, {
            action: 'send',
            sessionId: viewed.sessionId,
            message: { type: 'abandon-room' },
        }),
        /media-command-denied/
    );
    assert.ok(
        !JSON.stringify([...a.events, ...b.events]).includes('hostToken')
    );
    assert.ok(
        !JSON.stringify([...a.events, ...b.events]).includes('viewerGrant')
    );
    const second = await gateway.request(b, {
        action: 'publish',
        quality: protocol.DEFAULT_QUALITY_SETTINGS,
    });
    await wait(() =>
        b.events.find(
            (e) =>
                e.name === 'piik:message' &&
                e.value.sessionId === second.sessionId &&
                e.value.message.type === 'authenticated'
        )
    );
    assert.equal(
        gateway.snapshot(a).length,
        2,
        'independent shares in same channel'
    );
    gateway.cleanupSocket(a);
    a.owner = null;
    assert.deepEqual(gateway.snapshot(b), [
        { id: second.shareId, peerId: 'bob' },
    ]);
    assert.ok(
        b.events.some(
            (e) =>
                e.name === 'piik:closed' &&
                e.value.sessionId === viewed.sessionId
        )
    );
    b.owner.voiceSessionGeneration++;
    await assert.rejects(
        gateway.request(b, {
            action: 'send',
            sessionId: second.sessionId,
            message: { type: 'signaling-challenge', sequence: 1 },
        }),
        /media-session-denied/
    );
    gateway.cleanupSocket(b);
    assert.deepEqual(gateway.snapshot(b), []);
    const d = socket('dana', 'lobby');
    holdCreate = true;
    const creating = gateway.request(d, {
        action: 'publish',
        quality: protocol.DEFAULT_QUALITY_SETTINGS,
    });
    await wait(() => releaseCreate);
    gateway.cleanupSocket(d);
    releaseCreate();
    await assert.rejects(creating, /publish-cancelled/);
    assert.deepEqual(
        gateway.snapshot(d),
        [],
        'late room allocation cannot restore cancelled publication'
    );
    process.stdout.write(
        'PASS: real Piik auth, channel isolation, credential confinement, session ownership/generation, multi-publisher and departure cleanup\n'
    );
} finally {
    gateway.close();
    piik.close();
}
