import assert from 'node:assert/strict';
import test from 'node:test';
// The module exports a browser node as well as its injectable loader.
globalThis.AudioWorkletNode = class {};
const { createRnnoiseLoader } = await import('../src/views/js/voice/rnnoise-engine.js');
const fixture = (step = 0.4) => {
    let time = 0, destroyed = 0, legacyLoads = 0, yielded = 0;
    const old = new ArrayBuffer(8), modern = {};
    const deps = {
        fetchModel: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }),
        compile: async () => modern,
        loadModern: async () => ({ frameSize: 480, createDenoiseState: () => ({ processFrame: () => 0.5, destroy: () => { destroyed++; } }) }),
        loadOld: async () => { legacyLoads++; return old; },
        now: () => { time += step; return time; },
        yieldTask: async () => { yielded++; },
    };
    return { deps, modern, old, stats: () => ({ destroyed, legacyLoads, yielded }) };
};
test('bounded new-model probe destroys its temporary state, yields and passes a compiled module', async () => {
    const f = fixture();
    const value = await createRnnoiseLoader(f.deps)({});
    assert.equal(value.engine, 'rnnoise-v2-2025.1.5');
    assert.equal(value.binary, f.modern);
    assert.equal(value.probeP95Ms, 0.4);
    assert.deepEqual(f.stats(), { destroyed: 1, legacyLoads: 0, yielded: 6 });
});
test('slow or failed modern model falls back to working legacy with a disclosed reason', async () => {
    const slow = fixture(3);
    const a = await createRnnoiseLoader(slow.deps)({});
    assert.equal(a.engine, 'rnnoise-legacy-2022'); assert.equal(a.fallback, 'model-too-slow');
    assert.equal(slow.stats().destroyed, 1);
    const failed = fixture(); failed.deps.compile = async () => { throw new Error('unsupported'); };
    const b = await createRnnoiseLoader(failed.deps)({});
    assert.equal(b.binary, failed.old); assert.equal(b.fallback, 'model-load-failed');
});
test('inference failure releases probe state; total model failure rejects so the old live pipeline survives', async () => {
    const f = fixture();
    f.deps.loadModern = async () => ({ frameSize: 480, createDenoiseState: () => ({ processFrame() { throw new Error('failed'); }, destroy() { f.freed = true; } }) });
    const value = await createRnnoiseLoader(f.deps)({});
    assert.equal(f.freed, true); assert.equal(value.fallback, 'model-load-failed');
    f.deps.loadOld = async () => { throw new Error('legacy-missing'); };
    await assert.rejects(createRnnoiseLoader(f.deps)({}), /legacy-missing/);
});
