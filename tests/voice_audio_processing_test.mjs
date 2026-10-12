import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { StrictStream, StrictTrack } from './helpers/strict_media_peer.mjs';

const fixture = (options = {}) => {
    const contexts = [],
        captures = [],
        constraints = [],
        processors = [];
    const events = [];
    let failCapture,
        failProcessor = false,
        captureGate,
        gain = 100,
        speechGate = true,
        loads = 0;
    const node = () => ({
        links: [],
        connect(target) {
            this.links.push(target);
        },
        disconnect() {
            this.links = [];
        },
    });
    const stopStream = (stream) =>
        stream?.getTracks().forEach((track) => {
            track.readyState = 'ended';
        });
    const window = { setTimeout, clearTimeout };
    for (const name of [
        'voice-audio-processing',
        'voice-audio-settings-controller',
    ]) {
        vm.runInNewContext(
            readFileSync(
                new URL(`../src/views/js/voice/${name}.js`, import.meta.url),
                'utf8'
            ),
            { window }
        );
    }
    const runtime = window.VoiceAudioProcessing.createRuntime({
        stopStream,
        getGain: () => gain,
        getSpeechGateEnabled: () => speechGate,
        supportsRnnoise: () => true,
        mediaDevices: {
            getSupportedConstraints: () => ({
                echoCancellation: options.supported !== false,
            }),
            async getUserMedia({ audio }) {
                constraints.push(structuredClone(audio));
                if (failCapture)
                    throw Object.assign(new Error('capture failed'), {
                        name: failCapture,
                    });
                const track = new StrictTrack(
                    'audio',
                    `raw-${captures.length}`
                );
                const settings = {
                    ...audio,
                    deviceId: audio.deviceId?.exact || 'resolved-default',
                    sampleRate: 48000,
                };
                const applied = [];
                track.getSettings = () => ({ ...settings });
                if (!options.noCapabilities)
                    track.getCapabilities = () => ({
                        echoCancellation: options.noAll
                            ? [true, false]
                            : [true, false, 'all'],
                    });
                track.applyConstraints = async (value) => {
                    applied.push(structuredClone(value));
                    if (
                        value.echoCancellation?.exact === 'all' &&
                        options.rejectAll
                    )
                        throw Object.assign(new Error('no all'), {
                            name: 'OverconstrainedError',
                        });
                    for (const [key, setting] of Object.entries(value)) {
                        if (key === 'noiseSuppression' && options.stuckNoise) {
                            settings[key] = true;
                            continue;
                        }
                        settings[key] = setting?.exact ?? setting;
                    }
                    if (
                        options.ignoreAll &&
                        settings.echoCancellation === 'all'
                    )
                        settings.echoCancellation = true;
                };
                if (options.stuckNoise) settings.noiseSuppression = true;
                const stream = new StrictStream([track]);
                captures.push({ stream, track, applied, settings });
                const gate = captureGate;
                captureGate = undefined;
                await gate;
                return stream;
            },
        },
        createContext: () => {
            const context = {
                state: 'running',
                sampleRate: 48000,
                modules: 0,
                async resume() {
                    this.state = 'running';
                },
                async close() {
                    this.state = 'closed';
                },
                createMediaStreamSource: node,
                createMediaStreamDestination: () => ({
                    ...node(),
                    stream: new StrictStream([
                        new StrictTrack('audio', `output-${events.length++}`),
                    ]),
                }),
                audioWorklet: {
                    addModule: async () => {
                        context.modules++;
                    },
                },
            };
            contexts.push(context);
            return context;
        },
        createGain: (_, value) => ({ ...node(), gain: { value } }),
        loadLibrary: async () => {
            loads++;
            return {
                loadRnnoise: async () => new ArrayBuffer(8),
                RnnoiseWorkletNode: class {
                    constructor(_, config) {
                        Object.assign(this, node());
                        this.config = config;
                        this.port = {
                            start() {},
                            postMessage: (message) => queueMicrotask(() => this.port.onmessage?.({
                                data: { type: 'speech-gate-state', enabled: message.enabled, revision: message.revision },
                            })),
                        };
                        processors.push(this);
                        queueMicrotask(() =>
                            this.port.onmessage?.({
                                data: {
                                    type: failProcessor ? 'error' : 'ready',
                                    speechGate: options.noSpeechGate !== true,
                                    speechGateEnabled: true,
                                },
                            })
                        );
                    }
                    destroy() {
                        this.destroyed = true;
                    }
                },
            };
        },
        onSourceEnded: (stream) => events.push({ ended: stream }),
    });
    return {
        runtime,
        window,
        contexts,
        captures,
        constraints,
        processors,
        events,
        get loads() {
            return loads;
        },
        setGain: (value) => {
            gain = value;
            runtime.setGain(value);
        },
        setSpeechGate: (value) => {
            speechGate = value;
            return runtime.setSpeechGate(value);
        },
        failCapture: (name) => {
            failCapture = name;
        },
        failProcessor: (value) => {
            failProcessor = value;
        },
        blockCapture: () => {
            let resolve;
            captureGate = new Promise((done) => {
                resolve = done;
            });
            return resolve;
        },
        async start(mode = 'browser', deviceId = 'default') {
            return runtime.adopt(await runtime.stage({ mode, deviceId }));
        },
    };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('AEC all is requested exactly after capability detection and read back from the physical capture', async () => {
    const f = fixture();
    const stream = await f.start();
    const state = f.runtime.diagnostics(stream);
    assert.equal(state.actual.echoCancellation, 'all');
    assert.equal(state.aecFallback, null);
    assert.equal(state.allSupported, true);
    assert.equal(state.actual.noiseSuppression, true);
    assert.equal(f.captures[0].applied[0].echoCancellation.exact, 'all');
    f.runtime.dispose(stream);
});

for (const options of [
    { noAll: true },
    { supported: false },
    { rejectAll: true },
    { ignoreAll: true },
    { noCapabilities: true, rejectAll: true },
]) {
    test(`AEC retains ordinary echo cancellation when all is unavailable: ${JSON.stringify(options)}`, async () => {
        const f = fixture(options);
        const stream = await f.start('off');
        const state = f.runtime.diagnostics(stream);
        assert.equal(state.actual.echoCancellation, true);
        assert.ok(state.aecFallback);
        assert.equal(state.actual.noiseSuppression, false);
        assert.equal(state.actual.autoGainControl, false);
        if (options.noAll || options.supported === false)
            assert.equal(f.captures[0].applied.length, 0);
        else assert.equal(f.captures[0].applied.at(-1).echoCancellation, true);
        f.runtime.dispose(stream);
    });
}

test('RNNoise uses a single mono processor without browser NS or fixed boost; mode and device switches keep the output track', async () => {
    const f = fixture();
    const stream = await f.start('browser', 'a');
    stream.getAudioTracks()[0].enabled = false;
    assert.equal(await f.start('rnnoise', 'b'), stream);
    assert.equal(stream.getAudioTracks()[0].enabled, false);
    assert.equal(f.contexts.length, 1);
    assert.equal(f.captures[0].track.readyState, 'ended');
    assert.equal(f.runtime.diagnostics(stream).actual.noiseSuppression, false);
    assert.equal(f.runtime.diagnostics(stream).actual.autoGainControl, false);
    assert.equal(f.runtime.pipelines.get(stream).gain.gain.value, 1);
    assert.equal(f.processors[0].config.maxChannels, 1);
    assert.equal(f.processors[0].channelCount, 1);
    assert.equal(f.processors[0].channelCountMode, 'explicit');
    assert.equal(await f.start('off', 'b'), stream);
    assert.equal(f.processors[0].destroyed, true);
    assert.equal(await f.start('rnnoise', 'b'), stream);
    assert.equal(f.loads, 1, 'binary is loaded lazily once');
    assert.equal(f.contexts[0].modules, 1);
    f.runtime.dispose(stream);
    assert.equal(f.contexts[0].state, 'closed');
});

test('RNNoise init failure keeps the old pipeline, restores old capture constraints and frees the failed branch', async () => {
    const f = fixture();
    const stream = await f.start();
    f.failProcessor(true);
    await assert.rejects(
        f.runtime.stage({ mode: 'rnnoise', deviceId: 'default' }),
        /rnnoise-init-failed/
    );
    assert.equal(f.runtime.pipelines.get(stream).mode, 'browser');
    assert.equal(f.captures[0].track.readyState, 'live');
    assert.equal(f.captures[0].applied.at(-1).noiseSuppression, true);
    assert.equal(f.captures[1].track.readyState, 'ended');
    assert.equal(f.processors[0].destroyed, true);
    assert.equal(f.contexts[0].state, 'running');
    f.runtime.dispose(stream);
});

test('a browser refusing to disable its NS never silently runs a second denoiser', async () => {
    const f = fixture({ stuckNoise: true });
    await assert.rejects(
        f.runtime.stage({ mode: 'rnnoise' }),
        /browser-noise-suppression-still-enabled/
    );
    assert.equal(f.processors.length, 0);
    assert.equal(f.captures[0].track.readyState, 'ended');
});

for (const name of ['NotAllowedError', 'NotFoundError', 'NotReadableError']) {
    test(`capture ${name} is not retried or hidden by a different device`, async () => {
        const f = fixture();
        f.failCapture(name);
        await assert.rejects(
            f.runtime.stage({ mode: 'browser', deviceId: 'a' }),
            { name }
        );
        assert.equal(f.constraints.length, 1);
        assert.equal(f.constraints[0].deviceId.exact, 'a');
    });
}

test('rapid requests skip obsolete captures and cannot dispose the active context', async () => {
    const f = fixture();
    const stream = await f.start();
    const unblock = f.blockCapture();
    const first = f.runtime.stage({ mode: 'off', deviceId: 'a' });
    const obsolete = f.runtime.stage({ mode: 'rnnoise', deviceId: 'b' });
    const last = f.runtime.stage({ mode: 'off', deviceId: 'c' });
    // Register rejection handlers before flushing deferred work.
    const results = Promise.allSettled([first, obsolete, last]);
    await flush();
    unblock();
    const [a, b, c] = await results;
    assert.equal(a.status, 'rejected');
    assert.equal(b.status, 'rejected');
    assert.equal(c.status, 'fulfilled');
    assert.equal(f.runtime.adopt(c.value), stream);
    assert.equal(f.captures.length, 2);
    assert.equal(f.constraints.at(-1).deviceId.exact, 'c');
    assert.equal(f.processors.length, 0);
    assert.equal(f.contexts[0].state, 'running');
    f.runtime.dispose(stream);
});

test('device removal is observed on the raw source even while the stable output is muted', async () => {
    const f = fixture();
    const stream = await f.start('off', 'a');
    stream.getAudioTracks()[0].enabled = false;
    f.captures[0].track.end();
    assert.equal(f.events.at(-1).ended, stream);
    assert.equal(f.runtime.diagnostics(stream).sourceLive, false);
    assert.equal(await f.start('off'), stream);
    assert.equal(stream.getAudioTracks()[0].enabled, false);
    assert.equal(f.runtime.diagnostics(stream).sourceLive, true);
    f.runtime.dispose(stream);
});

test('gain changes during capture are retained, including exact zero, and processor failures can bypass without a new output', async () => {
    const f = fixture();
    const stream = await f.start('rnnoise');
    const unblock = f.blockCapture();
    const pending = f.runtime.stage({ mode: 'rnnoise', deviceId: 'b' });
    await flush();
    f.setGain(0);
    unblock();
    assert.equal(f.runtime.adopt(await pending), stream);
    assert.equal(f.runtime.pipelines.get(stream).gain.gain.value, 0);
    assert.equal(f.runtime.bypassFailedProcessor(stream), true);
    assert.equal(f.runtime.diagnostics(stream).mode, 'off');
    assert.ok(f.runtime.diagnostics(stream).fallbackReason);
    f.runtime.dispose(stream);
});

test('settings rollback uses the last committed pair and a late failure cannot undo a newer mode/device', async () => {
    const f = fixture();
    let finish;
    const commits = [];
    const controller = f.window.VoiceAudioSettingsController.createController({
        initial: { mode: 'browser', deviceId: 'a' },
        apply: (config) =>
            config.mode === 'rnnoise'
                ? new Promise((resolve) => {
                      finish = resolve;
                  })
                : config.deviceId !== 'bad',
        onCommitted: (config) => commits.push({ ...config }),
    });
    const pending = controller.select({ mode: 'rnnoise' });
    await controller.select({ mode: 'off', deviceId: 'b' });
    finish(false);
    assert.equal(await pending, false);
    assert.equal(controller.snapshot().requested.deviceId, 'b');
    assert.equal(controller.snapshot().requested.mode, 'off');
    await controller.select({ deviceId: 'bad' });
    assert.equal(controller.snapshot().requested.deviceId, 'b');
    assert.equal(controller.snapshot().pending, false);
    assert.equal(controller.snapshot().error, 'switch-failed');
    assert.deepEqual(commits, [{ mode: 'off', deviceId: 'b' }]);
});

test('leaving voice during a switch cancels its settings commit and queued model work', async () => {
    const f = fixture();
    let finish;
    const commits = [];
    const controller = f.window.VoiceAudioSettingsController.createController({
        initial: { mode: 'browser', deviceId: 'default' },
        apply: () =>
            new Promise((resolve) => {
                finish = resolve;
            }),
        onCommitted: (config) => commits.push(config),
    });
    const switching = controller.select({ mode: 'rnnoise' });
    controller.cancel();
    finish(true);
    assert.equal(await switching, false);
    assert.equal(commits.length, 0);
    assert.equal(controller.snapshot().requested.mode, 'browser');
});

test('duplicate device and mode requests share one transaction', async () => {
    const f = fixture();
    let finish,
        calls = 0;
    const controller = f.window.VoiceAudioSettingsController.createController({
        initial: { mode: 'browser', deviceId: 'default' },
        apply: () => {
            calls++;
            return new Promise((resolve) => {
                finish = resolve;
            });
        },
    });
    const first = controller.select({ mode: 'rnnoise', deviceId: 'a' });
    assert.equal(controller.select({ mode: 'rnnoise', deviceId: 'a' }), first);
    finish(true);
    assert.equal(await first, true);
    assert.equal(calls, 1);
});

test('a prepared processor error is rejected before adoption and cannot destroy the old branch', async () => {
    const f = fixture();
    const stream = await f.start();
    const candidate = await f.runtime.stage({ mode: 'rnnoise', deviceId: 'b' });
    f.processors[0].onprocessorerror();
    assert.throws(
        () => f.runtime.adopt(candidate),
        /audio-branch-no-longer-usable/
    );
    f.runtime.dispose(candidate);
    await f.runtime.restoreCurrent();
    assert.equal(f.runtime.pipelines.get(stream).mode, 'browser');
    assert.equal(f.contexts[0].state, 'running');
    assert.equal(f.captures[0].track.readyState, 'live');
    f.runtime.dispose(stream);
});

test('a cancelled late permission result cannot configure or dispose the newly joined audio', async () => {
    const f = fixture();
    const unblock = f.blockCapture();
    const old = f.runtime.stage({ mode: 'browser', deviceId: 'a' });
    const oldResult = Promise.allSettled([old]);
    await flush();
    f.runtime.cancelPending();
    const stream = await f.start('off', 'b');
    unblock();
    assert.equal((await oldResult)[0].status, 'rejected');
    assert.equal(
        f.captures[0].applied.length,
        0,
        'stale capture never changes AEC or NS'
    );
    assert.equal(f.captures[0].track.readyState, 'ended');
    assert.equal(f.captures[1].track.readyState, 'live');
    assert.equal(f.contexts[0].state, 'running');
    f.runtime.dispose(stream);
});

test('VAD keyboard suppression toggles on the existing processor and survives device changes/mute', async () => {
    const f = fixture();
    const stream = await f.start('rnnoise');
    stream.getAudioTracks()[0].enabled = false;
    await flush();
    assert.equal(f.runtime.diagnostics(stream).speechGateEnabled, true);
    assert.equal(f.setSpeechGate(false), true);
    assert.equal(f.setSpeechGate(true), true);
    assert.equal(f.setSpeechGate(false), true);
    await flush();
    assert.equal(f.runtime.diagnostics(stream).speechGateEnabled, false);
    assert.equal(f.processors.length, 1);
    assert.equal(await f.start('rnnoise', 'b'), stream);
    await flush();
    assert.equal(f.runtime.diagnostics(stream).speechGateEnabled, false);
    assert.equal(stream.getAudioTracks()[0].enabled, false);
    f.runtime.bypassFailedProcessor(stream);
    assert.equal(f.runtime.diagnostics(stream).speechGateEnabled, false);
    assert.equal(f.runtime.diagnostics(stream).mode, 'off');
    f.runtime.dispose(stream);
});

test('an old worklet cannot be reported as keyboard suppression active', async () => {
    const f = fixture({ noSpeechGate: true });
    const stream = await f.start('rnnoise');
    assert.equal(f.runtime.diagnostics(stream).speechGateSupported, false);
    assert.equal(f.setSpeechGate(true), false);
    f.runtime.dispose(stream);
});

test('the latest gate preference wins when a prepared device branch is adopted; a failed message keeps the active setting', async () => {
    const f = fixture();
    const stream = await f.start('rnnoise');
    const candidate = await f.runtime.stage({ mode: 'rnnoise', deviceId: 'b' });
    f.setSpeechGate(false);
    assert.equal(f.runtime.adopt(candidate), stream);
    await flush();
    assert.equal(f.runtime.diagnostics(stream).speechGateEnabled, false);
    const processor = f.runtime.pipelines.get(stream).processor;
    processor.port.postMessage = () => { throw new Error('port-closed'); };
    assert.equal(f.runtime.setSpeechGate(true), false);
    assert.equal(f.runtime.diagnostics(stream).speechGateEnabled, false);
    assert.equal(f.runtime.diagnostics(stream).speechGateRequested, false);
    f.runtime.dispose(stream);
});
