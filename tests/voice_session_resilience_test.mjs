import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import { createVoiceCallSignaling } from '../src/utils/VoiceCallSignaling.js';

const loadBrowserApi = (path, name, extraWindow = {}) => {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    const browserWindow = { ...extraWindow };
    vm.runInNewContext(source, {
        Math,
        Object,
        Promise,
        Set,
        window: browserWindow,
    });
    return browserWindow[name];
};

const sessionApi = loadBrowserApi(
    '../src/views/js/voice/voice-session-runtime.js',
    'VoiceSessionRuntime'
);
const mediaApi = loadBrowserApi(
    '../src/views/js/voice/voice-media-operation-runtime.js',
    'VoiceMediaOperationRuntime',
    { isSecureContext: true }
);
const deviceApi = loadBrowserApi(
    '../src/views/js/voice/voice-device-runtime.js',
    'VoiceDeviceRuntime'
);

test('voice session keeps desired join separate from socket and peer restoration state', () => {
    const changes = [];
    const runtime = sessionApi.createSessionRuntime({
        onStateChange: (snapshot) => changes.push(snapshot.state),
    });
    const joinEpoch = runtime.join('lobby');
    assert.equal(runtime.getSnapshot().desiredVoiceState, 'joined');
    assert.equal(runtime.getSnapshot().state, 'joining');
    assert.equal(
        runtime.markJoined({
            epoch: joinEpoch,
            peerId: 'peer-a',
            serverGeneration: 1,
        }),
        true
    );

    runtime.socketDisconnected('transport-close');
    const reconnectEpoch = runtime.getSnapshot().epoch;
    assert.equal(runtime.getSnapshot().state, 'reconnecting-socket');
    assert.equal(runtime.getSnapshot().desiredVoiceState, 'joined');
    assert.equal(runtime.socketDisconnected('duplicate'), true);
    assert.equal(runtime.getSnapshot().epoch, reconnectEpoch);

    runtime.socketConnected('reconnect');
    assert.equal(runtime.getSnapshot().state, 'restoring');
    assert.equal(
        runtime.markJoined({
            epoch: reconnectEpoch,
            peerId: 'peer-a',
            serverGeneration: 1,
        }),
        true
    );
    assert.equal(runtime.getSnapshot().state, 'joined');
    assert.deepEqual(changes, [
        'joining',
        'joined',
        'reconnecting-socket',
        'restoring',
        'joined',
    ]);
});

test('leave during join and disposed sessions reject every late callback', () => {
    const runtime = sessionApi.createSessionRuntime();
    const oldEpoch = runtime.join('lobby');
    runtime.leave({ reason: 'user-leave' });
    assert.equal(runtime.getSnapshot().desiredVoiceState, 'left');
    assert.equal(runtime.getSnapshot().state, 'idle');
    assert.equal(
        runtime.markJoined({
            epoch: oldEpoch,
            peerId: 'late-peer',
            serverGeneration: 1,
        }),
        false
    );

    runtime.join('game');
    const disposedEpoch = runtime.getSnapshot().epoch;
    runtime.leave({ dispose: true, reason: 'page-teardown' });
    assert.equal(runtime.getSnapshot().state, 'disposed');
    assert.equal(runtime.socketConnected(), false);
    assert.equal(runtime.peerRecreated('late-peer'), false);
    assert.equal(runtime.isCurrent(disposedEpoch), false);
});

test('failed voice recovery can only restart through an explicit manual retry', () => {
    const runtime = sessionApi.createSessionRuntime();
    runtime.join('lobby');
    runtime.fail('max-attempts');
    assert.equal(runtime.getSnapshot().state, 'failed');
    assert.equal(runtime.retry(), true);
    assert.equal(runtime.getSnapshot().state, 'joining');
    assert.equal(runtime.retry(), false);
    assert.equal(runtime.transition('idle', 'illegal'), false);
    assert.equal(runtime.getSnapshot().state, 'joining');
});

test('PeerJS errors are classified by call scope, recoverability and strategy', () => {
    const cases = [
        ['peer-unavailable', 'call', 'none', true],
        ['webrtc', 'call', 'none', true],
        ['network', 'session', 'reconnect', true],
        ['server-error', 'session', 'reconnect', true],
        ['unavailable-id', 'session', 'recreate', true],
        ['browser-incompatible', 'session', 'none', false],
        ['invalid-id', 'session', 'none', false],
        ['mystery', 'session', 'recreate', true],
    ];
    cases.forEach(([type, scope, strategy, recoverable]) => {
        assert.deepEqual(
            { ...sessionApi.classifyPeerError({ type }) },
            { recoverable, scope, strategy, type }
        );
    });
});

class FakeTimers {
    constructor() {
        this.nextId = 1;
        this.tasks = new Map();
    }

    clear = (id) => this.tasks.delete(id);

    set = (callback, delay) => {
        const id = this.nextId++;
        this.tasks.set(id, { callback, delay });
        return id;
    };

    async runNext() {
        const [id, task] = this.tasks.entries().next().value || [];
        if (!task) {
            return false;
        }
        this.tasks.delete(id);
        await task.callback();
        await Promise.resolve();
        return true;
    }

    async runAll() {
        if (await this.runNext()) {
            return this.runAll();
        }
        return undefined;
    }
}

test('retry controller applies exponential backoff, max delay and maximum attempts', async () => {
    const timers = new FakeTimers();
    const debug = [];
    const retryApi = loadBrowserApi(
        '../src/views/js/voice/voice-retry-controller.js',
        'VoiceRetryController',
        { clearTimeout: timers.clear, setTimeout: timers.set }
    );
    const controller = retryApi.createRetryController({
        baseDelay: 100,
        clearTimer: timers.clear,
        jitter: 0,
        maxAttempts: 4,
        maxDelay: 250,
        onDebug: (entry) => debug.push(entry),
        setTimer: timers.set,
    });
    assert.deepEqual(
        [1, 2, 3, 4].map((attempt) => controller.getDelay(attempt)),
        [100, 200, 250, 250]
    );

    const resultPromise = controller.run({ epoch: 7, task: async () => false });
    await timers.runAll();
    const result = await resultPromise;
    assert.equal(result.ok, false);
    assert.equal(result.attempts, 4);
    assert.equal(controller.getSnapshot().active, false);
    assert.equal(
        debug.filter((entry) => entry.event === 'retry-started').length,
        4
    );
});

test('retry pauses offline, online wakes once, success resets and leave cancels timers', async () => {
    const timers = new FakeTimers();
    const retryApi = loadBrowserApi(
        '../src/views/js/voice/voice-retry-controller.js',
        'VoiceRetryController',
        { clearTimeout: timers.clear, setTimeout: timers.set }
    );
    const controller = retryApi.createRetryController({
        clearTimer: timers.clear,
        jitter: 0,
        setTimer: timers.set,
    });
    let calls = 0;
    const pending = controller.run({
        epoch: 2,
        task: async () => {
            calls += 1;
            return true;
        },
    });
    controller.setOnline(false);
    assert.equal(timers.tasks.size, 0);
    controller.setOnline(true);
    controller.setOnline(true);
    assert.equal(timers.tasks.size, 1);
    await timers.runNext();
    assert.equal((await pending).ok, true);
    assert.equal(calls, 1);
    assert.equal(controller.getSnapshot().attempt, 0);

    const cancelled = controller.run({ epoch: 3, task: async () => true });
    assert.equal(controller.cancel('user-leave'), true);
    assert.equal((await cancelled).cancelled, true);
    assert.equal(timers.tasks.size, 0);
});

class FakeTrack {
    constructor(kind) {
        this.kind = kind;
        this.listeners = new Map();
        this.readyState = 'live';
        this.stopCount = 0;
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
                (candidate) => candidate !== listener
            )
        );
    }

    emit(event) {
        (this.listeners.get(event) || [])
            .slice()
            .forEach((listener) => listener());
    }

    stop() {
        this.readyState = 'ended';
        this.stopCount += 1;
        this.emit('ended');
    }
}

class FakeStream {
    constructor(tracks = [new FakeTrack('audio')]) {
        this.tracks = tracks;
    }

    getTracks() {
        return this.tracks;
    }
}

test('media operations serialize double clicks and reject stale resolve after stop or epoch change', async () => {
    let epoch = 1;
    let resolveRequest;
    let requests = 0;
    const controller = mediaApi.createMediaOperationController({
        getEpoch: () => epoch,
        stopStream: (stream) =>
            stream?.getTracks().forEach((track) => track.stop()),
    });
    const request = () => {
        requests += 1;
        return new Promise((resolve) => {
            resolveRequest = resolve;
        });
    };
    const first = controller.run('microphone', request, { epoch });
    const duplicate = controller.run('microphone', request, { epoch });
    assert.equal(first, duplicate);
    assert.equal(requests, 0);
    await Promise.resolve();
    assert.equal(requests, 1);

    controller.invalidate('microphone');
    const lateStream = new FakeStream();
    resolveRequest(lateStream);
    const result = await first;
    assert.equal(result.cancelled, true);
    assert.equal(lateStream.tracks[0].stopCount, 1);

    let resolveCamera;
    const camera = controller.run(
        'camera',
        () =>
            new Promise((resolve) => {
                resolveCamera = resolve;
            }),
        { epoch }
    );
    await Promise.resolve();
    epoch += 1;
    const staleCamera = new FakeStream([new FakeTrack('video')]);
    resolveCamera(staleCamera);
    assert.equal((await camera).reason, 'stale-operation');
    assert.equal(staleCamera.tracks[0].stopCount, 1);
});

test('media operations isolate types, dispose pending work and map browser errors', async () => {
    let resolveScreen;
    const controller = mediaApi.createMediaOperationController({
        getEpoch: () => 1,
        stopStream: (stream) =>
            stream?.getTracks().forEach((track) => track.stop()),
    });
    const screen = controller.run(
        'screen',
        () =>
            new Promise((resolve) => {
                resolveScreen = resolve;
            }),
        { epoch: 1 }
    );
    const mic = await controller.run(
        'microphone',
        async () => new FakeStream(),
        { epoch: 1 }
    );
    assert.equal(mic.ok, true);
    controller.dispose();
    const lateScreen = new FakeStream([new FakeTrack('video')]);
    resolveScreen(lateScreen);
    assert.equal((await screen).cancelled, true);
    assert.equal(lateScreen.tracks[0].stopCount, 1);

    const mappings = [
        ['NotAllowedError', 'microphone', 'permission-denied'],
        ['NotAllowedError', 'screen', 'user-cancelled'],
        ['AbortError', 'screen', 'user-cancelled'],
        ['NotFoundError', 'camera', 'device-not-found'],
        ['DevicesNotFoundError', 'microphone', 'device-not-found'],
        ['NotReadableError', 'camera', 'device-busy'],
        ['TrackStartError', 'microphone', 'device-busy'],
        ['OverconstrainedError', 'camera', 'constraint-failed'],
        ['ConstraintNotSatisfiedError', 'camera', 'constraint-failed'],
        ['SecurityError', 'camera', 'insecure-context'],
        ['TypeError', 'camera', 'insecure-context'],
        ['MysteryError', 'camera', 'unknown'],
    ];
    mappings.forEach(([name, operation, expected]) => {
        assert.equal(
            mediaApi.classifyMediaError({ name }, { operation }),
            expected
        );
    });
});

test('track-ended ownership distinguishes intentional stop, stale epoch and one recovery claim', () => {
    let epoch = 1;
    const ended = [];
    const controller = mediaApi.createTrackEndedController({
        getEpoch: () => epoch,
        isCurrent: (candidate) => candidate === epoch,
        onEnded: (event) => ended.push(event),
        stopTrack: (track) => track.stop(),
    });
    const intentional = new FakeTrack('audio');
    controller.bind('microphone', intentional);
    controller.stop('microphone', intentional);
    assert.equal(intentional.stopCount, 1);
    assert.equal(ended.length, 0);

    const stale = new FakeTrack('video');
    controller.bind('camera', stale);
    epoch = 2;
    stale.emit('ended');
    assert.equal(ended.length, 0);

    const current = new FakeTrack('video');
    controller.bind('camera', current);
    current.emit('ended');
    current.emit('ended');
    assert.equal(ended.length, 1);
    assert.equal(controller.claimRecovery('camera', epoch), true);
    assert.equal(controller.claimRecovery('camera', epoch), false);
    assert.equal(controller.releaseRecovery('camera', epoch), true);
    assert.equal(controller.claimRecovery('camera', epoch), true);
    controller.clear();
    const snapshot = controller.getSnapshot();
    assert.deepEqual(
        {
            boundTypes: [...snapshot.boundTypes],
            recoveryClaims: [...snapshot.recoveryClaims],
        },
        {
            boundTypes: [],
            recoveryClaims: [],
        }
    );
});

test('output sink switching supports fallback, AbortError and unsupported browsers', async () => {
    const calls = [];
    const mediaElement = {
        dataset: {},
        async setSinkId(deviceId) {
            calls.push(deviceId);
            if (deviceId === 'missing-speaker') {
                throw Object.assign(new Error('gone'), { name: 'AbortError' });
            }
        },
    };
    const failed = await deviceApi.switchOutputDevice({
        deviceId: 'missing-speaker',
        mediaElement,
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.errorType, 'operation-aborted');
    assert.equal(failed.fallbackApplied, true);
    assert.deepEqual(calls, ['missing-speaker', 'default']);
    assert.equal(mediaElement.dataset.outputSinkId, 'default');

    calls.length = 0;
    const succeeded = await deviceApi.switchOutputDevice({
        deviceId: 'speaker-b',
        mediaElement,
    });
    assert.equal(succeeded.ok, true);
    assert.deepEqual(calls, ['speaker-b']);
    assert.equal(mediaElement.dataset.outputSinkId, 'speaker-b');

    const unsupported = await deviceApi.switchOutputDevice({
        deviceId: 'speaker-c',
        mediaElement,
        supported: false,
    });
    assert.equal(unsupported.unsupported, true);
    assert.deepEqual(calls, ['speaker-b']);
});

test('devicechange is debounced, preserves present selections and falls back missing devices', async () => {
    const timers = new FakeTimers();
    let list = [
        { deviceId: 'mic-a', kind: 'audioinput', label: '' },
        { deviceId: 'camera-a', kind: 'videoinput', label: '' },
        { deviceId: 'speaker-a', kind: 'audiooutput', label: '' },
    ];
    const missing = [];
    const timedDeviceApi = loadBrowserApi(
        '../src/views/js/voice/voice-device-runtime.js',
        'VoiceDeviceRuntime',
        { clearTimeout: timers.clear, setTimeout: timers.set }
    );
    const runtime = timedDeviceApi.createDeviceRuntime({
        clearTimer: timers.clear,
        enumerateDevices: async () => list,
        onMissing: (entry) => missing.push(entry.type),
        setTimer: timers.set,
    });
    runtime.setSelected('mic', 'mic-a');
    runtime.setSelected('camera', 'camera-a');
    runtime.setSelected('output', 'speaker-a');
    assert.equal((await runtime.refresh()).ok, true);
    assert.deepEqual(
        { ...runtime.getSnapshot().selected },
        {
            camera: 'camera-a',
            mic: 'mic-a',
            output: 'speaker-a',
        }
    );

    list = [{ deviceId: 'default', kind: 'audioinput', label: '' }];
    runtime.handleDeviceChange();
    runtime.handleDeviceChange();
    runtime.handleDeviceChange();
    assert.equal(timers.tasks.size, 1);
    await timers.runNext();
    assert.deepEqual(missing.sort(), ['camera', 'mic', 'output']);
    assert.deepEqual(
        { ...runtime.getSnapshot().selected },
        {
            camera: 'default',
            mic: 'default',
            output: 'default',
        }
    );
    runtime.dispose();
    assert.equal(timers.tasks.size, 0);
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

test('same socket can replace its PeerJS owner and receives an epoch-tagged canonical snapshot', async () => {
    const io = new FakeIo();
    const signaling = createVoiceCallSignaling({
        io,
        resolveRoomId: (roomId) => (roomId === 'lobby' ? roomId : undefined),
    });
    const remote = new FakeSocket(io, 'remote-socket');
    const reconnecting = new FakeSocket(io, 'local-socket');
    await signaling.join({ peerId: 'remote-peer', roomId: 'lobby' }, remote);
    const first = await signaling.join(
        { clientSessionEpoch: 4, peerId: 'old-peer', roomId: 'lobby' },
        reconnecting
    );
    const replacement = await signaling.join(
        { clientSessionEpoch: 5, peerId: 'new-peer', roomId: 'lobby' },
        reconnecting
    );
    const snapshot = await signaling.getSnapshot(reconnecting);

    assert.equal(first.voiceSessionGeneration, 1);
    assert.equal(replacement.voiceSessionGeneration, 2);
    assert.deepEqual(replacement.peerIds, ['remote-peer']);
    assert.deepEqual(snapshot, {
        clientSessionEpoch: 5,
        ok: true,
        peerId: 'new-peer',
        peerIds: ['remote-peer'],
        roomId: 'lobby',
        voiceSessionGeneration: 2,
    });
    assert.deepEqual(
        remote.emitted
            .filter((event) => event.event === 'removeUserVideo')
            .at(-1).payload,
        { peerId: 'old-peer', roomId: 'lobby' }
    );
    assert.equal(reconnecting.emitted.at(-1).payload.clientSessionEpoch, 5);
});

test('duplicate voice rejoin is idempotent but still returns the current target snapshot', async () => {
    const io = new FakeIo();
    const signaling = createVoiceCallSignaling({
        io,
        resolveRoomId: (roomId) => roomId,
    });
    const a = new FakeSocket(io, 'a');
    const b = new FakeSocket(io, 'b');
    await signaling.join({ peerId: 'A', roomId: 'lobby' }, a);
    await signaling.join({ peerId: 'B', roomId: 'lobby' }, b);
    const duplicate = await signaling.join(
        { clientSessionEpoch: 9, peerId: 'B', roomId: 'lobby' },
        b
    );
    assert.equal(duplicate.duplicate, true);
    assert.deepEqual(duplicate.peerIds, ['A']);
    assert.equal((await signaling.getSnapshot(b)).clientSessionEpoch, 9);
    assert.equal(
        a.emitted.filter((event) => event.event === 'voice:peer-joined').length,
        1
    );
});
