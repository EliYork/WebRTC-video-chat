import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import {
    StrictMediaNetwork,
    StrictStream,
    StrictTrack,
} from './helpers/strict_media_peer.mjs';

const protocolSource = readFileSync(
    new URL('../src/views/js/voice/voice-call-protocol.js', import.meta.url),
    'utf8'
);
const registrySource = readFileSync(
    new URL('../src/views/js/voice/voice-peer-registry.js', import.meta.url),
    'utf8'
);
const registryWindow = {};
vm.runInNewContext(protocolSource, {
    URLSearchParams,
    window: registryWindow,
});
vm.runInNewContext(registrySource, { window: registryWindow });
const { createRegistry } = registryWindow.VoicePeerRegistry;

const createFixture = (id, network) => {
    const cleanups = [];
    const debug = [];
    const tiles = new Map();
    const peer = network.addPeer(id);
    const registry = createRegistry({
        attachRemoteStream: ({ peerId, stream }) => {
            const tile = tiles.get(peerId) || { peerId, srcObject: null };
            tile.srcObject = stream;
            tiles.set(peerId, tile);
            return tile;
        },
        createRemoteStream: ({ currentStream, incomingStream }) => {
            const result = currentStream || new StrictStream();
            result.getTracks().forEach((track) => result.removeTrack(track));
            incomingStream
                ?.getTracks?.()
                .forEach((track) => result.addTrack(track));
            return result;
        },
        detachRemoteStream: ({ tile }) => {
            if (tile) {
                tile.srcObject = null;
            }
        },
        onDebug: (event) => debug.push(event),
        onPeerCleanup: (event) => cleanups.push(event),
        removeRemoteTile: ({ peerId }) => tiles.delete(peerId),
    });
    peer.onCall = (call) => registry.answerCall({ call });
    return { cleanups, debug, peer, registry, tiles };
};

const audio = (id) => new StrictTrack('audio', id);
const video = (id) => new StrictTrack('video', id);
const stream = (...tracks) => new StrictStream(tracks);
const publish = (fixture, peerId, generation, mediaStream) =>
    fixture.registry.callPeer({
        generation,
        peer: fixture.peer,
        peerId,
        stream: mediaStream,
    });

test('empty local snapshots never create data-only MediaConnections', () => {
    const network = new StrictMediaNetwork();
    const a = createFixture('A', network);
    createFixture('B', network);

    assert.equal(publish(a, 'B', 1, new StrictStream()), undefined);
    assert.equal(a.peer.calls.length, 0);
    assert.equal(a.registry.getSnapshot('B'), undefined);
});

test('incoming send calls are answered once without a reverse local stream', () => {
    const network = new StrictMediaNetwork();
    const a = createFixture('A', network);
    const b = createFixture('B', network);

    publish(a, 'B', 1, stream(audio('a-mic')));
    network.flush();
    const incoming = network.calls[0].answerer;

    assert.equal(incoming.answerCount, 1);
    assert.equal(incoming.answerStream, undefined);
    assert.equal(b.registry.getSnapshot('A').incomingCall, incoming);
    assert.equal(b.registry.getSnapshot('A').outgoingCall, undefined);
});

test('duplicate and stale outgoing generations cannot create duplicate calls', () => {
    const network = new StrictMediaNetwork();
    const a = createFixture('A', network);
    createFixture('B', network);
    const first = publish(a, 'B', 2, stream(audio('mic')));

    assert.equal(publish(a, 'B', 2, stream(video('same'))), first);
    assert.equal(publish(a, 'B', 1, stream(video('stale'))), first);
    network.flush();
    assert.equal(a.peer.calls.length, 1);
    assert.equal(a.registry.getSnapshot('B').outgoingGeneration, 2);
});

test('new outgoing generation immediately becomes the sole direction owner', () => {
    const network = new StrictMediaNetwork();
    const a = createFixture('A', network);
    const b = createFixture('B', network);
    const first = publish(a, 'B', 1, stream(video('camera')));
    network.flush();
    const second = publish(a, 'B', 2, stream(video('screen')));

    assert.equal(a.registry.getSnapshot('B').outgoingCall, second);
    assert.equal(a.registry.getSnapshot('B').outgoingPendingCall, undefined);
    assert.equal(first.closeCount, 1);
    network.flush();
    assert.equal(a.registry.getSnapshot('B').outgoingCall, second);
    assert.equal(a.registry.getSnapshot('B').outgoingPendingCall, undefined);
    assert.equal(
        b.registry.getSnapshot('A').remoteStream.getVideoTracks()[0].id,
        'screen'
    );
});

test('incoming and outgoing directions have independent owners and cleanup', () => {
    const network = new StrictMediaNetwork();
    const a = createFixture('A', network);
    const b = createFixture('B', network);
    publish(a, 'B', 1, stream(video('a-video')));
    publish(b, 'A', 1, stream(audio('b-audio')));
    network.flush();

    a.registry.stopOutgoing('B', {
        generation: 2,
        reason: 'local-no-media',
    });

    const snapshot = a.registry.getSnapshot('B');
    assert.equal(snapshot.outgoingCall, undefined);
    assert.ok(snapshot.incomingCall);
    assert.equal(snapshot.remoteStream.getAudioTracks()[0].id, 'b-audio');
    assert.equal(b.registry.getSnapshot('A').remoteStream, null);
});

test('late old incoming events cannot replace current remote media', () => {
    const network = new StrictMediaNetwork();
    const a = createFixture('A', network);
    const b = createFixture('B', network);
    publish(a, 'B', 1, stream(video('camera')));
    network.flush();
    const oldIncoming = network.calls[0].answerer;
    publish(a, 'B', 2, stream(video('screen')));
    network.flush();

    oldIncoming.emit('stream', stream(video('late-camera')));
    oldIncoming.emit('error', new Error('late'));
    assert.equal(
        b.registry.getSnapshot('A').remoteStream.getVideoTracks()[0].id,
        'screen'
    );
});

test('ended tracks clear remote media without deleting the presence tile', () => {
    const network = new StrictMediaNetwork();
    const a = createFixture('A', network);
    const b = createFixture('B', network);
    const mic = audio('mic');
    const camera = video('camera');
    publish(a, 'B', 1, stream(mic, camera));
    network.flush();

    camera.end();
    assert.equal(
        b.registry.getSnapshot('A').remoteStream.getAudioTracks().length,
        1
    );
    mic.end();
    assert.equal(b.registry.getSnapshot('A').remoteStream, null);
    assert.equal(b.tiles.has('A'), true);
});

test('peer cleanup and teardown close both directions once and are idempotent', () => {
    const network = new StrictMediaNetwork();
    const a = createFixture('A', network);
    const b = createFixture('B', network);
    publish(a, 'B', 1, stream(audio('a')));
    publish(b, 'A', 1, stream(audio('b')));
    network.flush();
    const calls = network.calls.flatMap(({ answerer, caller }) => [
        answerer,
        caller,
    ]);

    assert.equal(a.registry.cleanupPeer('B', 'leave'), true);
    assert.equal(a.registry.cleanupPeer('B', 'duplicate'), false);
    assert.equal(a.registry.teardown('teardown'), 0);
    assert.equal(a.registry.getSnapshot('B'), undefined);
    assert.equal(a.cleanups.length, 1);
    calls.forEach((call) => assert.ok(call.closeCount <= 1));
});

test('PeerJS disconnect blocks new calls but preserves established directions', () => {
    const network = new StrictMediaNetwork();
    const a = createFixture('A', network);
    createFixture('B', network);
    const current = publish(a, 'B', 1, stream(audio('mic')));
    network.flush();

    a.registry.setSessionDisconnected(true);
    assert.equal(publish(a, 'B', 2, stream(video('screen'))), undefined);
    assert.equal(a.registry.getSnapshot('B').outgoingCall, current);
});
