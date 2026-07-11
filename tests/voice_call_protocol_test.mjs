import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import { createVoiceCallSignaling } from '../src/utils/VoiceCallSignaling.js';

const protocolSource = readFileSync(
    new URL('../src/views/js/voice/voice-call-protocol.js', import.meta.url),
    'utf8'
);
const protocolWindow = {};
vm.runInNewContext(protocolSource, {
    URLSearchParams,
    window: protocolWindow,
});
const { createMediaDebugLog } = protocolWindow.VoiceCallProtocol;

test('client protocol exposes stable media track-role metadata', () => {
    assert.equal(
        protocolWindow.VoiceCallProtocol.MEDIA_TRACK_ROLES_METADATA,
        'voiceMediaTrackRoles'
    );
});

class FakeSocket {
    constructor(io, id) {
        this.data = {};
        this.emitted = [];
        this.id = id;
        this.io = io;
        this.rooms = new Set([id]);
        io.sockets.push(this);
    }

    async join(roomId) {
        this.rooms.add(roomId);
    }

    async leave(roomId) {
        this.rooms.delete(roomId);
    }

    emit(event, payload) {
        this.emitted.push({ event, payload });
    }

    to(roomId) {
        return {
            emit: (event, payload) => {
                this.io.sockets
                    .filter(
                        (socket) => socket !== this && socket.rooms.has(roomId)
                    )
                    .forEach((socket) => socket.emit(event, payload));
            },
        };
    }
}

class FakeIo {
    constructor() {
        this.sockets = [];
    }

    in(roomId) {
        return {
            fetchSockets: async () =>
                this.sockets.filter((socket) => socket.rooms.has(roomId)),
        };
    }
}

const createFixture = () => {
    const io = new FakeIo();
    const rooms = new Set(['lobby', 'game']);
    const signaling = createVoiceCallSignaling({
        io,
        resolveRoomId: (roomId) => (rooms.has(roomId) ? roomId : undefined),
    });
    return { io, signaling };
};

const events = (socket, event) =>
    socket.emitted.filter((entry) => entry.event === event);

test('join tells every side to publish its own one-way media direction', async () => {
    const { io, signaling } = createFixture();
    const a = new FakeSocket(io, 'socket-a');
    const b = new FakeSocket(io, 'socket-b');

    await signaling.join({ peerId: 'A', roomId: 'lobby' }, a);
    await signaling.join({ peerId: 'B', roomId: 'lobby' }, b);

    assert.deepEqual(events(b, 'voice:call-targets')[0].payload, {
        peerIds: ['A'],
        roomId: 'lobby',
        voiceSessionGeneration: 1,
    });
    assert.deepEqual(events(a, 'voice:peer-joined')[0].payload, {
        peerId: 'B',
        roomId: 'lobby',
    });
});

test('three sequential joins produce all six send directions without duplicate instructions', async () => {
    const { io, signaling } = createFixture();
    const a = new FakeSocket(io, 'socket-a');
    const b = new FakeSocket(io, 'socket-b');
    const c = new FakeSocket(io, 'socket-c');

    await signaling.join({ peerId: 'A', roomId: 'lobby' }, a);
    await signaling.join({ peerId: 'B', roomId: 'lobby' }, b);
    await signaling.join({ peerId: 'C', roomId: 'lobby' }, c);

    assert.deepEqual(
        events(a, 'voice:peer-joined').map((e) => e.payload.peerId),
        ['B', 'C']
    );
    assert.deepEqual(
        events(b, 'voice:peer-joined').map((e) => e.payload.peerId),
        ['C']
    );
    assert.deepEqual(events(c, 'voice:call-targets')[0].payload.peerIds, [
        'A',
        'B',
    ]);
});

test('duplicate join is idempotent and does not rebroadcast peer joined', async () => {
    const { io, signaling } = createFixture();
    const a = new FakeSocket(io, 'socket-a');
    const b = new FakeSocket(io, 'socket-b');
    await signaling.join({ peerId: 'A', roomId: 'lobby' }, a);
    await signaling.join({ peerId: 'B', roomId: 'lobby' }, b);

    const result = await signaling.join({ peerId: 'B', roomId: 'lobby' }, b);

    assert.equal(result.duplicate, true);
    assert.equal(events(a, 'voice:peer-joined').length, 1);
    assert.equal(events(b, 'voice:call-targets').length, 1);
});

test('duplicate peer identity is rejected before room ownership changes', async () => {
    const { io, signaling } = createFixture();
    const a = new FakeSocket(io, 'socket-a');
    const duplicate = new FakeSocket(io, 'socket-duplicate');
    await signaling.join({ peerId: 'A', roomId: 'lobby' }, a);

    const result = await signaling.join(
        { peerId: 'A', roomId: 'lobby' },
        duplicate
    );

    assert.deepEqual(result, {
        ok: false,
        reason: 'voice-peer-id-in-use',
    });
    assert.equal(duplicate.rooms.has('lobby'), false);
    assert.deepEqual(duplicate.data, {});
});

test('leave uses the server owner and broadcasts removal once', async () => {
    const { io, signaling } = createFixture();
    const a = new FakeSocket(io, 'socket-a');
    const b = new FakeSocket(io, 'socket-b');
    await signaling.join({ peerId: 'A', roomId: 'lobby' }, a);
    await signaling.join({ peerId: 'B', roomId: 'lobby' }, b);

    const first = await signaling.leave(b, { reason: 'user-left' });
    const duplicate = await signaling.leave(b, { reason: 'disconnect' });

    assert.deepEqual(first, {
        ok: true,
        peerId: 'B',
        reason: 'user-left',
        roomId: 'lobby',
    });
    assert.equal(duplicate.duplicate, true);
    assert.equal(events(a, 'removeUserVideo').length, 1);
    assert.deepEqual(events(a, 'removeUserVideo')[0].payload, {
        peerId: 'B',
        roomId: 'lobby',
    });
});

test('invalid join cannot create room or owner state', async () => {
    const { io, signaling } = createFixture();
    const socket = new FakeSocket(io, 'socket');

    assert.deepEqual(
        await signaling.join({ peerId: '../bad', roomId: 'lobby' }, socket),
        { ok: false, reason: 'invalid-voice-join' }
    );
    assert.deepEqual(
        await signaling.join({ peerId: 'A', roomId: 'missing' }, socket),
        { ok: false, reason: 'invalid-voice-join' }
    );
    assert.deepEqual(socket.data, {});
});

test('media debug log is opt-in bounded and exports only concise records', () => {
    const disabled = createMediaDebugLog({
        location: { search: '' },
        storage: { getItem: () => null },
    });
    assert.equal(disabled.record({ event: 'hidden' }), false);
    assert.equal(disabled.export().length, 0);

    const enabled = createMediaDebugLog({
        console: { debug() {} },
        location: { search: '?voiceMediaDebug=1' },
        storage: { getItem: () => null },
    });
    for (let index = 0; index < 305; index += 1) {
        enabled.record({ event: 'state', generation: index });
    }
    const exported = enabled.export();
    assert.equal(exported.length, 300);
    assert.equal(exported[0].generation, 5);
    assert.equal(Object.hasOwn(exported[0], 'sdp'), false);

    enabled.reset();
    enabled.record({
        candidate: 'private candidate',
        deviceLabel: 'private label',
        event: 'sanitized',
        nested: { nickname: 'private name', trackId: 'private track' },
        sdp: 'private sdp',
    });
    assert.deepEqual({ ...enabled.export()[0].nested }, {});
    assert.equal(Object.hasOwn(enabled.export()[0], 'candidate'), false);
    assert.equal(Object.hasOwn(enabled.export()[0], 'deviceLabel'), false);
});

test('client and server use peer-joined signaling and contain no fixed-caller refresh events', () => {
    const scriptSource = readFileSync(
        new URL('../src/views/script.js', import.meta.url),
        'utf8'
    );
    const serverSource = readFileSync(
        new URL('../src/server.js', import.meta.url),
        'utf8'
    );
    const signalingSource = readFileSync(
        new URL('../src/utils/VoiceCallSignaling.js', import.meta.url),
        'utf8'
    );

    assert.match(scriptSource, /'voice:peer-joined'/);
    assert.match(signalingSource, /'voice:peer-joined'/);
    assert.doesNotMatch(scriptSource, /voice:call-refresh|voice:refresh-peer/);
    assert.doesNotMatch(serverSource, /voice:call-refresh/);
    assert.doesNotMatch(signalingSource, /voice:refresh-peer/);
});
