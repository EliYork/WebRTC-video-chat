import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const window = {};
for (const path of [
    '../src/views/js/voice/voice-audio-settings-controller.js',
    '../src/views/js/media/audio-processing-view.js',
]) {
    vm.runInNewContext(readFileSync(new URL(path, import.meta.url), 'utf8'), {
        window,
    });
}
const { createController } = window.VoiceAudioSettingsController;
const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, reject, resolve };
};
const describe = (controller) => {
    const state = controller.snapshot();
    return window.VoiceAudioProcessingView.describe({
        audioProcessing: { mode: state.committed.mode, sourceLive: true },
        requestedNoiseMode: state.requested.mode,
        audioSettingsPending: state.pending,
        audioSettingsError: state.error,
    });
};

test('a superseded settings rejection cannot taint a pending or successful newer switch', async () => {
    const old = deferred();
    const current = deferred();
    const changes = [];
    const commits = [];
    const controller = createController({
        initial: { mode: 'browser', deviceId: 'a' },
        apply: ({ deviceId }) =>
            deviceId === 'old' ? old.promise : current.promise,
        onChange: (state) => changes.push(state),
        onCommitted: (config) => commits.push({ ...config }),
    });
    const obsolete = controller.select({ mode: 'rnnoise', deviceId: 'old' });
    const fresh = controller.select({ mode: 'off', deviceId: 'current' });
    const notificationCount = changes.length;
    old.reject(
        Object.assign(new Error('old capture failed'), {
            name: 'OldDeviceError',
        })
    );
    assert.equal(await obsolete, false);
    assert.equal(controller.snapshot().pending, true);
    assert.equal(controller.snapshot().error, null);
    assert.equal(changes.length, notificationCount);
    assert.match(describe(controller), /切换中/);
    assert.doesNotMatch(describe(controller), /切换失败/);

    current.resolve(true);
    assert.equal(await fresh, true);
    assert.equal(controller.snapshot().error, null);
    assert.equal(controller.snapshot().pending, false);
    assert.equal(changes.at(-1).error, null);
    assert.deepEqual(commits, [{ mode: 'off', deviceId: 'current' }]);
    assert.doesNotMatch(describe(controller), /切换失败|切换中/);
});

test('late settings exceptions preserve an already completed newer success or failure', async () => {
    await Promise.all(
        [false, true].map(async (succeeds) => {
            const old = deferred();
            const controller = createController({
                initial: { mode: 'browser', deviceId: 'a' },
                apply: ({ deviceId }) => {
                    if (deviceId === 'old') return old.promise;
                    if (succeeds) return true;
                    throw Object.assign(new Error('current capture failed'), {
                        name: 'CurrentDeviceError',
                    });
                },
            });
            const obsolete = controller.select({
                mode: 'rnnoise',
                deviceId: 'old',
            });
            assert.equal(
                await controller.select({ mode: 'off', deviceId: 'current' }),
                succeeds
            );
            const settled = controller.snapshot();
            old.reject(
                Object.assign(new Error('old capture failed'), {
                    name: 'OldDeviceError',
                })
            );
            assert.equal(await obsolete, false);
            assert.deepEqual(controller.snapshot(), settled);
            assert.equal(
                controller.snapshot().error,
                succeeds ? null : 'CurrentDeviceError'
            );
        })
    );
});

test('cancelling a settings switch remains error-free after its late exception', async () => {
    const old = deferred();
    const commits = [];
    const requested = [];
    const controller = createController({
        initial: { mode: 'browser', deviceId: 'a' },
        apply: () => old.promise,
        onRequested: (config) => requested.push({ ...config }),
        onCommitted: (config) => commits.push(config),
    });
    const obsolete = controller.select({ mode: 'rnnoise', deviceId: 'old' });
    controller.cancel();
    const cancelled = controller.snapshot();
    old.reject(new Error('late failure after leave'));
    assert.equal(await obsolete, false);
    assert.deepEqual(controller.snapshot(), cancelled);
    assert.equal(controller.snapshot().error, null);
    assert.equal(controller.snapshot().pending, false);
    assert.deepEqual(requested.at(-1), { mode: 'browser', deviceId: 'a' });
    assert.equal(commits.length, 0);
    assert.doesNotMatch(describe(controller), /切换失败|切换中/);
});

test('current settings exceptions still roll back and a later successful retry clears the error', async () => {
    let failing = true;
    const commits = [];
    const controller = createController({
        initial: { mode: 'browser', deviceId: 'a' },
        apply: () => {
            if (failing)
                throw Object.assign(new Error('device busy'), {
                    name: 'NotReadableError',
                });
            return true;
        },
        onCommitted: (config) => commits.push({ ...config }),
    });
    assert.equal(
        await controller.select({ mode: 'rnnoise', deviceId: 'b' }),
        false
    );
    assert.equal(controller.snapshot().error, 'NotReadableError');
    assert.equal(controller.snapshot().requested.deviceId, 'a');
    assert.match(describe(controller), /切换失败/);
    failing = false;
    assert.equal(await controller.select({ mode: 'off', deviceId: 'c' }), true);
    assert.equal(controller.snapshot().error, null);
    assert.deepEqual(commits, [{ mode: 'off', deviceId: 'c' }]);
    assert.doesNotMatch(describe(controller), /切换失败/);
});
