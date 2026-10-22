import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/views/js/media/noise-settings-ui.js', import.meta.url), 'utf8');
const fixture = (saved) => {
    const storage = new Map(saved === undefined ? [] : [['webrtc-mic-gain', saved]]);
    const window = { VoiceViewUtils: {
        safeStorageGet: (key) => storage.get(key) ?? null,
        safeStorageSet: (key, value) => storage.set(key, String(value)),
    } };
    vm.runInNewContext(source, { window });
    return window.VoiceNoiseSettingsUI;
};

test('fresh or unavailable microphone settings keep audible 100 percent gain before UI initialization', () => {
    for (const saved of [undefined, null, '', ' ', 'bad', 'Infinity', '-1', '151']) {
        assert.equal(fixture(saved).getMicGain(), 100);
    }
});

test('explicit zero and valid user microphone levels are preserved', () => {
    for (const saved of ['0', '25', '100', '150']) {
        const api = fixture(saved);
        assert.equal(api.getMicGain(), Number(saved));
        api.setMicGain(80, { syncUI: false });
        assert.equal(api.getMicGain(), 80);
    }
});

test('enhanced mode persists explicitly without changing the default or enabling browser double suppression', () => {
    const api = fixture();
    assert.equal(api.getNoiseMode(), 'browser');
    assert.equal(api.setNoiseMode('deepfilter'), true);
    assert.equal(api.getNoiseMode(), 'deepfilter');
    assert.equal(api.getAudioConstraints().noiseSuppression, false);
    assert.equal(api.getAudioConstraints().autoGainControl, false);
    assert.equal(api.getAudioConstraints().echoCancellation, true);
    assert.equal(api.setNoiseMode('invented'), false);
    assert.equal(api.getNoiseMode(), 'deepfilter');
});
