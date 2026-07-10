import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import {
    getMediaSections,
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

const track = (kind, id) => new StrictTrack(kind, id);
const stream = (...tracks) => new StrictStream(tracks);

const replaceAllTracks = (target, incoming) => {
    target.getTracks().forEach((current) => target.removeTrack(current));
    incoming?.getTracks?.().forEach((current) => target.addTrack(current));
    return target;
};

const createEndpoint = (id, network) => {
    const tiles = new Map();
    const peer = network.addPeer(id);
    const registry = createRegistry({
        attachRemoteStream: ({ peerId, stream: remoteStream }) => {
            const tile = tiles.get(peerId) || {
                peerId,
                srcObject: null,
            };
            tile.srcObject = remoteStream;
            tiles.set(peerId, tile);
            return tile;
        },
        createRemoteStream: ({ currentStream, incomingStream }) =>
            replaceAllTracks(
                currentStream || new StrictStream(),
                incomingStream || new StrictStream()
            ),
        detachRemoteStream: ({ tile }) => {
            if (tile) {
                tile.srcObject = null;
            }
        },
        removeRemoteTile: ({ peerId }) => tiles.delete(peerId),
    });
    peer.onCall = (call) => registry.answerCall({ call });
    return { id, peer, registry, tiles };
};

const publish = (endpoint, remoteId, generation, mediaStream) =>
    endpoint.registry.callPeer({
        generation,
        peer: endpoint.peer,
        peerId: remoteId,
        stream: mediaStream,
    });

const remoteTracks = (endpoint, remoteId) =>
    endpoint.registry.getSnapshot(remoteId)?.remoteStream?.getTracks() || [];

test('strict SDP model rejects answer media kinds missing from the offer', () => {
    const network = new StrictMediaNetwork();
    const caller = network.addPeer('caller');
    const answerer = network.addPeer('answerer');
    answerer.onCall = (call) =>
        call.answer(stream(track('video', 'answerer-screen')));

    const call = caller.call('answerer', new StrictStream(), {
        constraints: {
            offerToReceiveAudio: true,
            offerToReceiveVideo: true,
        },
    });

    assert.deepEqual(
        getMediaSections(call.peerConnection.localDescription),
        []
    );
    assert.throws(
        () => network.flush(),
        /answer cannot add video beyond offered m-lines/
    );
});

test('caller without video and answerer later starting video use the reverse send call', () => {
    const network = new StrictMediaNetwork();
    const a = createEndpoint('A', network);
    const b = createEndpoint('B', network);

    publish(b, 'A', 1, stream(track('audio', 'b-mic')));
    network.flush();
    publish(a, 'B', 1, stream(track('video', 'a-screen')));
    network.flush();

    assert.deepEqual(
        remoteTracks(a, 'B').map(({ kind }) => kind),
        ['audio']
    );
    assert.deepEqual(
        remoteTracks(b, 'A').map(({ kind }) => kind),
        ['video']
    );
    assert.notEqual(
        a.registry.getSnapshot('B').outgoingCall,
        a.registry.getSnapshot('B').incomingCall
    );
});

test('caller without audio and answerer later starting mic gets an audio m-line', () => {
    const network = new StrictMediaNetwork();
    const a = createEndpoint('A', network);
    const b = createEndpoint('B', network);

    publish(b, 'A', 1, stream(track('video', 'b-camera')));
    network.flush();
    const audioCall = publish(a, 'B', 1, stream(track('audio', 'a-mic')));
    network.flush();

    assert.deepEqual(
        getMediaSections(audioCall.peerConnection.localDescription),
        ['audio']
    );
    assert.equal(remoteTracks(b, 'A')[0].id, 'a-mic');
});

test('both peers with microphones negotiate one audio send direction each', () => {
    const network = new StrictMediaNetwork();
    const a = createEndpoint('A', network);
    const b = createEndpoint('B', network);

    publish(a, 'B', 1, stream(track('audio', 'a-mic')));
    publish(b, 'A', 1, stream(track('audio', 'b-mic')));
    network.flush();

    assert.equal(remoteTracks(a, 'B')[0].id, 'b-mic');
    assert.equal(remoteTracks(b, 'A')[0].id, 'a-mic');
    assert.equal(network.calls.length, 2);
});

test('mic plus screen video in one direction coexists with reverse mic', () => {
    const network = new StrictMediaNetwork();
    const a = createEndpoint('A', network);
    const b = createEndpoint('B', network);

    const aCall = publish(
        a,
        'B',
        1,
        stream(track('audio', 'a-mic'), track('video', 'a-screen'))
    );
    publish(b, 'A', 1, stream(track('audio', 'b-mic')));
    network.flush();

    assert.deepEqual(getMediaSections(aCall.peerConnection.localDescription), [
        'audio',
        'video',
    ]);
    assert.deepEqual(
        remoteTracks(b, 'A').map(({ id }) => id),
        ['a-mic', 'a-screen']
    );
    assert.equal(remoteTracks(a, 'B')[0].id, 'b-mic');
});

test('camera to screen replaces only the local outgoing generation', () => {
    const network = new StrictMediaNetwork();
    const a = createEndpoint('A', network);
    const b = createEndpoint('B', network);

    const cameraCall = publish(
        a,
        'B',
        1,
        stream(track('audio', 'a-mic'), track('video', 'a-camera'))
    );
    network.flush();
    const screenCall = publish(
        a,
        'B',
        2,
        stream(track('audio', 'a-mic'), track('video', 'a-screen'))
    );
    network.flush();

    assert.equal(cameraCall.closeCount, 1);
    assert.equal(a.registry.getSnapshot('B').outgoingCall, screenCall);
    assert.equal(remoteTracks(b, 'A')[1].id, 'a-screen');
    assert.equal(b.registry.getSnapshot('A').outgoingCall, undefined);
});

test('screen stop restores camera and then supports authoritative audio-only', () => {
    const network = new StrictMediaNetwork();
    const a = createEndpoint('A', network);
    const b = createEndpoint('B', network);

    publish(a, 'B', 1, stream(track('audio', 'mic'), track('video', 'screen')));
    network.flush();
    const tile = b.tiles.get('A');
    const composedStream = tile.srcObject;
    publish(a, 'B', 2, stream(track('audio', 'mic'), track('video', 'camera')));
    network.flush();
    assert.equal(remoteTracks(b, 'A')[1].id, 'camera');

    const audioOnly = publish(a, 'B', 3, stream(track('audio', 'mic')));
    network.flush();
    assert.deepEqual(
        getMediaSections(audioOnly.peerConnection.localDescription),
        ['audio']
    );
    assert.deepEqual(
        remoteTracks(b, 'A').map(({ id }) => id),
        ['mic']
    );
    assert.equal(b.tiles.get('A'), tile);
    assert.notEqual(tile.srcObject, composedStream);
    assert.equal(tile.srcObject, b.registry.getSnapshot('A').remoteStream);
    assert.equal(tile.srcObject.getVideoTracks().length, 0);
    assert.equal(tile.srcObject.getAudioTracks()[0].id, 'mic');
});

test('microphone and screen audio keep two audio senders and m-lines', () => {
    const network = new StrictMediaNetwork();
    const a = createEndpoint('A', network);
    const b = createEndpoint('B', network);
    const call = publish(
        a,
        'B',
        1,
        stream(
            track('audio', 'microphone'),
            track('audio', 'screen-audio'),
            track('video', 'screen-video')
        )
    );
    network.flush();

    assert.deepEqual(getMediaSections(call.peerConnection.localDescription), [
        'audio',
        'audio',
        'video',
    ]);
    assert.equal(call.peerConnection.getSenders().length, 3);
    assert.deepEqual(
        remoteTracks(b, 'A').map(({ id }) => id),
        ['microphone', 'screen-audio', 'screen-video']
    );
});

test('late replacement stream and close events cannot overwrite the new generation', () => {
    const network = new StrictMediaNetwork();
    const a = createEndpoint('A', network);
    const b = createEndpoint('B', network);

    publish(a, 'B', 1, stream(track('video', 'camera')));
    network.flush();
    const oldIncoming = network.calls[0].answerer;
    publish(a, 'B', 2, stream(track('video', 'screen')));
    network.flush();

    oldIncoming.emit('stream', stream(track('video', 'late-camera')));
    oldIncoming.emit('close');
    assert.equal(remoteTracks(b, 'A')[0].id, 'screen');
    assert.equal(b.registry.getSnapshot('A').incomingGeneration, 2);
});

test('leave and same-peer rejoin clear both directions and accept a fresh generation', () => {
    const network = new StrictMediaNetwork();
    const a = createEndpoint('A', network);
    const b = createEndpoint('B', network);

    publish(a, 'B', 1, stream(track('audio', 'a-old')));
    publish(b, 'A', 1, stream(track('audio', 'b-old')));
    network.flush();
    assert.equal(a.registry.cleanupPeer('B', 'leave'), true);
    assert.equal(b.registry.cleanupPeer('A', 'leave'), true);
    assert.equal(a.registry.getSnapshot('B'), undefined);

    publish(a, 'B', 1, stream(track('audio', 'a-new')));
    publish(b, 'A', 1, stream(track('audio', 'b-new')));
    network.flush();
    assert.equal(remoteTracks(a, 'B')[0].id, 'b-new');
    assert.equal(remoteTracks(b, 'A')[0].id, 'a-new');
});

test('three peers support six explicit send directions without same-direction duplicates', () => {
    const network = new StrictMediaNetwork();
    const endpoints = ['A', 'B', 'C'].map((id) => createEndpoint(id, network));
    const media = new Map([
        ['A', stream(track('audio', 'a-mic'))],
        ['B', stream(track('video', 'b-camera'))],
        [
            'C',
            stream(
                track('audio', 'c-mic'),
                track('audio', 'c-screen-audio'),
                track('video', 'c-screen')
            ),
        ],
    ]);

    endpoints.forEach((origin) =>
        endpoints
            .filter((target) => target !== origin)
            .forEach((target) =>
                publish(origin, target.id, 1, media.get(origin.id))
            )
    );
    network.flush();

    assert.equal(network.calls.length, 6);
    endpoints.forEach((endpoint) => {
        endpoints
            .filter((remote) => remote !== endpoint)
            .forEach((remote) => {
                const snapshot = endpoint.registry.getSnapshot(remote.id);
                assert.ok(snapshot.incomingCall);
                assert.ok(snapshot.outgoingCall);
                assert.equal(snapshot.incomingPendingCall, undefined);
                assert.equal(snapshot.outgoingPendingCall, undefined);
            });
    });
});
