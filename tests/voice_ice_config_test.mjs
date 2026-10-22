/* eslint-disable no-await-in-loop -- Advance deterministic timers and validate each response separately. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../src/views/js/voice/voice-ice-config.js', import.meta.url), 'utf8');
const base = [{ urls: 'stun:example.test' }];
const response = (id = 'one') => ({ ok: true, turnEnabled: true, ttlSeconds: 600,
    iceServers: [...base, { urls: ['turn:relay.example.test'], username: 'test-' + id, credential: 'test-credential' }] });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture(options = {}) {
    let clock = 10000, sequence = 0, requests = 0, latest = response();
    const timers = new Map(), updates = [], window = {};
    vm.runInNewContext(source, { window });
    const runtime = window.VoiceIceConfig.createRuntime({ enabled: true, baseServers: base, now: () => clock,
        timers: { clearTimeout: id => timers.delete(id), setTimeout: (callback, ms) => { timers.set(++sequence, { callback, ms }); return sequence; } },
        request: () => { requests++; return options.request ? options.request() : latest; }, onUpdate: config => updates.push(config), ...options });
    return { runtime, updates, timers, requests: () => requests,
        set: value => { latest = value; }, advance: ms => { clock += ms; },
        async tick() { const [id, timer] = timers.entries().next().value; timers.delete(id); clock += timer.ms; timer.callback();
            for (let i = 0; i < 15; i++) await Promise.resolve(); },
    };
}

test('no TURN uses the original STUN configuration without issuing credentials', async () => {
    const f = fixture({ enabled: false }); const config = await f.runtime.prepare();
    assert.equal(config.iceServers[0].urls, base[0].urls); assert.equal(f.requests(), 0); assert.equal(f.timers.size, 0);
});
test('synchronous configuration lookup never returns expired credentials or starts a request', async () => {
    const f = fixture(); assert.equal(f.runtime.getConfiguration(), undefined); assert.equal(f.requests(), 0);
    await f.runtime.prepare();
    const config = f.runtime.getConfiguration(); assert.equal(config.iceServers.at(-1).username, 'test-one');
    config.iceServers.at(-1).urls.length = 0;
    assert.equal(f.runtime.getConfiguration().iceServers.at(-1).urls.length, 1);
    f.advance(591000); assert.equal(f.runtime.getConfiguration(), undefined); assert.equal(f.requests(), 1);
    f.runtime.stop(); assert.equal(f.runtime.getConfiguration(), undefined);
});
test('concurrent preparation shares issuance and refresh updates future calls before expiry', async () => {
    const f = fixture(); const [a, b] = await Promise.all([f.runtime.prepare(), f.runtime.prepare()]);
    assert.equal(f.requests(), 1); assert.equal(a.iceServers.at(-1).username, b.iceServers.at(-1).username);
    a.iceServers.at(-1).urls.length = 0;
    assert.equal((await f.runtime.prepare()).iceServers.at(-1).urls.length, 1);
    assert.equal([...f.timers.values()][0].ms, 450000);
    f.set(response('two')); await f.tick();
    assert.equal(f.requests(), 2); assert.equal(f.updates.at(-1).iceServers.at(-1).username, 'test-two');
    f.runtime.stop(); assert.equal(f.timers.size, 0);
});
test('refresh failure preserves still-valid credentials and retries; expired credentials cannot start new calls', async () => {
    const f = fixture(); await f.runtime.prepare();
    f.set({ ok: false, reason: 'ice-rate-limited' }); await f.tick();
    assert.equal(f.updates.length, 1); assert.equal((await f.runtime.prepare()).iceServers.at(-1).username, 'test-one');
    assert.equal([...f.timers.values()][0].ms, 30000);
    f.advance(160000); await assert.rejects(f.runtime.prepare(), /ice-configuration-unavailable/);
    f.set(response('recovered')); await f.tick();
    assert.equal((await f.runtime.prepare()).iceServers.at(-1).username, 'test-recovered'); f.runtime.stop();
});
test('leaving rejects late credentials and a new session is independent', async () => {
    const old = deferred(), fresh = deferred(); let calls = 0;
    const f = fixture({ request: () => (++calls === 1 ? old.promise : fresh.promise) });
    const before = f.runtime.prepare(); await Promise.resolve(); f.runtime.stop();
    const after = f.runtime.prepare(); old.resolve(response('stale')); await assert.rejects(before, /cancelled/);
    assert.equal(f.updates.length, 0); fresh.resolve(response('fresh'));
    assert.equal((await after).iceServers.at(-1).username, 'test-fresh'); assert.equal(f.updates.length, 1); f.runtime.stop();
});
test('leave before dispatch cancels issuance and reconnection only refreshes an active session', async () => {
    const f = fixture(); await f.runtime.reconnect(); assert.equal(f.requests(), 0);
    const pending = f.runtime.prepare(); f.runtime.stop(); await assert.rejects(pending, /cancelled/); assert.equal(f.requests(), 0);
    await f.runtime.prepare(); f.set(response('reconnected')); await f.runtime.reconnect();
    assert.equal((await f.runtime.prepare()).iceServers.at(-1).username, 'test-reconnected'); f.runtime.stop();
});
test('malformed or nearly expired credentials fail, and network delay reduces cache lifetime', async () => {
    for (const malformed of [null, { ok: true }, { ...response(), ttlSeconds: '600' }, { ...response(), ttlSeconds: 1 },
        { ...response(), iceServers: base }, { ...response(), iceServers: [{ urls: null }] }]) {
        const f = fixture(); f.set(malformed); await assert.rejects(f.runtime.prepare(), /ice-configuration-unavailable/); f.runtime.stop();
    }
    const pending = deferred(), f = fixture({ request: () => pending.promise });
    const loading = f.runtime.prepare(); f.advance(10000); pending.resolve(response()); await loading;
    assert.equal([...f.timers.values()][0].ms, 442500); f.runtime.stop();
});
