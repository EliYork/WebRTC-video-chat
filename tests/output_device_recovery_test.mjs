import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const window = {};
vm.runInNewContext(
    readFileSync(
        new URL(
            '../src/views/js/voice/voice-device-runtime.js',
            import.meta.url
        ),
        'utf8'
    ),
    { window }
);
const switchOutputDevice = window.VoiceDeviceRuntime.switchOutputDevice;
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('a new player already using default output does not reopen its audio sink', async () => {
    let calls = 0;
    const element = {
        sinkId: '',
        dataset: {},
        setSinkId() {
            calls++;
            throw new Error('should not reopen');
        },
    };
    assert.equal(
        (await switchOutputDevice({ mediaElement: element })).ok,
        true
    );
    assert.equal(calls, 0);
    assert.equal(element.dataset.outputSinkId, 'default');
});

test('duplicate sink switches share a promise; different selections serialize and the latest wins', async () => {
    const calls = [];
    let finish;
    const element = {
        sinkId: '',
        dataset: {},
        async setSinkId(id) {
            calls.push(id);
            if (id === 'a')
                await new Promise((resolve) => {
                    finish = resolve;
                });
            this.sinkId = id;
        },
    };
    const a = switchOutputDevice({ mediaElement: element, deviceId: 'a' });
    assert.equal(
        switchOutputDevice({ mediaElement: element, deviceId: 'a' }),
        a
    );
    await flush();
    const b = switchOutputDevice({ mediaElement: element, deviceId: 'b' });
    await flush();
    assert.deepEqual(calls, ['a']);
    finish();
    await Promise.all([a, b]);
    assert.deepEqual(calls, ['a', 'b']);
    assert.equal(element.sinkId, 'b');
    assert.equal(element.dataset.outputSinkId, 'b');
});

test('permission failure is distinct and default fallback failure is accurately reported', async () => {
    const element = {
        sinkId: 'old',
        dataset: {},
        async setSinkId() {
            throw Object.assign(new Error('denied'), {
                name: 'NotAllowedError',
            });
        },
    };
    const result = await switchOutputDevice({
        mediaElement: element,
        deviceId: 'new',
    });
    assert.equal(result.errorType, 'permission-denied');
    assert.equal(result.fallbackApplied, false);
    assert.equal(element.dataset.outputSinkId, undefined);
});

test('output choices superseded before native switching starts are skipped', async () => {
    const calls = [];
    const element = {
        sinkId: '',
        dataset: {},
        async setSinkId(id) {
            calls.push(id);
            this.sinkId = id;
        },
    };
    const a = switchOutputDevice({ mediaElement: element, deviceId: 'a' });
    const b = switchOutputDevice({ mediaElement: element, deviceId: 'b' });
    const c = switchOutputDevice({ mediaElement: element, deviceId: 'c' });
    const results = await Promise.all([a, b, c]);
    assert.deepEqual(calls, ['c']);
    assert.equal(results[0].cancelled, true);
    assert.equal(results[1].cancelled, true);
    assert.equal(results[2].ok, true);
    assert.equal(element.dataset.outputSinkId, 'c');
});

test('an obsolete native failure does not route through default or an abandoned queued device', async () => {
    const calls = [];
    let reject;
    const element = {
        sinkId: 'old',
        dataset: { outputSinkId: 'old' },
        async setSinkId(id) {
            calls.push(id);
            if (id === 'a')
                await new Promise((_, fail) => {
                    reject = fail;
                });
            this.sinkId = id;
        },
    };
    const a = switchOutputDevice({ mediaElement: element, deviceId: 'a' });
    await flush();
    const b = switchOutputDevice({ mediaElement: element, deviceId: 'b' });
    const c = switchOutputDevice({ mediaElement: element, deviceId: 'c' });
    assert.equal(
        switchOutputDevice({ mediaElement: element, deviceId: 'c' }),
        c
    );
    const all = Promise.all([a, b, c]);
    reject(
        Object.assign(new Error('old device disappeared'), {
            name: 'NotFoundError',
        })
    );
    const results = await all;
    assert.deepEqual(calls, ['a', 'c']);
    assert.equal(results[0].cancelled, true);
    assert.equal(results[1].cancelled, true);
    assert.equal(element.sinkId, 'c');
    assert.equal(element.dataset.outputSinkId, 'c');
});

test('a fallback already in flight cannot publish old default metadata over a newer selection', async () => {
    let finishFallback, finishCurrent;
    const element = {
        sinkId: 'old',
        dataset: { outputSinkId: 'old' },
        async setSinkId(id) {
            if (id === 'missing')
                throw Object.assign(new Error('gone'), {
                    name: 'NotFoundError',
                });
            await new Promise((resolve) => {
                if (id === '') finishFallback = resolve;
                else finishCurrent = resolve;
            });
            this.sinkId = id;
        },
    };
    const old = switchOutputDevice({
        mediaElement: element,
        deviceId: 'missing',
    });
    await flush();
    const current = switchOutputDevice({
        mediaElement: element,
        deviceId: 'current',
    });
    finishFallback();
    await flush();
    const interim = element.dataset.outputSinkId;
    finishCurrent();
    const [obsolete, adopted] = await Promise.all([old, current]);
    assert.equal(interim, 'old');
    assert.equal(obsolete.cancelled, true);
    assert.equal(adopted.ok, true);
    assert.equal(element.dataset.outputSinkId, 'current');
});

test('a current missing output still falls back and a subsequent device can be selected', async () => {
    const calls = [];
    const element = {
        sinkId: 'old',
        dataset: {},
        async setSinkId(id) {
            calls.push(id);
            if (id === 'missing')
                throw Object.assign(new Error('gone'), {
                    name: 'NotFoundError',
                });
            this.sinkId = id;
        },
    };
    const failed = await switchOutputDevice({
        mediaElement: element,
        deviceId: 'missing',
    });
    assert.equal(failed.errorType, 'device-not-found');
    assert.equal(failed.fallbackApplied, true);
    assert.equal(element.dataset.outputSinkId, 'default');
    const retry = await switchOutputDevice({
        mediaElement: element,
        deviceId: 'current',
    });
    assert.equal(retry.ok, true);
    assert.deepEqual(calls, ['missing', '', 'current']);
    assert.equal(element.dataset.outputSinkId, 'current');
});

test('independent output targets retain independent native switch queues', async () => {
    let finish;
    const first = {
        sinkId: '',
        async setSinkId(id) {
            await new Promise((resolve) => {
                finish = resolve;
            });
            this.sinkId = id;
        },
    };
    const second = {
        sinkId: '',
        async setSinkId(id) {
            this.sinkId = id;
        },
    };
    const a = switchOutputDevice({ mediaElement: first, deviceId: 'a' });
    await flush();
    assert.equal(
        (await switchOutputDevice({ mediaElement: second, deviceId: 'b' })).ok,
        true
    );
    assert.equal(second.sinkId, 'b');
    finish();
    assert.equal((await a).ok, true);
});

test('the app queues a return to default even while old metadata still says default', async () => {
    const script = readFileSync(
        new URL('../src/views/script.js', import.meta.url),
        'utf8'
    );
    const begin = script.indexOf('const applyOutputDevice =');
    const end = script.indexOf('const applyOutputSettings =', begin);
    assert.ok(begin >= 0 && end > begin);
    let finish;
    const calls = [];
    const element = {
        sinkId: '',
        dataset: { outputSinkId: 'default' },
        async setSinkId(id) {
            calls.push(id);
            if (id === 'a')
                await new Promise((resolve) => {
                    finish = resolve;
                });
            this.sinkId = id;
        },
    };
    const context = vm.createContext({
        selectedOutputDeviceId: 'a',
        outputSelectionRevision: 1,
        canSelectAudioOutput: () => true,
        voiceDeviceRuntimeApi: window.VoiceDeviceRuntime,
        remoteAudioGain: {
            getOutputTarget: () => null,
            getBranchToken: () => undefined,
            activateOutput() {},
        },
        notifyMediaDock() {},
    });
    const apply = vm.runInContext(
        script.slice(begin, end) + '\napplyOutputDevice',
        context
    );
    const old = apply(element, true);
    await flush();
    context.selectedOutputDeviceId = 'default';
    context.outputSelectionRevision += 1;
    const current = apply(element, true);
    finish();
    await Promise.all([old, current]);
    assert.deepEqual(calls, ['a', '']);
    assert.equal(element.sinkId, '');
    assert.equal(element.dataset.outputSinkId, 'default');
});
