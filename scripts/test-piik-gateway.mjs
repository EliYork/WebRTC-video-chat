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
let replaceInvite = false;
let roomWithInvalidInvite;
let lastCreatedRoom;
const gateway = createPiikMediaGateway({
    io: { sockets: { sockets } },
    getVoiceOwner: (s) => s.owner,
    protocol,
    baseURL: piik.baseURL,
    onSharing() {},
    fetchImpl: async (...args) => {
        const response = await fetch(...args);
        if (replaceInvite) {
            replaceInvite = false;
            const room = await response.json();
            roomWithInvalidInvite = room.roomId;
            return Response.json({ ...room, inviteUrl: 'invalid-invite' });
        }
        if (holdCreate) {
            holdCreate = false;
            await new Promise((done) => {
                releaseCreate = done;
            });
        }
        if (response.ok) lastCreatedRoom = (await response.clone().json()).roomId;
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
    const publish = () => gateway.request(d, { action: 'publish', quality: protocol.DEFAULT_QUALITY_SETTINGS });
    replaceInvite = true;
    await assert.rejects(publish(), { name: 'ZodError' });
    assert.deepEqual(gateway.snapshot(d), []);
    const reallocated = await fetch(new URL('/api/rooms', piik.baseURL), {
        method: 'POST',
        headers: { Origin: piik.baseURL, 'Content-Type': 'application/json' },
        body: JSON.stringify({ codeEntryPolicy: 'private', preferredRoomId: roomWithInvalidInvite }),
        signal: AbortSignal.timeout(5000),
    });
    assert.equal(reallocated.status, 201);
    assert.equal((await reallocated.json()).roomId, roomWithInvalidInvite,
        'the room is immediately reusable when a creation response fails validation');
    releaseCreate = undefined;
    holdCreate = true;
    const cancelled = assert.rejects(publish(), /publish-cancelled/);
    const releaseCancelled = await wait(() => releaseCreate);
    await gateway.request(d, { action: 'stop' });
    releaseCreate = undefined;
    holdCreate = true;
    const restarting = publish();
    const releaseRestart = await Promise.race([wait(() => releaseCreate), restarting]);
    releaseCancelled();
    await cancelled;
    await assert.rejects(publish(), /already-publishing/, 'cancelled creation cannot release a newer reservation');
    releaseRestart();
    const recovered = await restarting;
    assert.deepEqual(gateway.snapshot(d), [{ id: recovered.shareId, peerId: 'dana' }]);
    const stoppedBeforeAuthentication = lastCreatedRoom;
    assert.ok(!d.events.some(e => e.value.sessionId === recovered.sessionId && e.value.message?.type === 'authenticated'));
    await gateway.request(d, { action: 'stop' });
    await gateway.close();
    const reused = await fetch(new URL('/api/rooms', piik.baseURL), {
        method: 'POST',
        headers: { Origin: piik.baseURL, 'Content-Type': 'application/json' },
        body: JSON.stringify({ codeEntryPolicy: 'private', preferredRoomId: stoppedBeforeAuthentication }),
        signal: AbortSignal.timeout(5000),
    });
    assert.equal(reused.status, 201);
    assert.equal((await reused.json()).roomId, stoppedBeforeAuthentication,
        'stopping before host authentication releases the upstream room');
    process.stdout.write(
        'PASS: real Piik auth, channel isolation, session ownership, multi-publisher, departure, early and invalid invite cleanup, and restart after cancellation\n'
    );
} finally {
    await gateway.close();
    piik.close();
}
