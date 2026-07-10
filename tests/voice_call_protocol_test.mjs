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
vm.runInNewContext(protocolSource, { window: protocolWindow });
const { createCallGate, createRefreshRevisionGate } =
    protocolWindow.VoiceCallProtocol;

class FakeCall {
    constructor(peer, { metadata, peerConnection } = {}) {
        this.answerCount = 0;
        this.closeCount = 0;
        this.listeners = new Map();
        this.metadata = metadata;
        this.peer = peer;
        this.peerConnection = peerConnection;
    }

    on(event, listener) {
        const listeners = this.listeners.get(event) || [];
        listeners.push(listener);
        this.listeners.set(event, listeners);
    }

    emit(event, value) {
        (this.listeners.get(event) || [])
            .slice()
            .forEach((listener) => listener(value));
    }

    listenerCount(event) {
        return (this.listeners.get(event) || []).length;
    }

    answer(stream) {
        this.answerCount += 1;
        this.answerStream = stream;
    }

    close() {
        this.closeCount += 1;
        this.emit('close');
    }
}

class FakePeer {
    constructor() {
        this.calls = [];
        this.mode = 'call';
    }

    call(peerId, stream, options) {
        this.calls.push({ options, peerId, stream });
        this.onCall?.();

        if (this.mode === 'throw') {
            throw new Error('call creation failed');
        }
        if (this.mode === 'empty') {
            return undefined;
        }

        const call = new FakeCall(peerId, {
            metadata: options.metadata,
            peerConnection: options.peerConnection,
        });
        this.calls.at(-1).call = call;
        return call;
    }
}

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

const createSignalingFixture = () => {
    const io = new FakeIo();
    const validRooms = new Set(['lobby', 'game', 'project']);
    const signaling = createVoiceCallSignaling({
        io,
        resolveRoomId: (roomId) =>
            validRooms.has(roomId) ? roomId : undefined,
    });

    return { io, signaling };
};

const getEvents = (socket, event) =>
    socket.emitted.filter((entry) => entry.event === event);

const createGate = (streams = []) =>
    createCallGate({
        onStream: ({ peerId, stream }) => streams.push({ peerId, stream }),
    });

test('two sequential joins assign only the new peer as caller', async () => {
    const { io, signaling } = createSignalingFixture();
    const socketA = new FakeSocket(io, 'socket-a');
    const socketB = new FakeSocket(io, 'socket-b');

    await signaling.join({ roomId: 'lobby', peerId: 'A' }, socketA);
    await signaling.join({ roomId: 'lobby', peerId: 'B' }, socketB);
    await signaling.join({ roomId: 'lobby', peerId: 'B' }, socketB);

    assert.deepEqual(getEvents(socketA, 'voice:call-targets')[0].payload, {
        peerIds: [],
        roomId: 'lobby',
    });
    assert.deepEqual(getEvents(socketB, 'voice:call-targets')[0].payload, {
        peerIds: ['A'],
        roomId: 'lobby',
    });
    assert.equal(getEvents(socketB, 'voice:call-targets').length, 1);

    const aStreams = [];
    const bStreams = [];
    const gateA = createGate(aStreams);
    const gateB = createGate(bStreams);
    const peerB = new FakePeer();
    const streamA = { id: 'stream-a' };
    const streamB = { id: 'stream-b' };
    const outgoing = gateB.callPeer({
        peer: peerB,
        peerId: 'A',
        stream: streamB,
    });
    const incoming = new FakeCall('B', { metadata: outgoing.metadata });

    gateA.answerCall({ call: incoming, stream: streamA });
    outgoing.emit('stream', streamA);
    incoming.emit('stream', streamB);

    assert.equal(peerB.calls.length, 1);
    assert.equal(incoming.answerCount, 1);
    assert.deepEqual(aStreams, [{ peerId: 'B', stream: streamB }]);
    assert.deepEqual(bStreams, [{ peerId: 'A', stream: streamA }]);
});

test('three sequential joins produce exactly the three unique peer pairs', async () => {
    const { io, signaling } = createSignalingFixture();
    const sockets = ['A', 'B', 'C'].map(
        (peerId) => new FakeSocket(io, `socket-${peerId}`)
    );

    await sockets.reduce(
        (previous, socket, index) =>
            previous.then(() =>
                signaling.join(
                    { roomId: 'lobby', peerId: ['A', 'B', 'C'][index] },
                    socket
                )
            ),
        Promise.resolve()
    );

    const peers = new Map(
        ['A', 'B', 'C'].map((peerId) => [peerId, new FakePeer()])
    );
    const gates = new Map(
        ['A', 'B', 'C'].map((peerId) => [peerId, createGate()])
    );
    const pairs = [];

    sockets.forEach((socket, index) => {
        const callerId = ['A', 'B', 'C'][index];
        const { peerIds } = getEvents(socket, 'voice:call-targets')[0].payload;
        peerIds.forEach((peerId) => {
            gates.get(callerId).callPeer({
                peer: peers.get(callerId),
                peerId,
                stream: { id: `stream-${callerId}` },
            });
            pairs.push(`${callerId}->${peerId}`);
        });
    });

    assert.deepEqual(pairs, ['B->A', 'C->A', 'C->B']);
    assert.equal(
        Array.from(peers.values()).reduce(
            (total, peer) => total + peer.calls.length,
            0
        ),
        3
    );
});

test('duplicate call instructions are idempotent while pending or active', () => {
    const gate = createGate();
    const peer = new FakePeer();
    const stream = { id: 'stream' };
    let pendingResult;
    peer.onCall = () => {
        peer.onCall = undefined;
        pendingResult = gate.callPeer({ peer, peerId: 'A', stream });
    };

    const first = gate.callPeer({ peer, peerId: 'A', stream });
    const second = gate.callPeer({ peer, peerId: 'A', stream });

    assert.equal(pendingResult, undefined);
    assert.equal(first, second);
    assert.equal(peer.calls.length, 1);
    assert.equal(first.listenerCount('stream'), 1);
    assert.equal(first.listenerCount('close'), 1);
    assert.deepEqual(
        { ...gate.getState('A') },
        {
            direction: 'outgoing',
            refreshKey: undefined,
            state: 'active',
        }
    );
});

test('close, error, leave, and same-peer-id rejoin all release the gate', () => {
    const gate = createGate();
    const peer = new FakePeer();
    const stream = { id: 'stream' };

    const first = gate.callPeer({ peer, peerId: 'A', stream });
    first.emit('close');
    const second = gate.callPeer({ peer, peerId: 'A', stream });
    second.emit('error', new Error('network'));
    const third = gate.callPeer({ peer, peerId: 'A', stream });
    gate.closePeer('A');
    const rejoined = gate.callPeer({ peer, peerId: 'A', stream });

    assert.notEqual(first, second);
    assert.notEqual(second, third);
    assert.notEqual(third, rejoined);
    assert.equal(third.closeCount, 1);
    assert.equal(peer.calls.length, 4);
});

test('throwing and empty peer.call results release pending state for retry', () => {
    const gate = createGate();
    const peer = new FakePeer();
    const stream = { id: 'stream' };

    peer.mode = 'throw';
    assert.equal(gate.callPeer({ peer, peerId: 'A', stream }), undefined);
    assert.equal(gate.getState('A'), undefined);

    peer.mode = 'empty';
    assert.equal(gate.callPeer({ peer, peerId: 'A', stream }), undefined);
    assert.equal(gate.getState('A'), undefined);

    peer.mode = 'call';
    assert.ok(gate.callPeer({ peer, peerId: 'A', stream }));
    assert.equal(peer.calls.length, 3);
});

test('incoming calls answer once, bind one stream handler, and never dial back', () => {
    const streams = [];
    const gate = createGate(streams);
    const incoming = new FakeCall('B');
    const duplicate = new FakeCall('B');
    const localStream = { id: 'local' };

    gate.answerCall({ call: incoming, stream: localStream });
    gate.answerCall({ call: incoming, stream: localStream });
    gate.answerCall({ call: duplicate, stream: localStream });
    incoming.emit('stream', { id: 'remote' });

    assert.equal(incoming.answerCount, 1);
    assert.equal(incoming.listenerCount('stream'), 1);
    assert.equal(duplicate.answerCount, 0);
    assert.equal(duplicate.closeCount, 1);
    assert.deepEqual(streams, [{ peerId: 'B', stream: { id: 'remote' } }]);
});

test('refresh keeps the original caller direction and replaces calls sequentially', () => {
    const outgoingGate = createGate();
    const incomingGate = createGate();
    const peer = new FakePeer();
    const stream = { id: 'stream' };
    const firstOutgoing = outgoingGate.callPeer({
        peer,
        peerId: 'A',
        stream,
    });
    const firstIncoming = new FakeCall('B');
    incomingGate.answerCall({ call: firstIncoming, stream });

    const refreshedOutgoing = outgoingGate.callPeer({
        peer,
        peerId: 'A',
        refreshKey: 'B:1',
        stream,
    });
    const refreshedIncoming = new FakeCall('B', {
        metadata: refreshedOutgoing.metadata,
    });
    incomingGate.answerCall({ call: refreshedIncoming, stream });
    outgoingGate.callPeer({
        peer,
        peerId: 'A',
        refreshKey: 'B:1',
        stream,
    });

    assert.equal(firstOutgoing.closeCount, 1);
    assert.equal(firstIncoming.closeCount, 1);
    assert.equal(refreshedIncoming.answerCount, 1);
    assert.equal(peer.calls.length, 2);
    assert.equal(outgoingGate.getState('A').direction, 'outgoing');
    assert.equal(incomingGate.getState('B').direction, 'incoming');
});

test('duplicate and out-of-order refresh revisions are idempotent but failures retry', () => {
    const revisions = createRefreshRevisionGate();
    const applied = [];

    revisions.apply('A', 2, () => applied.push(2));
    revisions.apply('A', 1, () => applied.push(1));
    revisions.apply('A', 2, () => applied.push(2));
    revisions.apply('A', 3, () => undefined);
    revisions.apply('A', 3, () => applied.push(3));

    assert.deepEqual(applied, [2, 3]);
});

test('track replacement targets one sender on the gated call only', async () => {
    const replacedTracks = [];
    const audioSender = {
        track: { kind: 'audio' },
        replaceTrack: async (track) => replacedTracks.push(track),
    };
    const videoSender = {
        track: { kind: 'video' },
        replaceTrack: async (track) => replacedTracks.push(track),
    };
    const peer = new FakePeer();
    const gate = createGate();
    const call = gate.callPeer({
        peer,
        peerId: 'A',
        stream: { id: 'stream' },
        options: {
            peerConnection: {
                getSenders: () => [audioSender, videoSender],
                getTransceivers: () => [],
            },
        },
    });
    call.peerConnection = peer.calls[0].options.peerConnection;
    const nextVideoTrack = { id: 'camera', kind: 'video' };

    assert.equal(await gate.replaceTrack('A', 'video', nextVideoTrack), true);
    assert.deepEqual(replacedTracks, [nextVideoTrack]);
    assert.equal(peer.calls.length, 1);
});

test('server refresh uses socket-owned room and peer state', async () => {
    const { io, signaling } = createSignalingFixture();
    const socketA = new FakeSocket(io, 'socket-a');
    const socketB = new FakeSocket(io, 'socket-b');
    await signaling.join({ roomId: 'lobby', peerId: 'A' }, socketA);
    await signaling.join({ roomId: 'lobby', peerId: 'B' }, socketB);

    const result = signaling.requestRefresh(socketA);

    assert.deepEqual(result, { ok: true, revision: 1 });
    assert.deepEqual(getEvents(socketB, 'voice:refresh-peer')[0].payload, {
        peerId: 'A',
        revision: 1,
        roomId: 'lobby',
    });
});

test('invalid voice join cannot leave room or owner state behind', async () => {
    const { io, signaling } = createSignalingFixture();
    const socket = new FakeSocket(io, 'socket-invalid');

    const result = await signaling.join(
        { roomId: 'arbitrary', peerId: '../peer' },
        socket
    );

    assert.equal(result.ok, false);
    assert.deepEqual(Array.from(socket.rooms), ['socket-invalid']);
    assert.deepEqual(socket.data, {});
    assert.equal(getEvents(socket, 'voice:call-targets').length, 0);
});

test('client and server contain only the new voice call signaling events', () => {
    const serverSource = readFileSync(
        new URL('../src/server.js', import.meta.url),
        'utf8'
    );
    const scriptSource = readFileSync(
        new URL('../src/views/script.js', import.meta.url),
        'utf8'
    );
    const templateSource = readFileSync(
        new URL('../src/views/room/index.ejs', import.meta.url),
        'utf8'
    );

    assert.match(serverSource, /socket\.on\('voice:join'/);
    assert.match(scriptSource, /'voice:call-targets'/);
    assert.doesNotMatch(serverSource, /userConnected|socket\.on\('joinRoom'/);
    assert.doesNotMatch(scriptSource, /userConnected|'joinRoom'/);
    assert.ok(
        templateSource.indexOf('/js/voice/voice-call-protocol.js') <
            templateSource.indexOf('/script.js')
    );
});
