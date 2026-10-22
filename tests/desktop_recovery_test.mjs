/* eslint-disable no-await-in-loop -- Exercise cancel and quit as separate ordered lifecycles. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { openRoom } from '../desktop/windows/startup-recovery.cjs';
import { createNativeRuntime } from '../desktop/windows/native-runtime.cjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(options = {}) {
    const children = [], states = [], logs = [], stops = [];
    const controller = createNativeRuntime({
        launch: () => {
            const child = new EventEmitter();
            Object.assign(child, { pid: children.length + 1, exitCode: null, signalCode: null,
                stdout: new EventEmitter(), stderr: new EventEmitter(), stdin: new EventEmitter() });
            child.die = () => { child.exitCode = 1; child.emit('exit', 1); };
            children.push(child); return child;
        },
        stopChild: async child => { stops.push(child.pid); if (child.exitCode === null) child.die(); },
        changed: value => states.push(value), log: value => logs.push(value), ...options,
    });
    const ready = (child = children.at(-1)) => child.stdout.emit('data', Buffer.from('{"instanceToken":"secret-never-logged","port":31234}\n'));
    return { controller, children, states, logs, stops, ready };
}

test('offline startup retries with a fresh controller; only the successful room is retained', async () => {
    const attempts = [], dialogs = [];
    const opened = await openRoom({ url: 'https://voice.eliyork.com/room/lobby', cancelled: () => false,
        createStartup: () => {
            const attempt = { disposed: false, load: async url => {
                assert.match(url, /room\/lobby$/);
                if (attempts.length === 1) throw Error('offline');
            }, dispose() { this.disposed = true; } };
            attempts.push(attempt); return attempt;
        }, confirm: async options => { dialogs.push(options); return { response: 0 }; }, log: () => {} });
    assert.equal(opened, true); assert.equal(attempts.length, 2);
    assert.equal(attempts[0].disposed, true); assert.equal(attempts[1].disposed, false);
    assert.equal(dialogs[0].accept, '重试连接');
});

test('startup cancel and quit during the retry dialog cannot launch another navigation', async () => {
    for (const quit of [false, true]) {
        let cancelled = false, attempts = 0;
        const opened = await openRoom({url:'room', cancelled:() => cancelled,
            createStartup:() => { attempts++; return {load: async () => { throw Error('offline'); }, dispose() {}}; },
            confirm:async () => { cancelled = quit; return {response:quit ? 0 : 1}; }, log:() => {}});
        assert.equal(opened, false); assert.equal(attempts, 1);
    }
});

test('native recovery shares concurrent requests and does not replace a healthy process', async () => {
    const f = fixture(), first = f.controller.start();
    assert.equal(f.controller.start(), first);
    f.ready(); await first;
    await f.controller.start();
    assert.equal(f.children.length, 1); assert.deepEqual(f.stops, []);
    assert.deepEqual(f.controller.snapshot(), {state:'ready', port:31234});
    assert.ok(!JSON.stringify(f.states).includes('secret'));
    assert.ok(!JSON.stringify(f.logs).includes('secret'));
    await f.controller.stop();
});

test('exited native process can recover while late old output cannot overwrite its port', async () => {
    const f = fixture(), first = f.controller.start(); f.ready(); await first;
    const old = f.children[0]; old.die();
    assert.deepEqual(f.controller.snapshot(), {state:'failed', port:null});
    const recovery = f.controller.start(); await tick();
    old.stdout.emit('data', Buffer.from('{"instanceToken":"old","port":1234}\n'));
    assert.equal(f.controller.snapshot().port, null);
    f.ready(); await recovery;
    assert.equal(f.children.length, 2); assert.equal(f.controller.snapshot().state, 'ready');
    await f.controller.stop();
});

test('native readiness waits for complete validated JSON and ignores malformed lines', async () => {
    const f = fixture(), loading = f.controller.start(), child = f.children[0];
    child.stdout.emit('data', Buffer.from('{"instanceToken":oops}\n{"instanceToken":"x","port":-1}\n{"instanceToken":"x",'));
    assert.equal(f.controller.snapshot().state, 'starting');
    child.stdout.emit('data', Buffer.from('"port":31234}\n'));
    await loading; assert.equal(f.controller.snapshot().state, 'ready');
    await f.controller.stop();
});

test('native timeout cleans the owned process and permits a manual retry', async () => {
    const f = fixture({timeoutMs:10});
    await assert.rejects(f.controller.start(), /超时/);
    assert.equal(f.children[0].exitCode, 1); assert.equal(f.controller.snapshot().port, null);
    const retry = f.controller.start(); await tick(); f.ready(); await retry;
    assert.equal(f.children.length, 2); await f.controller.stop();
});

test('quit cancels native startup, cleans once, and rejects every later restart', async () => {
    const f = fixture(), loading = f.controller.start();
    const rejected = assert.rejects(loading, /stopped/);
    await f.controller.stop(); await rejected;
    assert.deepEqual(f.stops, [1]); assert.equal(f.controller.snapshot().state, 'stopped');
    f.ready(); await assert.rejects(f.controller.start(), /stopped/);
    assert.equal(f.children.length, 1); assert.equal(f.controller.snapshot().port, null);
});

test('spawn failure surfaces as recoverable without leaking raw child output', async () => {
    const f = fixture(), loading = f.controller.start();
    f.children[0].emit('error', Error('spawn ENOENT'));
    await assert.rejects(loading, /ENOENT/);
    assert.equal(f.controller.snapshot().state, 'failed');
    await f.controller.stop();
});
