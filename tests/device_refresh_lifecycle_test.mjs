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
const { createDeviceRuntime } = window.VoiceDeviceRuntime;
const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, reject, resolve };
};

test('disposing during missing-device recovery suppresses late device publication and success', async () => {
    const recovery = deferred();
    const started = deferred();
    const notifications = [];
    const events = [];
    let recoveryCalls = 0;
    const runtime = createDeviceRuntime({
        enumerateDevices: async () => [],
        onDebug: (event) => events.push(event),
        onDevices: (value) => notifications.push(value),
        onMissing: ({ type }) => {
            assert.equal(type, 'mic');
            recoveryCalls += 1;
            started.resolve();
            return recovery.promise;
        },
    });
    runtime.setSelected('mic', 'removed-mic');
    const refresh = runtime.refresh({ reason: 'devicechange' });
    await started.promise;
    assert.equal(recoveryCalls, 1);
    assert.equal(runtime.dispose(), true);
    recovery.resolve();

    const result = await refresh;
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'stale');
    assert.equal(notifications.length, 0);
    assert.equal(
        events.some(({ event }) => event === 'device-refresh-success'),
        false
    );
    assert.equal(runtime.getSnapshot().disposed, true);
});

test('an older recovery cannot republish after a newer refresh has completed', async () => {
    const recovery = deferred();
    const started = deferred();
    const notifications = [];
    const events = [];
    let devices = [];
    const runtime = createDeviceRuntime({
        enumerateDevices: async () => devices,
        onDebug: (event) => events.push(event),
        onDevices: ({ devices, reason, selected }) =>
            notifications.push({
                ids: devices.mic.map(({ deviceId }) => deviceId),
                reason,
                selected: selected.mic,
            }),
        onMissing: () => {
            started.resolve();
            return recovery.promise;
        },
    });
    runtime.setSelected('mic', 'old-mic');
    const old = runtime.refresh({ reason: 'old-change' });
    await started.promise;
    devices = [{ deviceId: 'new-mic', kind: 'audioinput' }];
    runtime.setSelected('mic', 'new-mic');
    const current = await runtime.refresh({ reason: 'new-change' });
    assert.equal(current.ok, true);
    assert.equal(notifications.length, 1);
    recovery.resolve();

    assert.equal((await old).reason, 'stale');
    assert.equal(notifications.length, 1);
    assert.deepEqual([...notifications[0].ids], ['new-mic']);
    assert.equal(notifications[0].reason, 'new-change');
    assert.equal(notifications[0].selected, 'new-mic');
    assert.equal(runtime.getSnapshot().selected.mic, 'new-mic');
    const successes = events.filter(
        ({ event }) => event === 'device-refresh-success'
    );
    assert.deepEqual(
        successes.map(({ reason }) => reason),
        ['new-change']
    );
});

test('late enumeration or recovery rejection is stale after disposal or a newer refresh', async () => {
    await Promise.all(
        ['enumeration', 'recovery'].flatMap((stage) =>
            ['dispose', 'refresh'].map(async (replacement) => {
                const pending = deferred();
                const started = deferred();
                const events = [];
                let calls = 0;
                const runtime = createDeviceRuntime({
                    enumerateDevices: () => {
                        calls += 1;
                        return stage === 'enumeration' && calls === 1
                            ? pending.promise
                            : Promise.resolve([]);
                    },
                    onMissing: () => {
                        started.resolve();
                        return pending.promise;
                    },
                    onDebug: (event) => events.push(event),
                });
                if (stage === 'recovery')
                    runtime.setSelected('mic', 'missing-mic');
                const old = runtime.refresh();
                if (stage === 'recovery') await started.promise;
                if (replacement === 'dispose') runtime.dispose();
                else assert.equal((await runtime.refresh()).ok, true);
                pending.reject(new Error(`late-${stage}-failure`));

                const result = await old;
                assert.equal(result.ok, false);
                assert.equal(result.reason, 'stale');
                assert.equal(result.error, undefined);
                assert.equal(
                    events.some(
                        ({ event }) => event === 'device-refresh-failure'
                    ),
                    false
                );
            })
        )
    );
});

test('current enumeration failures remain observable and permit a later successful refresh', async () => {
    const failure = Object.assign(new Error('device enumeration denied'), {
        name: 'NotAllowedError',
    });
    const notifications = [];
    const events = [];
    let failing = true;
    const runtime = createDeviceRuntime({
        enumerateDevices: async () => {
            if (failing) throw failure;
            return [{ deviceId: 'mic-a', kind: 'audioinput' }];
        },
        onDevices: (value) => notifications.push(value),
        onDebug: (value) => events.push(value),
    });
    const rejected = await runtime.refresh();
    assert.equal(rejected.reason, 'enumerate-failed');
    assert.equal(rejected.error, failure);
    assert.equal(notifications.length, 0);
    assert.equal(events.at(-1).errorType, 'NotAllowedError');
    failing = false;
    const current = await runtime.refresh();
    assert.equal(current.ok, true);
    assert.equal(notifications.length, 1);
    assert.equal(current.devices.mic[0].deviceId, 'mic-a');
});
