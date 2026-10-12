import assert from 'node:assert/strict';
import test from 'node:test';
import { createSpeechGate } from '../src/views/audio-worklet/rnnoise-speech-gate.js';

const frame = () => new Float32Array(480).fill(1);
const run = (gate, probability, count = 1) => {
    let output;
    for (let i = 0; i < count; i += 1) {
        output = frame();
        gate.processFrame(output, probability);
    }
    return output;
};

test('low-VAD residual keyboard impulses are attenuated without a new buffer or model', () => {
    const gate = createSpeechGate();
    const input = new Float32Array(480);
    input[140] = 0.8;
    input[141] = -0.6;
    gate.processFrame(input, 0.05);
    assert.ok(Math.abs(input[140] - 0.008) < 1e-8);
    assert.ok(Math.abs(input[141] + 0.006) < 1e-8);
    assert.equal(input.length, 480);
});

test('speech opens within 3ms, keeps low-VAD word tails, and later closes smoothly', () => {
    const gate = createSpeechGate();
    const speech = run(gate, 0.9);
    assert.equal(speech[143], 1);
    assert.equal(speech.at(-1), 1);
    assert.equal(run(gate, 0.05, 16).at(-1), 1);
    assert.ok(run(gate, 0.05, 1).at(-1) > 0.8);
    const quiet = run(gate, 0.05, 12);
    assert.ok(Math.abs(quiet.at(-1) - 0.01) < 1e-8);
});

test('uncertain or quiet speech is softly attenuated, never hard muted', () => {
    const uncertain = run(createSpeechGate(), 0.4);
    assert.ok(uncertain.at(-1) > 0.45 && uncertain.at(-1) < 0.6);
    assert.ok(uncertain[0] > 0);
});

test('disabling the gate restores RNNoise-only audio and invalid VAD fails open', () => {
    const gate = createSpeechGate();
    gate.setEnabled(false);
    assert.equal(run(gate, 0).at(-1), 1);
    for (const probability of [NaN, undefined, -1, 2]) {
        assert.equal(run(createSpeechGate(), probability).at(-1), 1);
    }
});

test('envelopes stay continuous at frame boundaries and re-enable after a bypass', () => {
    const gate = createSpeechGate({ enabled: false });
    gate.setEnabled(true);
    const first = run(gate, 0);
    const second = run(gate, 0);
    assert.ok(first.at(-1) > 0.8);
    assert.ok(Math.abs(second[0] - first.at(-1)) <= 1 / 3840 + 1e-7);
    gate.setEnabled(false);
    assert.equal(run(gate, 0).at(-1), 1);
});
