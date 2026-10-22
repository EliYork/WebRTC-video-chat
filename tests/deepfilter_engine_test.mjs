import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

globalThis.AudioWorkletNode = class {};
const { createDeepfilterLoader } = await import('../src/views/js/voice/deepfilter-engine.js');
const hashes = {
    wasm: '8ebf2b217b80fc128505b993c8d7d7d892df5a845ab7a2516fed74b76e7fe708',
    model: 'c94d91f70911001c946e0fabb4aa9adc37045f45a03b56008cb0c8244cb63616',
};
const fixture = () => {
    const calls = [];
    const deps = {
        fetchBytes: async (url, signal) => {
            calls.push({ url, signal });
            return url.endsWith('.wasm') ? 'wasm' : 'model';
        },
        digest: async kind => hashes[kind],
        compile: async () => ({ module: true }),
    };
    return { deps, calls };
};

test('enhanced loader is lazy, uses only local pinned assets and caches only verified success', async () => {
    const f = fixture(), load = createDeepfilterLoader(f.deps);
    assert.equal(f.calls.length, 0);
    const a = await load(), b = await load();
    assert.equal(a, b);
    assert.equal(f.calls.length, 2);
    assert.ok(f.calls.every(call => call.url.startsWith('/wasm/deepfilter-0.2.0/')));
});

test('download, integrity and compilation failures can be retried without poisoning the model cache', async () => {
    await Promise.all(['download', 'integrity', 'compile'].map(async phase => {
        const f = fixture();
        let bad = true;
        const deps = { ...f.deps,
            fetchBytes: async (...args) => { if (bad && phase === 'download') throw Error('network-failed'); return f.deps.fetchBytes(...args); },
            digest: async kind => bad && phase === 'integrity' ? 'wrong' : hashes[kind],
            compile: async () => { if (bad && phase === 'compile') throw Error('unsupported-wasm'); return {}; },
        };
        const load = createDeepfilterLoader(deps);
        await assert.rejects(load());
        bad = false;
        assert.ok((await load()).wasmModule);
    }));
});

test('cancelled downloads abort their fetches and cannot cache late successful compilation', async () => {
    const f = fixture(), abort = new AbortController();
    let release;
    f.deps.compile = () => new Promise(resolve => { release = resolve; });
    const load = createDeepfilterLoader(f.deps), pending = load({ signal: abort.signal });
    await new Promise(resolve => setImmediate(resolve));
    abort.abort();
    assert.ok(f.calls.every(call => call.signal.aborted));
    release({ obsolete: true });
    await assert.rejects(pending, { name: 'AbortError' });
    // The injected function was captured; use its next invocation's resolver.
    const retry = load();
    await new Promise(resolve => setImmediate(resolve));
    release({ current: true });
    assert.equal((await retry).wasmModule.current, true);
    assert.equal(f.calls.length, 4);
    await assert.rejects(load({ signal: abort.signal }), { name: 'AbortError' });
});

test('vendored DeepFilterNet3 assets match the pinned manifest and process actual WASM in 128-sample blocks', async () => {
    const manifest = JSON.parse(readFileSync(new URL('../src/views/vendor/deepfilter-0.2.0/manifest.json', import.meta.url)));
    for (const [path, expected] of Object.entries(manifest.files)) {
        const bytes = readFileSync(new URL(`../${path}`, import.meta.url));
        assert.equal(bytes.length, expected.bytes, path);
        assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256, path);
    }
    const root = new URL('../src/views/', import.meta.url);
    const wasmModule = await WebAssembly.compile(readFileSync(new URL('wasm/deepfilter-0.2.0/df_bg.wasm', root)));
    let Processor;
    const messages = [];
    vm.runInNewContext(readFileSync(new URL('vendor/deepfilter-0.2.0/processor.js', root), 'utf8'), {
        WebAssembly, TextEncoder, TextDecoder, Float32Array, Uint8Array, sampleRate: 48000,
        performance, crypto, console,
        AudioWorkletProcessor: class { constructor() { this.port = { postMessage: data => messages.push(data) }; } },
        registerProcessor: (_, value) => { Processor = value; },
    });
    const node = new Processor({ processorOptions: { wasmModule,
        modelBytes: readFileSync(new URL('wasm/deepfilter-0.2.0/DeepFilterNet3_onnx.tar.gz', root)),
        speechAttenuationDb: 25, bypassUntilReady: false, maxLoad: 0 } });
    assert.equal(messages[0].type, 'ready');
    assert.equal(messages[0].frameSamples, 480);
    let energy = 0;
    for (let q = 0; q < 400; q++) {
        const input = Float32Array.from({ length: 128 }, (_, i) => Math.sin((q * 128 + i) * 0.03) * 0.1);
        const output = new Float32Array(128);
        assert.equal(node.process([[input]], [[output]]), true);
        assert.ok(output.every(Number.isFinite));
        for (const value of output) energy += value * value;
    }
    assert.ok(energy > 0, 'output must not be permanent silence');
    assert.equal(messages.filter(data => data.type === 'error').length, 0);
    node.port.onmessage({ data: { type: 'dispose' } });
    const output = new Float32Array(128);
    node.process([[new Float32Array(128).fill(1)]], [[output]]);
    assert.ok(output.every(value => value === 0));
});
