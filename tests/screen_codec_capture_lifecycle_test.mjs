/* eslint-disable no-await-in-loop -- Microtask flushing and lifecycle scenarios deliberately advance sequentially. */
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { StrictStream, StrictTrack } from './helpers/strict_media_peer.mjs';

const source = readFileSync(new URL('../src/views/script.js', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const flush = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };
function fixture() {
    const window = {};
    for (const file of ['voice-media-operation-runtime.js', 'voice-media-lifecycle.js'])
        vm.runInNewContext(readFileSync(new URL('../src/views/js/voice/' + file, import.meta.url), 'utf8'), { window });
    const video = new StrictTrack('video', 'screen');
    const audio = new StrictTrack('audio', 'screen-audio');
    const captured = new StrictStream([video, audio]);
    const stopStream = (stream) => stream?.getTracks().forEach((track) => { track.readyState = 'ended'; });
    const controller = window.VoiceMediaOperationRuntime.createMediaOperationController({ getEpoch: () => 1, stopStream });
    let complete;
    let signal;
    let pubs = 0;
    window.VoiceScreenCodecs = { prepare: (_, options, context) => {
        signal = context.signal;
        return new Promise((resolve) => {
            complete = () => resolve({ primary: 'h264', mode: options.codecMode });
            signal.addEventListener('abort', () => resolve({ primary: 'vp8', reason: 'cancelled' }), { once: true });
        });
    } };
    const context = vm.createContext({ window, AbortController,
        console: { warn() {}, info() {} },
        mediaOperationController: controller,
        voiceMediaLifecycle: window.VoiceMediaLifecycle,
        requestDisplayMedia: async () => captured,
        voiceSessionRuntime: { getSnapshot: () => ({ epoch: 1 }) },
        localMediaTrackStopper: { stopStream },
        screenSfuRuntime: { stopPublishing() {}, publish() { pubs++; } },
        voiceMediaQualityRuntime: { stop() {} }, voiceMediaDebug: { record() {} },
        localScreenSharePreviewController: { stopSession() {} },
        voiceStatusView: { setMediaError() {} }, unbindScreenTrackEnded() {},
        setMediaOperationError() {}, notifyMediaDock() {}, emitLocalPresenceUpdate() {}, updateLocalUserCard() {},
        emitScreenShareState() {}, setLocalVideoStream() {}, getActiveStream: () => captured,
        sendVideoTrackToPeers() {}, updateScreenP2pBudget() {}, restoreCameraAfterScreenShare() {},
    });
    context.navigator = { mediaDevices: { getSupportedConstraints: () => ({ restrictOwnAudio: true }) } };
    vm.runInContext(`
        let screenShareRequestPending = false, sharingNow = false;
        let currentScreenStream, currentScreenShareSession, activeVideoTrack, screenCodecAbort;
        const localVoiceSessionGeneration = 1;
        const setScreenShareRequestPending = (value) => { screenShareRequestPending = value; };
        ${section('const stopCurrentScreenStream =', 'const restoreCameraAfterScreenShare =')}
        ${section('const startScreenShare =', 'const stopScreenShare =')}
    `, context);
    return { video, audio, controller, window, pubs: () => pubs, signal: () => signal,
        complete: () => complete(), run: () => vm.runInContext('startScreenShare({}, { codecMode: "auto", frameRate: 60 })', context),
        read: (code) => vm.runInContext(code, context),
        hangup() { controller.setDesired('screen', false); controller.invalidate('screen'); vm.runInContext('stopCurrentScreenStream()', context); },
    };
}

test('app keeps sharing pending until codec choice and publishes the captured stream once', async () => {
    const f = fixture();
    const pending = f.run();
    await flush();
    assert.equal(f.read('screenShareRequestPending'), true);
    assert.equal(f.pubs(), 0);
    f.complete();
    assert.equal(await pending, true);
    assert.equal(f.read('currentScreenShareSession.codecDecision.primary'), 'h264');
    assert.equal(f.pubs(), 1);
    assert.equal(f.video.readyState, 'live');
});

test('hangup or browser ending capture during preflight never publishes late media and releases screen audio too', async () => {
    for (const reason of ['hangup', 'ended']) {
        const f = fixture();
        const pending = f.run();
        await flush();
        if (reason === 'hangup') f.hangup(); else f.video.end();
        assert.equal(await pending, false);
        assert.equal(f.signal().aborted, true);
        assert.equal(f.pubs(), 0);
        assert.equal(f.video.readyState, 'ended');
        assert.equal(f.audio.readyState, 'ended');
        assert.equal(f.video.listenerCount('ended'), 0);
        assert.equal(f.read('sharingNow'), false);
    }
});

test('unexpected preflight failure stops the acquired stream rather than leaking capture', async () => {
    const f = fixture();
    f.window.VoiceScreenCodecs.prepare = async () => { throw new Error('injected'); };
    assert.equal(await f.run(), false);
    assert.equal(f.video.readyState, 'ended');
    assert.equal(f.audio.readyState, 'ended');
    assert.equal(f.pubs(), 0);
});
