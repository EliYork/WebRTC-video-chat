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
