import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { loadRnnoiseV2 } from '../src/views/audio-worklet/rnnoise-v2-wasm.js';

const binary = readFileSync(new URL('../src/views/wasm/rnnoise-v2-2025.1.5.wasm', import.meta.url));
test('pinned RNNoise v0.2 binary processes signed PCM, reports VAD and releases independent states', async () => {
    assert.equal(createHash('sha256').update(binary).digest('hex'), 'b3b67c9eae8f0791aad468c708659e0850bb37b0fb9c8a8666f2d7b0b6869bc4');
    const api = await loadRnnoiseV2(await WebAssembly.compile(binary));
    assert.equal(api.frameSize, 480);
    const states = [api.createDenoiseState(), api.createDenoiseState()];
    const frame = new Float32Array(480);
    for (let i = 0; i < 100; i++) {
        for (let j = 0; j < 480; j++) frame[j] = Math.sin((i * 480 + j) * 0.037) * 4000;
        const vad = states[0].processFrame(frame);
        assert.ok(vad >= 0 && vad <= 1);
        assert.ok(frame.every(Number.isFinite));
    }
    states[0].destroy(); states[0].destroy();
    assert.throws(() => states[0].processFrame(frame), /state/);
    assert.ok(Number.isFinite(states[1].processFrame(frame)));
    assert.throws(() => states[1].processFrame(new Float32Array(128)), /state/);
    states[1].destroy();
});
