import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/views/js/media/noise-settings-ui.js', import.meta.url), 'utf8');
const fixture = (saved, preferences = []) => {
    const storage = new Map([...(saved === undefined ? [] : [['webrtc-mic-gain', saved]]), ...preferences]);
    const window = { VoiceViewUtils: {
        safeStorageGet: (key) => storage.get(key) ?? null,
        safeStorageSet: (key, value) => storage.set(key, String(value)),
    } };
    vm.runInNewContext(source, { window });
    return window.VoiceNoiseSettingsUI;
};

test('fresh or unavailable microphone settings keep audible 100 percent gain before UI initialization', () => {
    for (const saved of [undefined, null, '', ' ', 'bad', 'Infinity', '-1', '201']) {
        assert.equal(fixture(saved).getMicGain(), 100);
    }
});

test('explicit zero and valid user microphone levels are preserved', () => {
    for (const saved of ['0', '25', '100', '150', '200']) {
        const api = fixture(saved);
        assert.equal(api.getMicGain(), Number(saved));
        api.setMicGain(80, { syncUI: false });
        assert.equal(api.getMicGain(), 80);
    }
});

test('fresh settings default to RNNoise with AEC and speech gate, without double suppression', () => {
    const api = fixture();
    assert.equal(api.getNoiseMode(), 'rnnoise');
    assert.equal(api.getAiExperimentEnabled(), true);
    assert.equal(api.getRnnoiseSpeechGateEnabled(), true);
    assert.equal(api.getAudioConstraints().echoCancellation, true);
    assert.equal(api.getAudioConstraints().noiseSuppression, false);
    assert.equal(api.getAudioConstraints().autoGainControl, false);
});

test('saved modes take priority over the new default and legacy preferences', () => {
    for (const mode of ['browser', 'off', 'rnnoise']) {
        const api = fixture(undefined, [['webrtc-noise-mode', mode], ['webrtc-ai-noise-experiment', 'true']]);
        assert.equal(api.getNoiseMode(), mode);
    }
    const api = fixture(undefined, [['webrtc-rnnoise-speech-gate', 'false']]);
    assert.equal(api.getRnnoiseSpeechGateEnabled(), false);
});

test('legacy explicit settings remain compatible while missing or invalid settings use RNNoise', () => {
    for (const [preferences, expected] of [
        [[['webrtc-noise-suppression', 'true']], 'browser'],
        [[['webrtc-noise-suppression', 'false']], 'off'],
        [[['webrtc-ai-noise-experiment', 'false']], 'browser'],
        [[['webrtc-ai-noise-experiment', 'true'], ['webrtc-noise-suppression', 'false']], 'rnnoise'],
        [[['webrtc-noise-mode', 'unknown']], 'rnnoise'],
        [[['webrtc-noise-mode', 'unknown'], ['webrtc-noise-suppression', 'false']], 'off'],
    ]) assert.equal(fixture(undefined, preferences).getNoiseMode(), expected);
});

test('unavailable browser storage defaults to RNNoise without writing or accessing devices', () => {
    const window = { localStorage: { getItem() { throw new Error('unavailable'); }, setItem() { throw new Error('unavailable'); } } };
    vm.runInNewContext(readFileSync(new URL('../src/views/js/shared/view-utils.js', import.meta.url), 'utf8'), { window });
    vm.runInNewContext(source, { window });
    assert.equal(window.VoiceNoiseSettingsUI.getNoiseMode(), 'rnnoise');
});

test('a saved experimental model migrates to RNNoise with AEC and without double suppression', () => {
    const api = fixture(undefined, [['webrtc-noise-mode', 'deepfilter'], ['webrtc-rnnoise-speech-gate', 'false']]);
    assert.equal(api.getNoiseMode(), 'rnnoise');
    assert.equal(api.getRnnoiseSpeechGateEnabled(), false);
    assert.equal(api.setNoiseMode('deepfilter'), false);
    assert.equal(api.getAudioConstraints().noiseSuppression, false);
    assert.equal(api.getAudioConstraints().autoGainControl, false);
    assert.equal(api.getAudioConstraints().echoCancellation, true);
});
