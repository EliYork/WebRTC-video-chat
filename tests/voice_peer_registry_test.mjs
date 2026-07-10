import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const registrySource = readFileSync(
    new URL('../src/views/js/voice/voice-peer-registry.js', import.meta.url),
    'utf8'
);
const registryWindow = {};
vm.runInNewContext(registrySource, { window: registryWindow });
const { createRegistry } = registryWindow.VoicePeerRegistry;

class FakeEventTarget {
    constructor() {
        this.listeners = new Map();
    }

    addEventListener(event, listener) {
        const listeners = this.listeners.get(event) || [];
        listeners.push(listener);
        this.listeners.set(event, listeners);
    }

    removeEventListener(event, listener) {
        this.listeners.set(
            event,
            (this.listeners.get(event) || []).filter(
                (current) => current !== listener
            )
        );
    }

    emit(event, value) {
        (this.listeners.get(event) || [])
            .slice()
            .forEach((listener) => listener(value));
    }

    listenerCount(event) {
        return (this.listeners.get(event) || []).length;
    }
}

class FakeTrack extends FakeEventTarget {
    constructor(kind, id) {
        super();
        this.id = id;
        this.kind = kind;
        this.readyState = 'live';
    }

    end() {
        this.readyState = 'ended';
        this.emit('ended');
    }
}

class FakeStream extends FakeEventTarget {
    constructor(tracks = []) {
        super();
        this.tracks = [...tracks];
    }

    addTrack(track) {
        if (!this.tracks.includes(track)) {
            this.tracks.push(track);
        }
    }

    removeTrack(track) {
        this.tracks = this.tracks.filter((current) => current !== track);
    }

    getTracks() {
        return [...this.tracks];
    }

    getAudioTracks() {
        return this.tracks.filter((track) => track.kind === 'audio');
    }

    getVideoTracks() {
        return this.tracks.filter((track) => track.kind === 'video');
    }

    becomeInactive() {
        this.emit('inactive');
    }
}

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

    off(event, listener) {
        this.listeners.set(
            event,
            (this.listeners.get(event) || []).filter(
                (current) => current !== listener
            )
        );
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
        this.peerConnections = new Map();
    }

    call(peerId, stream, options) {
        if (this.mode === 'throw') {
            throw new Error('call creation failed');
        }
        if (this.mode === 'empty') {
            return undefined;
        }

        const call = new FakeCall(peerId, {
            metadata: options.metadata,
            peerConnection: this.peerConnections.get(peerId),
        });
        this.calls.push({ call, options, peerId, stream });
        return call;
    }
}

class FakeDocument {
    constructor() {
        this.tiles = new Map();
    }

    ensureTile(peerId) {
        let tile = this.tiles.get(peerId);
        if (!tile) {
            tile = {
                attachCount: 0,
                id: peerId,
                mediaElement: { srcObject: null },
                removeCount: 0,
            };
            this.tiles.set(peerId, tile);
        }
        return tile;
    }

    removeTile(peerId, expectedTile) {
        const tile = this.tiles.get(peerId);
        if (!tile || (expectedTile && tile !== expectedTile)) {
            return;
        }
        tile.removeCount += 1;
        this.tiles.delete(peerId);
    }
}

const replaceTracks = (stream, kind, tracks) => {
    stream[`get${kind === 'audio' ? 'Audio' : 'Video'}Tracks`]().forEach(
        (track) => stream.removeTrack(track)
    );
    tracks.forEach((track) => stream.addTrack(track));
};

const createFixture = () => {
    const document = new FakeDocument();
    const cleanups = [];
    const mediaStates = [];
    const replacementFailures = [];
    const registry = createRegistry({
        attachRemoteStream: ({ peerId, stream }) => {
            const tile = document.ensureTile(peerId);
            tile.attachCount += 1;
            tile.mediaElement.srcObject = stream;
            return tile;
        },
        createRemoteStream: ({ clearVideo, currentStream, incomingStream }) => {
            const stream = currentStream || new FakeStream();
            if (!incomingStream) {
                return stream;
            }

            const audioTracks = incomingStream.getAudioTracks();
            const videoTracks = incomingStream.getVideoTracks();
            if (audioTracks.length > 0) {
                replaceTracks(stream, 'audio', audioTracks);
            }
            if (videoTracks.length > 0 || clearVideo) {
                replaceTracks(stream, 'video', videoTracks);
            }
            return stream;
        },
        detachRemoteStream: ({ tile }) => {
            if (tile) {
                tile.mediaElement.srcObject = null;
            }
        },
        onPeerCleanup: (event) => cleanups.push(event),
        onRemoteMediaState: (event) => mediaStates.push(event),
        onReplacementFailed: (event) => replacementFailures.push(event),
        removeRemoteTile: ({ peerId, tile }) =>
            document.removeTile(peerId, tile),
    });

    return {
        cleanups,
        document,
        mediaStates,
        registry,
        replacementFailures,
    };
};

const activateOutgoing = (
    fixture,
    peer,
    peerId,
    tracks = [new FakeTrack('audio', `${peerId}-audio`)]
) => {
    const call = fixture.registry.callPeer({
        peer,
        peerId,
        stream: new FakeStream([new FakeTrack('audio', 'local-audio')]),
    });
    const incomingStream = new FakeStream(tracks);
    call.emit('stream', incomingStream);
    return { call, incomingStream };
};

test('normal call stream tile close lifecycle has one owner and full cleanup', () => {
    const fixture = createFixture();
    const peer = new FakePeer();
    const presenceTile = fixture.registry.ensurePeerTile('A');
    const { call, incomingStream } = activateOutgoing(fixture, peer, 'A');
    const snapshot = fixture.registry.getSnapshot('A');

    assert.equal(snapshot.call, call);
    assert.equal(snapshot.state, 'active');
    assert.equal(snapshot.tile, presenceTile);
    assert.equal(snapshot.remoteStream.getAudioTracks().length, 1);
    assert.equal(snapshot.tile.mediaElement.srcObject, snapshot.remoteStream);
    assert.equal(incomingStream.listenerCount('inactive'), 0);

    call.emit('close');

    assert.equal(fixture.registry.getSnapshot('A'), undefined);
    assert.equal(fixture.document.tiles.has('A'), false);
    assert.deepEqual(
        fixture.cleanups.map(({ reason }) => reason),
        ['call-close']
    );
});

test('cleanup is idempotent across leave close error and explicit cleanup', () => {
    const fixture = createFixture();
    const peer = new FakePeer();
    const callA = activateOutgoing(fixture, peer, 'A').call;
    const callB = activateOutgoing(fixture, peer, 'B').call;
    const tileA = fixture.document.tiles.get('A');

    assert.equal(fixture.registry.cleanupPeer('A', 'voice-peer-left'), true);
    callA.emit('close');
    callA.emit('error', new Error('late'));
    assert.equal(fixture.registry.cleanupPeer('A', 'duplicate'), false);

    assert.equal(callA.closeCount, 1);
    assert.equal(tileA.removeCount, 1);
    assert.equal(fixture.registry.getSnapshot('A'), undefined);
    assert.equal(fixture.registry.getSnapshot('B').call, callB);
    assert.equal(fixture.document.tiles.has('B'), true);
});

test('three peers remain isolated and sender lookup uses the current call only', async () => {
    const fixture = createFixture();
    const peer = new FakePeer();
    const replacements = [];

    ['A', 'B', 'C'].forEach((peerId) => {
        const sender = {
            track: { kind: 'video' },
            replaceTrack: async (track) => replacements.push({ peerId, track }),
        };
        peer.peerConnections.set(peerId, {
            getSenders: () => [sender],
            getTransceivers: () => [],
        });
        activateOutgoing(fixture, peer, peerId);
    });

    fixture.registry.cleanupPeer('B', 'voice-peer-left');
    const nextTrack = new FakeTrack('video', 'camera');

    assert.equal(
        await fixture.registry.replaceTrack('A', 'video', nextTrack),
        true
    );
    assert.equal(
        await fixture.registry.replaceTrack('B', 'video', nextTrack),
        false
    );
    assert.equal(
        await fixture.registry.replaceTrack('C', 'video', nextTrack),
        true
    );
    assert.deepEqual(Array.from(fixture.registry.getPeerIds()).sort(), [
        'A',
        'C',
    ]);
    assert.deepEqual(Array.from(fixture.document.tiles.keys()).sort(), [
        'A',
        'C',
    ]);
    assert.deepEqual(
        replacements.map(({ peerId }) => peerId),
        ['A', 'C']
    );
});

test('replacement ignores late old call events and atomically reuses the tile', () => {
    const fixture = createFixture();
    const peer = new FakePeer();
    const { call: oldCall } = activateOutgoing(fixture, peer, 'A');
    const tile = fixture.document.tiles.get('A');
    const newCall = fixture.registry.callPeer({
        peer,
        peerId: 'A',
        refreshKey: 'local:2',
        stream: new FakeStream(),
    });
    const nextStream = new FakeStream([new FakeTrack('video', 'next-video')]);

    oldCall.emit('stream', new FakeStream([new FakeTrack('audio', 'late')]));
    newCall.emit('stream', nextStream);
    oldCall.emit('close');
    oldCall.emit('error', new Error('late error'));

    const snapshot = fixture.registry.getSnapshot('A');
    assert.equal(snapshot.call, newCall);
    assert.equal(snapshot.state, 'active');
    assert.equal(snapshot.tile, tile);
    assert.equal(snapshot.remoteStream.getVideoTracks()[0].id, 'next-video');
    assert.equal(oldCall.closeCount, 1);
});

test('replacement creation and immediate failure preserve retryable prior state', () => {
    const fixture = createFixture();
    const peer = new FakePeer();
    const { call: oldCall } = activateOutgoing(fixture, peer, 'A');
    const oldStream = fixture.registry.getSnapshot('A').remoteStream;

    peer.mode = 'throw';
    assert.equal(
        fixture.registry.callPeer({
            peer,
            peerId: 'A',
            refreshKey: 'local:2',
            stream: new FakeStream(),
        }),
        undefined
    );
    assert.equal(fixture.registry.getSnapshot('A').call, oldCall);

    peer.mode = 'call';
    const failedReplacement = fixture.registry.callPeer({
        peer,
        peerId: 'A',
        refreshKey: 'local:2',
        stream: new FakeStream(),
    });
    failedReplacement.emit('error', new Error('immediate'));

    assert.equal(fixture.registry.getSnapshot('A').call, oldCall);
    assert.equal(fixture.registry.getSnapshot('A').state, 'active');
    assert.equal(failedReplacement.closeCount, 1);
    assert.equal(fixture.replacementFailures.length, 1);
    oldStream.becomeInactive();
    assert.equal(fixture.registry.getSnapshot('A'), undefined);
    assert.ok(
        fixture.registry.callPeer({
            peer,
            peerId: 'A',
            refreshKey: 'local:2',
            stream: new FakeStream(),
        })
    );
});

test('same stream is idempotent and a new stream reuses tile and listeners', () => {
    const fixture = createFixture();
    const peer = new FakePeer();
    const firstTrack = new FakeTrack('audio', 'first');
    const { call, incomingStream } = activateOutgoing(fixture, peer, 'A', [
        firstTrack,
    ]);
    const firstSnapshot = fixture.registry.getSnapshot('A');
    const firstAttachCount = firstSnapshot.tile.attachCount;

    call.emit('stream', incomingStream);
    assert.equal(firstSnapshot.tile.attachCount, firstAttachCount);

    const nextTrack = new FakeTrack('audio', 'next');
    call.emit('stream', new FakeStream([nextTrack]));
    const nextSnapshot = fixture.registry.getSnapshot('A');

    assert.equal(nextSnapshot.tile, firstSnapshot.tile);
    assert.equal(firstTrack.listenerCount('ended'), 0);
    assert.equal(nextTrack.listenerCount('ended'), 1);
    assert.equal(nextSnapshot.remoteStream.getAudioTracks()[0], nextTrack);
});

test('track ended keeps surviving media but all-ended and inactive clean up', () => {
    const fixture = createFixture();
    const peer = new FakePeer();
    const audio = new FakeTrack('audio', 'audio');
    const video = new FakeTrack('video', 'video');
    activateOutgoing(fixture, peer, 'A', [audio, video]);

    video.end();
    assert.equal(fixture.registry.getSnapshot('A').state, 'active');
    assert.equal(
        fixture.registry.getSnapshot('A').remoteStream.getVideoTracks().length,
        0
    );
    assert.equal(fixture.document.tiles.has('A'), true);

    audio.end();
    assert.equal(fixture.registry.getSnapshot('A'), undefined);

    const audioB = new FakeTrack('audio', 'audio-b');
    const videoB = new FakeTrack('video', 'video-b');
    activateOutgoing(fixture, peer, 'B', [audioB, videoB]);
    audioB.end();
    assert.equal(fixture.registry.getSnapshot('B').state, 'active');
    assert.equal(
        fixture.registry.getSnapshot('B').remoteStream.getAudioTracks().length,
        0
    );

    const streamC = activateOutgoing(fixture, peer, 'C').incomingStream;
    fixture.registry.getSnapshot('C').remoteStream.becomeInactive();
    assert.equal(fixture.registry.getSnapshot('C'), undefined);
    assert.equal(streamC.listenerCount('inactive'), 0);
});

test('leave and rejoin can rebuild the same or a new peer without stale state', () => {
    const fixture = createFixture();
    const peer = new FakePeer();
    const firstCall = activateOutgoing(fixture, peer, 'A').call;
    const firstTile = fixture.document.tiles.get('A');

    fixture.registry.cleanupPeer('A', 'voice-peer-left');
    const secondCall = activateOutgoing(fixture, peer, 'A').call;
    const secondTile = fixture.document.tiles.get('A');
    const thirdCall = activateOutgoing(fixture, peer, 'B').call;

    assert.notEqual(firstCall, secondCall);
    assert.notEqual(firstTile, secondTile);
    assert.equal(fixture.registry.getSnapshot('A').call, secondCall);
    assert.equal(fixture.registry.getSnapshot('B').call, thirdCall);
});

test('local teardown closes every call once and is idempotent', () => {
    const fixture = createFixture();
    const peer = new FakePeer();
    const calls = ['A', 'B', 'C'].map(
        (peerId) => activateOutgoing(fixture, peer, peerId).call
    );

    assert.equal(fixture.registry.teardown('local-voice-leave'), 3);
    assert.equal(fixture.registry.teardown('local-voice-leave'), 0);
    assert.deepEqual(
        calls.map((call) => call.closeCount),
        [1, 1, 1]
    );
    assert.equal(fixture.registry.getPeerIds().length, 0);
    assert.equal(fixture.document.tiles.size, 0);
});

test('PeerJS disconnected blocks new calls without deleting active media', () => {
    const fixture = createFixture();
    const peer = new FakePeer();
    const { call } = activateOutgoing(fixture, peer, 'A');

    fixture.registry.setSessionDisconnected(true);

    assert.equal(
        fixture.registry.callPeer({
            peer,
            peerId: 'B',
            stream: new FakeStream(),
        }),
        undefined
    );
    assert.equal(fixture.registry.getSnapshot('A').call, call);
    assert.equal(fixture.document.tiles.has('A'), true);
});
