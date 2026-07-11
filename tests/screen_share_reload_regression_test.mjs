import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

class FakeEventTarget {
    constructor() {
        this.listeners = new Map();
    }

    addEventListener(event, listener) {
        const listeners = this.listeners.get(event) || [];
        listeners.push(listener);
        this.listeners.set(event, listeners);
    }

    emit(event) {
        (this.listeners.get(event) || [])
            .slice()
            .forEach((listener) => listener());
    }
}

class FakeTrack extends FakeEventTarget {
    constructor(kind, id, events = []) {
        super();
        this.events = events;
        this.id = id;
        this.kind = kind;
        this.readyState = 'live';
        this.stopCount = 0;
    }

    stop() {
        this.stopCount += 1;
        this.readyState = 'ended';
        this.events.push(`stop:${this.id}`);
        this.emit('ended');
    }
}

class FakeStream {
    constructor(tracks = []) {
        this.tracks = [...tracks];
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
}

const lifecycleSource = readFileSync(
    new URL('../src/views/js/voice/voice-media-lifecycle.js', import.meta.url),
    'utf8'
);
const lifecycleWindow = { MediaStream: FakeStream };
vm.runInNewContext(lifecycleSource, { window: lifecycleWindow });
const lifecycle = lifecycleWindow.VoiceMediaLifecycle;
const plain = (value) => JSON.parse(JSON.stringify(value));

test('screen sharing snapshot keeps microphone screen-audio and one active video', () => {
    const mic = new FakeTrack('audio', 'mic');
    const screenAudio = new FakeTrack('audio', 'screen-audio');
    const screenVideo = new FakeTrack('video', 'screen-video');
    const oldSnapshot = lifecycle.createMediaSnapshot({
        MediaStreamCtor: FakeStream,
        microphoneStream: new FakeStream([mic]),
    });
    const latestSnapshot = lifecycle.createMediaSnapshot({
        MediaStreamCtor: FakeStream,
        microphoneStream: new FakeStream([mic]),
        screenStream: new FakeStream([screenAudio, screenVideo]),
        videoTrack: screenVideo,
    });
    assert.deepEqual(latestSnapshot.getAudioTracks(), [mic, screenAudio]);
    assert.deepEqual(latestSnapshot.getVideoTracks(), [screenVideo]);
    assert.notEqual(latestSnapshot, oldSnapshot);
});

test('screen picker cancellation is caught and resets pending without media refresh', async () => {
    await Promise.all(
        ['NotAllowedError', 'AbortError'].map(async (name) => {
            const pendingStates = [];
            let refreshCount = 0;
            const error = Object.assign(new Error('cancelled'), { name });
            const result = await lifecycle.requestScreenCapture({
                getDisplayMedia: async () => {
                    throw error;
                },
                onPendingChange: (pending) => pendingStates.push(pending),
            });

            if (result.ok) {
                refreshCount += 1;
            }

            assert.equal(result.cancelled, true);
            assert.equal(result.reason, 'screen-capture-cancelled');
            assert.deepEqual(pendingStates, [true, false]);
            assert.equal(refreshCount, 0);
        })
    );
});

test('successful picker completion releases pending before follow-up media work', async () => {
    const pendingStates = [];
    const stream = new FakeStream([new FakeTrack('video', 'screen')]);
    const result = await lifecycle.requestScreenCapture({
        getDisplayMedia: async () => stream,
        onPendingChange: (pending) => pendingStates.push(pending),
    });

    assert.equal(result.ok, true);
    assert.equal(result.stream, stream);
    assert.deepEqual(pendingStates, [true, false]);
});

test('screen capture constraints map stable defaults and every resolution preset without exact', () => {
    const defaults = plain(lifecycle.buildScreenCaptureConstraints());
    assert.deepEqual(defaults, {
        audio: true,
        video: {
            frameRate: { ideal: 30, max: 30 },
            height: { ideal: 1080, max: 1080 },
            width: { ideal: 1920, max: 1920 },
        },
    });

    const expectedResolutions = {
        '720p': { height: 720, width: 1280 },
        '1080p': { height: 1080, width: 1920 },
        '1440p': { height: 1440, width: 2560 },
    };
    Object.entries(expectedResolutions).forEach(
        ([resolutionPreset, resolution]) => {
            const constraints = plain(
                lifecycle.buildScreenCaptureConstraints({
                    frameRate: 30,
                    resolutionPreset,
                })
            );
            assert.deepEqual(constraints.video.height, {
                ideal: resolution.height,
                max: resolution.height,
            });
            assert.deepEqual(constraints.video.width, {
                ideal: resolution.width,
                max: resolution.width,
            });
        }
    );

    const automatic = plain(
        lifecycle.buildScreenCaptureConstraints({ resolutionPreset: 'auto' })
    );
    const original = plain(
        lifecycle.buildScreenCaptureConstraints({
            resolutionPreset: 'original',
        })
    );
    assert.deepEqual(automatic.video.height, { ideal: 1080 });
    assert.deepEqual(automatic.video.width, { ideal: 1920 });
    assert.equal(Object.hasOwn(original.video, 'height'), false);
    assert.equal(Object.hasOwn(original.video, 'width'), false);
    assert.equal(
        JSON.stringify({ defaults, automatic, original }).includes('exact'),
        false
    );
});

test('screen capture constraints accept 15 30 and 60 fps targets and normalize invalid input', () => {
    [15, 30, 60].forEach((frameRate) => {
        const constraints = plain(
            lifecycle.buildScreenCaptureConstraints({ frameRate })
        );
        assert.deepEqual(constraints.video.frameRate, {
            ideal: frameRate,
            max: frameRate,
        });
    });

    assert.deepEqual(
        plain(
            lifecycle.normalizeScreenShareOptions({
                frameRate: 120,
                resolutionPreset: '8k',
            })
        ),
        { frameRate: 30, resolutionPreset: '1080p' }
    );
});

test('screen capture runtime owns option-to-constraint mapping before calling the picker', async () => {
    let receivedConstraints;
    const stream = new FakeStream([new FakeTrack('video', 'screen')]);
    const result = await lifecycle.requestScreenCapture({
        getDisplayMedia: async (constraints) => {
            receivedConstraints = plain(constraints);
            return stream;
        },
        options: { frameRate: 60, resolutionPreset: '1440p' },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(receivedConstraints.video, {
        frameRate: { ideal: 60, max: 60 },
        height: { ideal: 1440, max: 1440 },
        width: { ideal: 2560, max: 2560 },
    });
});

test('remote media attachment updates srcObject and starts playback', async () => {
    const stream = new FakeStream([new FakeTrack('video', 'screen')]);
    const mediaElement = {
        playCount: 0,
        readyState: 1,
        play() {
            this.playCount += 1;
            return Promise.resolve();
        },
        srcObject: null,
    };

    assert.equal(lifecycle.attachAndPlayMedia({ mediaElement, stream }), true);
    await Promise.resolve();

    assert.equal(mediaElement.srcObject, stream);
    assert.equal(mediaElement.playCount, 1);
    assert.equal(typeof mediaElement.onloadedmetadata, 'function');
});

test('remote media presentation ignores ended video tracks', () => {
    const endedScreen = new FakeTrack('video', 'ended-screen');
    const microphone = new FakeTrack('audio', 'microphone');
    endedScreen.readyState = 'ended';
    const stream = new FakeStream([microphone, endedScreen]);

    assert.deepEqual(lifecycle.getLiveTracks(stream, 'video'), []);
    assert.deepEqual(lifecycle.getLiveTracks(stream, 'audio'), [microphone]);
});

test('same-stream video replacement clears the decoder before rebinding', () => {
    const previousStream = new FakeStream([new FakeTrack('video', 'screen')]);
    const nextStream = new FakeStream([new FakeTrack('video', 'camera')]);
    const assignments = [];
    const mediaElement = {
        loadCount: 0,
        onloadedmetadata: () => {},
        pauseCount: 0,
        playCount: 0,
        readyState: 1,
        get srcObject() {
            return assignments.at(-1);
        },
        set srcObject(value) {
            assignments.push(value);
        },
        load() {
            this.loadCount += 1;
        },
        pause() {
            this.pauseCount += 1;
        },
        play() {
            this.playCount += 1;
            return Promise.resolve();
        },
    };
    mediaElement.srcObject = previousStream;

    lifecycle.attachAndPlayMedia({
        forceRebind: true,
        mediaElement,
        stream: nextStream,
    });

    assert.deepEqual(assignments, [previousStream, null, nextStream]);
    assert.equal(mediaElement.pauseCount, 1);
    assert.equal(mediaElement.loadCount, 1);
    assert.equal(mediaElement.playCount, 1);
});

test('page teardown stops local tracks once and closes registry Peer and Socket', () => {
    const events = [];
    const screenVideo = new FakeTrack('video', 'screen-video', events);
    const screenAudio = new FakeTrack('audio', 'screen-audio', events);
    const cameraVideo = new FakeTrack('video', 'camera-video', events);
    const microphone = new FakeTrack('audio', 'microphone', events);
    const screenStream = new FakeStream([screenVideo, screenAudio]);
    const cameraStream = new FakeStream([cameraVideo]);
    const microphoneStream = new FakeStream([microphone]);
    const stopper = lifecycle.createTrackStopper();
    let currentSession = { id: 'old-session' };
    let currentStream = screenStream;
    let sharing = true;
    let staleEndedMutationCount = 0;
    const oldSession = currentSession;

    screenVideo.addEventListener('ended', () => {
        if (
            lifecycle.isCurrentScreenCapture({
                currentSession,
                currentStream,
                session: oldSession,
                sharing,
                stream: screenStream,
            })
        ) {
            staleEndedMutationCount += 1;
        }
    });

    const peer = {
        destroy() {
            events.push('peer:destroy');
            this.destroyed = true;
        },
        destroyed: false,
    };
    const socket = {
        disconnect() {
            events.push('socket:disconnect');
        },
    };
    const teardown = lifecycle.createPageTeardown({
        beforeStopMedia: () => {
            sharing = false;
            currentSession = undefined;
            events.push('local:invalidate');
        },
        clearLocalState: () => {
            currentStream = undefined;
            events.push('local:clear');
        },
        getMediaStreams: () => [
            screenStream,
            cameraStream,
            microphoneStream,
            screenStream,
        ],
        getPeer: () => peer,
        getSocket: () => socket,
        notifyLeave: () => events.push('voice:leave'),
        stopStream: stopper.stopStream,
        teardownRegistry: () => events.push('registry:teardown'),
    });

    assert.equal(teardown.run('page-unload'), true);
    assert.equal(teardown.run('page-unload'), false);
    screenVideo.emit('ended');

    [screenVideo, screenAudio, cameraVideo, microphone].forEach((track) =>
        assert.equal(track.stopCount, 1)
    );
    assert.equal(staleEndedMutationCount, 0);
    assert.deepEqual(events, [
        'local:invalidate',
        'stop:screen-video',
        'stop:screen-audio',
        'stop:camera-video',
        'stop:microphone',
        'voice:leave',
        'registry:teardown',
        'peer:destroy',
        'socket:disconnect',
        'local:clear',
    ]);
});

test('BFCache pagehide is preserved while real unload requests teardown', () => {
    assert.equal(lifecycle.shouldTeardownPage({ persisted: true }), false);
    assert.equal(lifecycle.shouldTeardownPage({ persisted: false }), true);
    assert.equal(lifecycle.shouldTeardownPage(), true);
});
