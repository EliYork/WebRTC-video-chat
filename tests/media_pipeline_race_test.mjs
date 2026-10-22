import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { StrictStream, StrictTrack } from './helpers/strict_media_peer.mjs';

// Execute the app's actual functions with deferred browser resources. No
// production debug hooks or duplicate implementation of the switch logic.
const appSource = readFileSync(process.env.AUDIT_SCRIPT_SOURCE || new URL('../src/views/script.js', import.meta.url), 'utf8');
const section = (start, end) => appSource.slice(appSource.indexOf(start), appSource.indexOf(end, appSource.indexOf(start)));
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
};
const fixture = () => {
    const contexts = [];
    const rawStreams = [];
    const sent = [];
    const sentPeers = [];
    let captureGate, processorGate;
    const stopStream = (stream) => stream?.getTracks().forEach((track) => { track.readyState = 'ended'; });
    const window = { setTimeout, clearTimeout };
    vm.runInNewContext(readFileSync(new URL('../src/views/js/voice/voice-media-operation-runtime.js', import.meta.url), 'utf8'), { window });
    vm.runInNewContext(readFileSync(new URL('../src/views/js/voice/voice-audio-processing.js', import.meta.url), 'utf8'), { window });
    const context = vm.createContext({
        console: { warn() {}, log() {} }, setTimeout, clearTimeout, WeakMap,
        AudioContext: class {
            constructor() {
                this.gate = processorGate;
                processorGate = undefined;
                this.state = this.gate ? 'suspended' : 'running';
                this.sampleRate = 48000;
                contexts.push(this);
            }
            async resume() { await this.gate?.promise; this.state = 'running'; }
            async close() { this.state = 'closed'; }
            createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
            createMediaStreamDestination() { return { stream: new StrictStream([new StrictTrack('audio', `processed-${contexts.length}`)]) }; }
        },
        GainNode: class { constructor() { this.gain = { value: 1 }; } connect() {} disconnect() {} },
        noiseSettingsUI: { getMicGain: () => 100 },
        getAiExperimentEnabled: () => false,
        isAiExperimentSupported: () => false,
        localMediaTrackStopper: { stopStream },
        voiceSessionRuntime: { getSnapshot: () => ({ epoch: 1 }) },
        currentPeer: { id: 'initial-peer' },
        captureAudio: async () => {
            const stream = new StrictStream([new StrictTrack('audio', `raw-${rawStreams.length}`)]);
            rawStreams.push(stream);
            stream.getAudioTracks()[0].getSettings = () => ({ noiseSuppression: false, echoCancellation: true });
            const gate = captureGate;
            captureGate = undefined;
            await gate?.promise;
            return stream;
        },
        notifyMediaDock() {}, setMediaOperationError() {}, setAudioButtonState() {}, setAudioButtonNoMic() {},
        emitLocalPresenceUpdate() {}, updateLocalUserCard() {}, setLocalVideoStream() {},
        bindLocalTrackEnded() {}, unbindLocalTrackEnded() {}, getActiveStream() {},
        voiceDeviceRuntime: { setSelected() {} },
        localTrackEndedController: { releaseRecovery() {} }, voiceMediaDebug: { record() {} },
        sendAudioTrackToPeers: (peer, track) => { sentPeers.push(peer); sent.push(track); },
    });
    context.audioProcessingRuntime = window.VoiceAudioProcessing.createRuntime({
        mediaDevices: { getUserMedia: () => context.captureAudio() },
        createContext: () => new context.AudioContext(),
        createGain: () => new context.GainNode(),
        stopStream,
    });
    context.requestRawAudioStream = (request) => context.audioProcessingRuntime.capture(request);
    context.audioSettingsController = { snapshot: () => ({ requested: { mode: 'off', deviceId: 'default' } }), adopt() {}, cancel() {} };
    context.mediaOperationController = window.VoiceMediaOperationRuntime.createMediaOperationController({
        getEpoch: () => 1,
        stopStream: (stream) => { vm.runInContext('typeof disposeAudioPipeline === "function" ? disposeAudioPipeline : () => {}', context)(stream); stopStream(stream); },
    });
    vm.runInContext(`
        let myVideoStream = null;
        let noiseAudioContext = null, noiseProcessorNode = null, noiseRawStream = null;
        let noiseProcessorActive = false, noiseMode = 'raw', noiseGainNode = null;
        let micPermissionDenied = false, selectedInputDeviceId = 'default';
        const audioPipelines = audioProcessingRuntime.pipelines;
        let activeAudioPipelineStream = null;
        ${section('const createAudioPipeline =', 'const updateFullscreenButtonStates =')}
        ${section('const restartLocalMicrophone =', 'const recoverProcessingFailure =')}
    `, context);
    const read = (code) => vm.runInContext(code, context);
    return {
        contexts, rawStreams, sent, sentPeers, controller: context.mediaOperationController,
        read, start: () => read('restartLocalMicrophone({}, { preserveOldTrack: true })'),
        blockNextPipeline() { captureGate = deferred(); return captureGate; },
        blockNextProcessor() { processorGate = deferred(); return processorGate; },
        hangup() {
            context.mediaOperationController.setDesired('microphone', false);
            context.mediaOperationController.invalidate('microphone');
            read('destroyProcessedAudioStream(); localMediaTrackStopper.stopStream(myVideoStream); myVideoStream = null;');
        },
    };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('microphone capture finishing after peer replacement publishes only to the current peer', async () => {
    const f=fixture();f.controller.setDesired('microphone',true);
    const gate=f.blockNextPipeline(),pending=f.start();await flush();
    f.read("currentPeer={id:'replacement-peer'}");gate.resolve();
    assert.equal(await pending,true);assert.equal(f.sentPeers.length,1);
    assert.equal(f.sentPeers[0],f.read('currentPeer'));f.hangup();
});

test('pending microphone pipeline keeps old audio alive and adopts the latest mute state', async () => {
    const f = fixture();
    f.controller.setDesired('microphone', true);
    assert.equal(await f.start(), true);
    const old = f.read('myVideoStream');
    const gate = f.blockNextPipeline();
    const pending = f.start();
    await flush();
    assert.equal(old.getAudioTracks()[0].readyState, 'live');
    assert.equal(f.contexts[0].state, 'running');
    f.controller.setDesired('microphone', false);
    gate.resolve();
    assert.equal(await pending, true);
    assert.equal(f.read('myVideoStream').getAudioTracks()[0].enabled, false);
    assert.equal(f.read('myVideoStream'), old, 'output track remains stable');
    assert.equal(f.contexts.length, 1);
    assert.equal(f.contexts[0].state, 'running');
    assert.equal(f.sent.length, 1, 'switch does not republish microphone or video');
    assert.equal(f.rawStreams[0].getAudioTracks()[0].readyState, 'ended');
    f.hangup();
});

test('hangup during processing initialization disposes the late pipeline and raw capture', async () => {
    const f = fixture();
    f.controller.setDesired('microphone', true);
    const gate = f.blockNextPipeline();
    const pending = f.start();
    await flush();
    f.hangup();
    gate.resolve();
    assert.equal(await pending, false);
    assert.equal(f.read('myVideoStream'), null);
    assert.equal(f.read('audioPipelines.get(activeAudioPipelineStream)?.context || null'), null);
    assert.equal(f.contexts.length, 0, 'cancelled capture never starts a processor');
    assert.equal(f.rawStreams[0].getAudioTracks()[0].readyState, 'ended');
    assert.equal(f.sent.length, 0);
});

test('late pipeline cannot replace or dispose the newer microphone pipeline', async () => {
    const f = fixture();
    f.controller.setDesired('microphone', true);
    const gate = f.blockNextPipeline();
    const old = f.start();
    await flush();
    f.controller.invalidate('microphone');
    const next = f.start();
    gate.resolve();
    assert.equal(await old, false);
    assert.equal(await next, true);
    const active = f.read('myVideoStream');
    assert.equal(f.read('myVideoStream'), active);
    assert.equal(f.read('audioPipelines.get(activeAudioPipelineStream)?.context'), f.contexts[0]);
    assert.equal(f.contexts.length, 1);
    assert.equal(f.contexts[0].state, 'running');
    assert.equal(f.rawStreams[0].getAudioTracks()[0].readyState, 'ended');
    assert.equal(f.rawStreams[1].getAudioTracks()[0].readyState, 'live');
    f.hangup();
});

test('duplicate microphone requests share one pipeline without stopping the adopted raw track', async () => {
    const f = fixture();
    f.controller.setDesired('microphone', true);
    const gate = f.blockNextPipeline();
    const a = f.start();
    const b = f.start();
    await flush();
    gate.resolve();
    assert.deepEqual(await Promise.all([a, b]), [true, true]);
    assert.equal(f.contexts.length, 1);
    assert.equal(f.rawStreams[0].getAudioTracks()[0].readyState, 'live');
    assert.equal(f.sent.length, 1);
    f.hangup();
});

test('a late processor failure after hangup cannot start another microphone capture', async () => {
    const f = fixture();
    f.controller.setDesired('microphone', true);
    const gate = f.blockNextProcessor();
    const pending = f.start();
    await flush();
    assert.equal(f.contexts.length, 1);
    f.hangup();
    gate.reject(new Error('late audio context failure'));
    assert.equal(await pending, false);
    assert.equal(f.rawStreams.length, 1, 'cancelled processor failure must not capture browser fallback');
    assert.equal(f.contexts.length, 1);
    assert.equal(f.contexts[0].state, 'closed');
    assert.equal(f.rawStreams[0].getAudioTracks()[0].readyState, 'ended');
    assert.equal(f.read('myVideoStream'), null);
    assert.equal(f.sent.length, 0);
});

test('hangup immediately stops a captured microphone while its audio context is still starting', async () => {
    const f = fixture();
    f.controller.setDesired('microphone', true);
    const gate = f.blockNextProcessor();
    const pending = f.start();
    await flush();
    assert.equal(f.rawStreams[0].getAudioTracks()[0].readyState, 'live');
    f.hangup();
    try {
        assert.equal(f.rawStreams[0].getAudioTracks()[0].readyState, 'ended');
        assert.equal(f.contexts[0].state, 'closed');
    } finally {
        gate.reject(new Error('context startup finished after hangup'));
        await pending;
    }
    assert.equal(f.rawStreams.length, 1);
    assert.equal(f.sent.length, 0);
});

test('an old processor failure cannot capture a fallback after a newer microphone has been adopted', async () => {
    const f = fixture();
    f.controller.setDesired('microphone', true);
    const gate = f.blockNextProcessor();
    const old = f.start();
    await flush();
    f.hangup();
    f.controller.setDesired('microphone', true);
    assert.equal(await f.start(), true);
    const active = f.read('myVideoStream');
    gate.reject(new Error('old context failed after new join'));
    assert.equal(await old, false);
    assert.equal(f.rawStreams.length, 2, 'old failure must not start a third capture');
    assert.equal(f.read('myVideoStream'), active);
    assert.equal(active.getAudioTracks()[0].readyState, 'live');
    assert.equal(f.contexts[1].state, 'running');
    assert.equal(f.sent.length, 1);
    f.hangup();
});

test('a current processor startup failure still permits the browser audio fallback', async () => {
    const f = fixture();
    f.controller.setDesired('microphone', true);
    const gate = f.blockNextProcessor();
    const pending = f.start();
    await flush();
    gate.reject(new Error('current audio context failed'));
    assert.equal(await pending, true);
    assert.equal(f.rawStreams.length, 2);
    assert.equal(f.rawStreams[0].getAudioTracks()[0].readyState, 'ended');
    assert.equal(f.rawStreams[1].getAudioTracks()[0].readyState, 'live');
    assert.equal(f.contexts[0].state, 'closed');
    assert.equal(f.contexts[1].state, 'running');
    assert.equal(f.sent.length, 1);
    f.hangup();
});

for (const type of ['microphone', 'camera']) {
    test(`late failed ${type} selection cannot overwrite a newer selected device`, async () => {
        const pending = deferred();
        let calls = 0;
        const selected = [];
        const controller = {
            getSnapshot: () => ({ desired: { microphone: true, camera: true } }),
        };
        const switchDevice = () => ++calls === 1 ? pending.promise : Promise.resolve(true);
        const window = {};
        vm.runInNewContext(readFileSync(new URL('../src/views/js/voice/voice-audio-settings-controller.js', import.meta.url), 'utf8'), { window });
        const context = vm.createContext({
            mediaOperationController: controller,
            currentPeer: { destroyed: false },
            voiceDeviceRuntime: { setSelected: (_, id) => selected.push(id) },
            notifyMediaDock() {}, restartLocalMicrophone: switchDevice, startCamera: switchDevice,
        });
        vm.runInContext(`
            let selectedInputDeviceId = 'default', selectedCameraDeviceId = 'default';
            let committedCameraDeviceId = selectedCameraDeviceId;
            let inputSelectionRevision = 0, cameraSelectionRevision = 0;
            const myVideoStream = { getAudioTracks: () => [{ readyState: 'live' }] };
            ${section('const selectInputDevice =', 'const selectOutputDevice =')}
        `, context);
        context.audioSettingsController = window.VoiceAudioSettingsController.createController({
            initial: { mode: 'off', deviceId: 'default' },
            apply: switchDevice,
            onRequested: ({ deviceId }) => {
                selected.push(deviceId);
                context.nextDeviceId = deviceId;
                vm.runInContext('selectedInputDeviceId = nextDeviceId', context);
            },
        });
        const choose = (id) => vm.runInContext(`${type === 'microphone' ? 'selectInputDevice' : 'selectCameraDevice'}('${id}')`, context);
        const old = choose('device-a');
        await choose('device-b');
        pending.resolve(false);
        await old;
        assert.equal(selected.at(-1), 'device-b');
        assert.equal(vm.runInContext(type === 'microphone' ? 'selectedInputDeviceId' : 'selectedCameraDeviceId', context), 'device-b');
    });
}
