import assert from 'node:assert/strict';

export class FakeEventTarget {
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

    emitEvent(event, value) {
        (this.listeners.get(event) || [])
            .slice()
            .forEach((listener) => listener(value));
    }

    listenerCount(event) {
        return (this.listeners.get(event) || []).length;
    }
}

export class StrictTrack extends FakeEventTarget {
    constructor(kind, id, { enabled = true } = {}) {
        super();
        this.enabled = enabled;
        this.id = id;
        this.kind = kind;
        this.readyState = 'live';
    }

    end() {
        this.readyState = 'ended';
        this.emitEvent('ended');
    }
}

export class StrictStream extends FakeEventTarget {
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
        this.emitEvent('inactive');
    }
}

const mediaSdp = (kinds) =>
    [
        'v=0',
        ...kinds.map(
            (kind) =>
                `m=${kind} 9 UDP/TLS/RTP/SAVPF ${
                    kind === 'audio' ? '111' : '96'
                }`
        ),
        'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    ].join('\r\n');

const countKinds = (kinds) =>
    kinds.reduce((counts, kind) => {
        counts[kind] = (counts[kind] || 0) + 1;
        return counts;
    }, {});

class StrictPeerConnection extends FakeEventTarget {
    constructor({ localKinds = [], remoteKinds = [] } = {}) {
        super();
        this.connectionState = 'new';
        this.iceConnectionState = 'new';
        this.localDescription = localKinds.length
            ? { sdp: mediaSdp(localKinds), type: 'offer' }
            : null;
        this.remoteDescription = remoteKinds.length
            ? { sdp: mediaSdp(remoteKinds), type: 'offer' }
            : null;
        this.senders = localKinds.map((kind) => ({
            track: { kind },
        }));
        this.transceivers = [
            ...localKinds.map((kind, index) => ({
                receiver: { track: { kind } },
                sender: this.senders[index],
            })),
            ...remoteKinds.map((kind) => ({
                receiver: { track: { kind } },
                sender: { track: null },
            })),
        ];
    }

    connect() {
        this.connectionState = 'connected';
        this.iceConnectionState = 'connected';
        this.emitEvent('connectionstatechange');
        this.emitEvent('iceconnectionstatechange');
    }

    getSenders() {
        return [...this.senders];
    }

    getTransceivers() {
        return [...this.transceivers];
    }
}

export class StrictCall {
    constructor(peer, { localStream, metadata, offerKinds, network } = {}) {
        this.answerCount = 0;
        this.closeCount = 0;
        this.listeners = new Map();
        this.localStream = localStream;
        this.metadata = metadata;
        this.network = network;
        this.offerKinds = [...offerKinds];
        this.open = false;
        this.peer = peer;
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
        const offered = countKinds(this.offerKinds);
        const answerKinds = (stream?.getTracks?.() || [])
            .filter((track) => track.readyState !== 'ended')
            .map((track) => track.kind);
        const answered = countKinds(answerKinds);

        for (const kind of ['audio', 'video']) {
            if ((answered[kind] || 0) > (offered[kind] || 0)) {
                const error = new Error(
                    `answer cannot add ${kind} beyond offered m-lines`
                );
                error.name = 'InvalidAccessError';
                throw error;
            }
        }

        this.network.completeAnswer(this, stream);
    }

    close() {
        this.network.closeCall(this);
    }
}

class StrictPeer {
    constructor(id, network) {
        this.calls = [];
        this.destroyed = false;
        this.id = id;
        this.network = network;
    }

    call(peerId, stream, options = {}) {
        const call = this.network.createCall(this, peerId, stream, options);
        this.calls.push(call);
        return call;
    }
}

export class StrictMediaNetwork {
    constructor() {
        this.calls = [];
        this.pending = [];
        this.peers = new Map();
    }

    addPeer(id) {
        const peer = new StrictPeer(id, this);
        this.peers.set(id, peer);
        return peer;
    }

    createCall(originPeer, remoteId, stream, options) {
        const remotePeer = this.peers.get(remoteId);
        assert.ok(remotePeer, `unknown strict peer ${remoteId}`);
        const tracks = (stream?.getTracks?.() || []).filter(
            (track) => track.readyState !== 'ended'
        );
        const offerKinds = tracks.map((track) => track.kind);
        const caller = new StrictCall(remoteId, {
            localStream: stream,
            metadata: options.metadata,
            network: this,
            offerKinds,
        });
        const answerer = new StrictCall(originPeer.id, {
            metadata: options.metadata,
            network: this,
            offerKinds,
        });
        caller.counterpart = answerer;
        answerer.counterpart = caller;
        caller.peerConnection = new StrictPeerConnection({
            localKinds: offerKinds,
        });
        answerer.peerConnection = new StrictPeerConnection({
            remoteKinds: offerKinds,
        });
        this.calls.push({
            answerer,
            caller,
            offerKinds,
            origin: originPeer.id,
        });
        this.pending.push(() => remotePeer.onCall?.(answerer));
        return caller;
    }

    completeAnswer(answerer, answerStream) {
        this.pending.push(() => {
            const caller = answerer.counterpart;
            const answerKinds = (answerStream?.getTracks?.() || [])
                .filter((track) => track.readyState !== 'ended')
                .map((track) => track.kind);
            answerer.peerConnection.localDescription = {
                sdp: mediaSdp(answerer.offerKinds),
                type: 'answer',
            };
            caller.peerConnection.remoteDescription = {
                sdp: mediaSdp(answerer.offerKinds),
                type: 'answer',
            };
            caller.open = true;
            answerer.open = true;
            if (answerKinds.length > 0) {
                caller.emit('stream', answerStream);
            }
            if (answerer.offerKinds.length > 0) {
                answerer.emit('stream', caller.localStream);
            }
            caller.peerConnection.connect();
            answerer.peerConnection.connect();
        });
    }

    closeCall(call) {
        if (call.closed) {
            return;
        }
        call.closed = true;
        call.closeCount += 1;
        call.emit('close');
        const counterpart = call.counterpart;
        if (counterpart && !counterpart.closed) {
            counterpart.closed = true;
            counterpart.closeCount += 1;
            counterpart.emit('close');
        }
    }

    flush() {
        while (this.pending.length > 0) {
            this.pending.shift()();
        }
    }
}

export const getMediaSections = (description) =>
    Array.from(
        String(description?.sdp || '').matchAll(/^m=(audio|video)\s/gm),
        (match) => match[1]
    );
