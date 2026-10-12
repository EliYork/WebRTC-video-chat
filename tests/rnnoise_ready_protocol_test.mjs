import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createSpeechGate } from '../src/views/audio-worklet/rnnoise-speech-gate.js';

const worklet = readFileSync(
    new URL('../src/views/audio-worklet/rnnoise-processor.js', import.meta.url),
    'utf8'
);
const adapter = worklet.slice(
    worklet.indexOf('// Local initialization handshake'),
    worklet.indexOf('/*! Bundled license information:')
);
const flush = () => new Promise((resolve) => setImmediate(resolve));
const fixture = (reject = false) => {
    let finish,
        registered,
        destroyed = 0;
    const messages = [];
    const context = {
        createSpeechGate,
        Se: 'rnnoise',
        q: {
            loadBinary: () =>
                new Promise((resolve, fail) => {
                    finish = () =>
                        reject ? fail(new Error('wasm failed')) : resolve({});
                }),
        },
        me: () => ({
            process() {},
            destroy() {
                destroyed++;
            },
        }),
        registerProcessor: (_, processor) => {
            registered = processor;
        },
        AudioWorkletProcessor: class {
            constructor() {
                this.port = {
                    addEventListener: (_, callback) => {
                        this.destroyMessage = callback;
                    },
                    start: () => {
                        this.port.started = true;
                    },
                    postMessage: (message) => messages.push(message),
                };
            }
        },
    };
    vm.runInNewContext(adapter, context);
    const processor = new registered({
        processorOptions: { wasmBinary: new ArrayBuffer(1), maxChannels: 1 },
    });
    return {
        processor,
        finish: () => finish(),
        messages,
        get destroyed() {
            return destroyed;
        },
    };
};

test('bundled RNNoise sends ready only after WASM initialization and reports failures instead of silent processing', async () => {
    const ready = fixture();
    assert.equal(ready.messages.length, 0);
    ready.finish();
    await flush();
    assert.equal(ready.messages[0].type, 'ready');
    const failed = fixture(true);
    failed.finish();
    await flush();
    assert.equal(failed.messages[0].type, 'error');
    assert.equal(failed.messages[0].detail, 'Error: wasm failed');
});

test('destroy before initialization releases the late RNNoise state and ends processing', async () => {
    const f = fixture();
    assert.equal(f.processor.port.started, true);
    f.processor.destroyMessage({ data: 'destroy' });
    f.finish();
    await flush();
    assert.equal(f.messages.length, 0);
    assert.equal(f.destroyed, 1);
    assert.equal(f.processor.process([], []), false);
});

test('speech-gate ready capability and live toggle acknowledgement are explicit', async () => {
    const f = fixture();
    f.finish();
    await flush();
    assert.equal(f.messages[0].speechGate, true);
    assert.equal(f.messages[0].speechGateEnabled, true);
    f.processor.destroyMessage({ data: { type: 'speech-gate', enabled: false, revision: 2 } });
    assert.equal(f.messages.at(-1).enabled, false);
    assert.equal(f.messages.at(-1).revision, 2);
    f.processor.destroyMessage({ data: 'destroy' });
    const count = f.messages.length;
    f.processor.destroyMessage({ data: { type: 'speech-gate', enabled: true, revision: 3 } });
    assert.equal(f.messages.length, count);
});
