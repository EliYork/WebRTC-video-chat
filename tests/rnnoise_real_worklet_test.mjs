import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createSpeechGate } from '../src/views/audio-worklet/rnnoise-speech-gate.js';

test('real bundled WASM feeds VAD into the gate without changing quantum/frame scheduling', async () => {
    const url = new URL(
        '../src/views/audio-worklet/rnnoise-processor.js',
        import.meta.url
    );
    const source = readFileSync(url, 'utf8')
        .replace(/^import .*rnnoise-speech-gate.js';\r?\n/, '')
        .replaceAll('import.meta.url', JSON.stringify(url.href));
    const binary = readFileSync(
        new URL('../src/views/wasm/rnnoise.wasm', import.meta.url)
    );
    let Processor;
    const probabilities = [];
    vm.runInNewContext(source, {
        WebAssembly,
        ArrayBuffer,
        Uint8Array,
        Int8Array,
        Int16Array,
        Uint16Array,
        Int32Array,
        Uint32Array,
        Float32Array,
        Float64Array,
        TextEncoder,
        setTimeout,
        clearTimeout,
        console,
        createSpeechGate: (config) => {
            const gate = createSpeechGate(config);
            return {
                ...gate,
                processFrame: (frame, probability) => {
                    probabilities.push(probability);
                    return gate.processFrame(frame, probability);
                },
            };
        },
        AudioWorkletProcessor: class {
            constructor() {
                this.port = {
                    addEventListener: (_, listener) => {
                        this.onMessage = listener;
                    },
                    start() {},
                    postMessage: (data) => {
                        this.onReady?.(data);
                    },
                };
            }
        },
        registerProcessor: (_, value) => {
            Processor = value;
        },
    });
    const create = async (enabled) => {
        const node = new Processor({
            processorOptions: {
                wasmBinary: binary.buffer.slice(
                    binary.byteOffset,
                    binary.byteOffset + binary.byteLength
                ),
                maxChannels: 1,
            },
        });
        node.onMessage({ data: { type: 'speech-gate', enabled, revision: 1 } });
        await new Promise((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error('real-WASM-init-timeout')),
                3000
            );
            node.onReady = (data) => {
                clearTimeout(timer);
                if (data.type === 'error')
                    reject(new Error('real-WASM-init-failed'));
                else if (data.type === 'ready') resolve();
            };
        });
        return node;
    };
    const [plain, gated] = await Promise.all([create(false), create(true)]);
    let plainEnergy = 0,
        gatedEnergy = 0;
    try {
        for (let quantum = 0; quantum < 500; quantum += 1) {
            const input = new Float32Array(128);
            for (let i = 0; i < 128; i += 1) {
                const sample = quantum * 128 + i;
                // Repeatable, short broadband impulses; this is a synthetic
                // mechanism check, not real keyboard/speech quality acceptance.
                if (sample % 7000 < 80)
                    input[i] = Math.sin(sample * 2.73) * 0.35;
            }
            const a = new Float32Array(128),
                b = new Float32Array(128);
            assert.equal(plain.process([[input]], [[a]]), true);
            assert.equal(gated.process([[input]], [[b]]), true);
            for (let i = 0; i < 128; i += 1) {
                assert.ok(Number.isFinite(a[i]) && Number.isFinite(b[i]));
                plainEnergy += a[i] ** 2;
                gatedEnergy += b[i] ** 2;
            }
        }
        assert.ok(plainEnergy > 0);
        assert.ok(gatedEnergy < plainEnergy * 0.5);
        assert.ok(probabilities.length > 100);
        assert.ok(
            probabilities.every((p) => Number.isFinite(p) && p >= 0 && p <= 1)
        );
    } finally {
        plain.onMessage({ data: 'destroy' });
        gated.onMessage({ data: 'destroy' });
    }
    assert.equal(gated.process([], []), false);
});
