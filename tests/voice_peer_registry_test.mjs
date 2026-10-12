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
    const attachments = [];
    const cleanups = [];
    const debug = [];
    const tiles = new Map();
    const peer = network.addPeer(id);
    const registry = createRegistry({
        attachRemoteStream: (attachment) => {
            const { peerId, stream } = attachment;
            attachments.push(attachment);
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
    return { attachments, cleanups, debug, peer, registry, tiles };
};

const audio = (id) => new StrictTrack('audio', id);
const video = (id) => new StrictTrack('video', id);
const stream = (...tracks) => new StrictStream(tracks);
const publish = (fixture, peerId, generation, mediaStream, options = {}) =>
    fixture.registry.callPeer({
        generation,
        options,
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

test('current incoming generation and track-role metadata reach the playback owner', () => {
    const network = new StrictMediaNetwork();
    const a = createFixture('A', network);
    const b = createFixture('B', network);
    const trackRoles = [
        { role: 'participant-audio', trackId: 'mic' },
        { role: 'screen-share-audio', trackId: 'screen' },
    ];

    publish(
        a,
        'B',
        3,
        stream(audio('mic'), audio('screen'), video('screen-video')),
        { metadata: { voiceMediaTrackRoles: trackRoles } }
    );
    network.flush();

    assert.equal(b.attachments.at(-1).generation, 3);
    assert.deepEqual(
        b.attachments.at(-1).metadata.voiceMediaTrackRoles,
        trackRoles
    );
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

test('local media changes replace existing sender tracks without rebuilding the call', async () => {
    const network = new StrictMediaNetwork();
    const a = createFixture('A', network);
    createFixture('B', network);
    const current = publish(
        a,
        'B',
        1,
        stream(audio('mic-old'), video('camera'))
    );
    network.flush();

    const firstReplacement = await a.registry.replaceOutgoingTracks({
        generation: 2,
        peerId: 'B',
        stream: stream(audio('mic-new'), video('screen')),
    });
    assert.equal(firstReplacement.ok, true);
    assert.equal(a.peer.calls.length, 1);
    assert.equal(a.registry.getSnapshot('B').outgoingCall, current);
    assert.deepEqual(
        current.peerConnection.getSenders().map(({ track }) => track.id),
        ['mic-new', 'screen']
    );

    const secondReplacement = await a.registry.replaceOutgoingTracks({
        generation: 3,
        peerId: 'B',
        stream: stream(audio('mic-new')),
    });
    assert.equal(secondReplacement.ok, true);
    assert.equal(current.peerConnection.getSenders()[1].track, null);
});

test('adding a sender kind reports one required renegotiation', async () => {
    const network = new StrictMediaNetwork();
    const a = createFixture('A', network);
    createFixture('B', network);
    publish(a, 'B', 1, stream(audio('mic')));
    network.flush();

    const replacement = await a.registry.replaceOutgoingTracks({
        generation: 2,
        peerId: 'B',
        stream: stream(audio('mic'), video('camera')),
    });
    assert.equal(replacement.ok, false);
    assert.equal(replacement.reason, 'renegotiation-required');
});

test('a failed track replacement returns a rebuild result and leaves the reverse microphone intact', async () => {
    const network = new StrictMediaNetwork();
    const a = createFixture('A', network);
    const b = createFixture('B', network);
    const current = publish(a, 'B', 1, stream(audio('a-mic')));
    publish(b, 'A', 1, stream(audio('b-mic')));
    network.flush();
    const reverse = a.registry.getSnapshot('B').incomingCall;
    current.peerConnection.getSenders()[0].replaceTrack = async () => { throw new Error('sender closed'); };
    const result = await a.registry.replaceOutgoingTracks({ generation: 2, peerId: 'B', stream: stream(audio('new-mic')) });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'replacement-failed');
    publish(a, 'B', 2, stream(audio('new-mic')));
    network.flush();
    assert.equal(a.registry.getSnapshot('B').incomingCall, reverse);
    assert.equal(a.registry.getSnapshot('B').remoteStream.getAudioTracks()[0].id, 'b-mic');
    assert.equal(b.registry.getSnapshot('A').remoteStream.getAudioTracks()[0].id, 'new-mic');
});

test('same-object remote track changes refresh playback once and old stream events cannot restore stale audio', async () => {
    const network = new StrictMediaNetwork();
    const a = createFixture('A', network);
    const b = createFixture('B', network);
    const incoming = stream(audio('first'));
    publish(a, 'B', 1, incoming);
    network.flush();
    const remote = b.registry.getSnapshot('A').incomingCall.remoteStream;
    // Use the actual incoming object emitted by this strict network.
    const source = remote || incoming;
    source.addTrack(audio('joined-mic'));
    source.emitEvent('addtrack');
    source.emitEvent('addtrack');
    await Promise.resolve();
    assert.ok(b.registry.getSnapshot('A').remoteStream.getAudioTracks().some((track) => track.id === 'joined-mic'));
    publish(a, 'B', 2, stream(audio('latest')));
    network.flush();
    source.emitEvent('addtrack');
    await Promise.resolve();
    assert.deepEqual(b.registry.getSnapshot('A').remoteStream.getAudioTracks().map((track) => track.id), ['latest']);
});

test('screen P2P codec offer composes existing transform and camera/codec transitions require fresh negotiation', async (t) => {
    vm.runInNewContext(readFileSync(new URL('../src/views/js/voice/voice-screen-codecs.js', import.meta.url), 'utf8'), { window: registryWindow });
    t.after(() => { delete registryWindow.VoiceScreenCodecs; });
    const network = new StrictMediaNetwork();
    const a = createFixture('A', network);
    createFixture('B', network);
    const screen = video('actual-screen');
    await registryWindow.VoiceScreenCodecs.prepare(screen, { frameRate: 60 }, { probe: async () => ({ passed: true, reason: 'passed' }) });
    const original = a.peer.call.bind(a.peer);
    let options;
    a.peer.call = (peerId, media, value) => { options = value; return original(peerId, media, value); };
    publish(a, 'B', 1, stream(audio('mic'), screen), { sdpTransform: (sdp) => sdp.replace('v=0', 'v=0\r\na=x-existing') });
    const answerer = network.calls[0].answerer;
    const originalAnswer = answerer.answer.bind(answerer);
    let answerOptions;
    answerer.answer = (media, value) => { assert.equal(media, undefined); answerOptions = value; return originalAnswer(media); };
    network.flush();
    const sdp = 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96 98\r\na=rtpmap:96 VP8/90000\r\na=rtpmap:98 H264/90000\r\na=fmtp:98 packetization-mode=1\r\n';
    assert.match(options.sdpTransform(sdp), /m=video 9 UDP\/TLS\/RTP\/SAVPF 98 96/);
    assert.match(options.sdpTransform(sdp), /a=x-existing/);
    assert.equal(options.metadata.screenVideoCodec, 'h264');
    assert.match(answerOptions.sdpTransform(sdp), /m=video 9 UDP\/TLS\/RTP\/SAVPF 98 96/);
    assert.equal(answerer.answerCount, 1);
    const parked = await a.registry.replaceOutgoingTracks({ generation: 2, peerId: 'B', stream: stream(audio('mic')) });
    assert.equal(parked.ok, true, 'parking screen video for SFU must retain the negotiated codec and sender slot');
    assert.equal(a.peer.calls.length, 1, 'SFU parking must not create a new offer loop');
    const resumed = await a.registry.replaceOutgoingTracks({ generation: 3, peerId: 'B', stream: stream(audio('mic'), screen) });
    assert.equal(resumed.ok, true, 'P2P fallback resumes the existing video slot');
    assert.equal(a.peer.calls.length, 1);
    const camera = video('camera');
    assert.equal((await a.registry.replaceOutgoingTracks({ generation: 4, peerId: 'B', stream: stream(audio('mic'), camera) })).reason, 'renegotiation-required');
    const vp8Screen = video('vp8-screen');
    await registryWindow.VoiceScreenCodecs.prepare(vp8Screen, { codecMode: 'vp8' });
    assert.equal((await a.registry.replaceOutgoingTracks({ generation: 4, peerId: 'B', stream: stream(audio('mic'), vp8Screen) })).reason, 'renegotiation-required');
    assert.equal(screen.readyState, 'live');
});
