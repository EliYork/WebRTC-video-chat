import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { StrictStream, StrictTrack } from './helpers/strict_media_peer.mjs';

const script = readFileSync(
    new URL('../src/views/script.js', import.meta.url),
    'utf8'
);
const operationSource = readFileSync(
    new URL(
        '../src/views/js/voice/voice-media-operation-runtime.js',
        import.meta.url
    ),
    'utf8'
);
const slice = (from, to) =>
    script.slice(script.indexOf(from), script.indexOf(to));
const flush = () => new Promise((resolve) => setImmediate(resolve));
const stream = (id) => {
    const track = new StrictTrack('video', id);
    track.stopCount = 0;
    return new StrictStream([track]);
};
const fixture = () => {
    const requests = [],
        stopped = new WeakSet(),
        selections = [];
    const stop = (track) => {
        if (stopped.has(track)) return;
        stopped.add(track);
        track.stopCount += 1;
        track.readyState = 'ended';
    };
    const stopStream = (value) => value?.getTracks().forEach(stop);
    const window = {};
    vm.runInNewContext(operationSource, { window, Promise });
    const controller =
        window.VoiceMediaOperationRuntime.createMediaOperationController({
            stopStream,
        });
    controller.setDesired('camera', true);
    let publications = 0;
    const context = vm.createContext({
        cameraSelectionRevision: 0,
        selectedCameraDeviceId: 'a',
        committedCameraDeviceId: 'default',
        cameraStream: undefined,
        mediaDevicesCache: {},
        selectedInputDeviceId: 'default',
        selectedOutputDeviceId: 'default',
        currentPeer: {},
        sharingNow: true,
        mediaOperationController: controller,
        voiceSessionRuntime: {
            getSnapshot: () => ({ epoch: 0, desiredVoiceState: 'joined' }),
            isCurrent: (epoch) => epoch === 0,
        },
        pageVoiceTeardown: { isComplete: () => false },
        voiceDeviceRuntime: { setSelected: (_type, id) => selections.push(id) },
        navigator: {
            mediaDevices: {
                getUserMedia: (constraints) =>
                    new Promise((resolve, reject) => {
                        requests.push({ constraints, resolve, reject });
                    }),
            },
        },
        notifyMediaDock: () => {},
        setMediaOperationError: () => {},
        setCameraButtonState: () => {},
        localMediaTrackStopper: { stopStream },
        stopLocalTrack: (_type, track) => stop(track),
        bindLocalTrackEnded: () => {},
        localTrackEndedController: {
            releaseRecovery: () => {},
            claimRecovery: () => true,
        },
        emitLocalPresenceUpdate: () => {},
        updateLocalUserCard: () => {},
        setActiveVideoTrack: () => {
            publications += 1;
        },
        voiceMediaDebug: { record: () => {} },
        destroyProcessedAudioStream: () => {},
        stopCurrentScreenStream: () => {},
        myVideoStream: undefined,
        setScreenShareRequestPending: () => {},
        setAudioButtonNoMic: () => {},
        stopCallTimer: () => {},
    });
    context.localTrackEndedController.clear = () => {};
    const api = vm.runInContext(
        [
            slice('const getCameraConstraints =', 'const CURSOR_THROTTLE_MS ='),
            slice(
                'const hasLiveCameraTrack =',
                'const getLocalPresenceState ='
            ),
            slice('const startCamera =', 'const toggleCamera ='),
            slice('const toggleCamera =', 'const unbindScreenTrackEnded ='),
            slice('const selectCameraDevice =', 'const selectOutputDevice ='),
            slice('const resetLocalVoiceState =', 'const pageVoiceTeardown ='),
            slice(
                'async function handleUnexpectedLocalTrackEnded(',
                'async function handleMissingMediaDevice('
            ),
            slice(
                'async function handleMissingMediaDevice(',
                'const peerLifecycleMetadata ='
            ),
            `const publishDevices = ${slice('    onDevices: ', '    onMissing:')
                .trim()
                .replace(/^onDevices:\s*/, '')
                .replace(/,$/, '')};`,
            '({ startCamera, toggleCamera, selectCameraDevice, publishDevices, handleUnexpectedLocalTrackEnded, handleMissingMediaDevice, resetLocalVoiceState })',
        ].join('\n'),
        context
    );
    return {
        api,
        context,
        controller,
        requests,
        selections,
        get publications() {
            return publications;
        },
    };
};
const start = async (f) => {
    const pending = f.api.startCamera(f.context.currentPeer);
    await flush();
    const active = stream('a');
    f.requests[0].resolve(active);
    assert.equal(await pending, true);
    return active;
};

test('a failed rapid camera selection restores the active device instead of a superseded request', async () => {
    const f = fixture();
    const active = await start(f);
    const b = f.api.selectCameraDevice('b');
    await flush();
    f.api.publishDevices({
        devices: { camera: [], mic: [], output: [] },
        selected: { camera: 'b', mic: 'default', output: 'default' },
    });
    const c = f.api.selectCameraDevice('c');
    await flush();
    assert.equal(f.requests[1].constraints.video.deviceId.exact, 'b');
    assert.equal(f.requests[2].constraints.video.deviceId.exact, 'c');
    f.requests[2].reject(
        Object.assign(new Error('camera c unavailable'), {
            name: 'NotReadableError',
        })
    );
    await c;
    assert.equal(f.context.selectedCameraDeviceId, 'a');
    assert.equal(f.selections.at(-1), 'a');
    assert.equal(f.context.cameraStream, active);
    assert.equal(active.getVideoTracks()[0].stopCount, 0);

    const stale = stream('b');
    f.requests[1].resolve(stale);
    await b;
    assert.equal(stale.getVideoTracks()[0].stopCount, 1);
    assert.equal(f.context.cameraStream, active);
    assert.equal(f.context.selectedCameraDeviceId, 'a');
    assert.equal(
        f.publications,
        0,
        'camera selection does not replace the active screen share'
    );
});

test('a camera choice cancelled before capture starts is never used as the rollback device', async () => {
    const f = fixture();
    const active = await start(f);
    const b = f.api.selectCameraDevice('b');
    const c = f.api.selectCameraDevice('c');
    await flush();
    assert.equal(f.requests.length, 2);
    assert.equal(f.requests[1].constraints.video.deviceId.exact, 'c');
    f.requests[1].reject(new Error('camera c failed'));
    await Promise.all([b, c]);
    assert.equal(f.context.selectedCameraDeviceId, 'a');
    assert.equal(f.context.cameraStream, active);
    assert.equal(active.getVideoTracks()[0].stopCount, 0);
});

test('a newly adopted camera becomes the rollback target for the following failed selection', async () => {
    const f = fixture();
    const old = await start(f);
    const b = f.api.selectCameraDevice('b');
    await flush();
    const active = stream('b');
    f.requests[1].resolve(active);
    await b;
    const c = f.api.selectCameraDevice('c');
    await flush();
    f.requests[2].reject(new Error('camera c failed'));
    await c;
    assert.equal(f.context.selectedCameraDeviceId, 'b');
    assert.equal(f.context.cameraStream, active);
    assert.equal(old.getVideoTracks()[0].stopCount, 1);
    assert.equal(active.getVideoTracks()[0].stopCount, 0);
});

test('camera capture constraints belong to the request even if selection changes before its microtask', async () => {
    const f = fixture();
    const pending = f.api.startCamera(f.context.currentPeer);
    f.api.publishDevices({
        devices: { camera: [], mic: [], output: [] },
        selected: { camera: 'other', mic: 'default', output: 'default' },
    });
    await flush();
    assert.equal(f.requests[0].constraints.video.deviceId.exact, 'a');
    f.requests[0].resolve(stream('a'));
    assert.equal(await pending, true);
    assert.equal(f.context.committedCameraDeviceId, 'a');
    assert.equal(f.context.selectedCameraDeviceId, 'a');
    assert.equal(f.selections.at(-1), 'a');
});

test('camera selection while disabled establishes the preference used for a later failed enable', async () => {
    const f = fixture();
    f.controller.setDesired('camera', false);
    await f.api.selectCameraDevice('b');
    assert.equal(f.requests.length, 0);
    f.controller.setDesired('camera', true);
    const c = f.api.selectCameraDevice('c');
    await flush();
    f.requests[0].reject(new Error('camera c failed'));
    await c;
    assert.equal(f.context.selectedCameraDeviceId, 'b');
    assert.equal(f.context.cameraStream, undefined);
});

test('a device-list fallback while camera is disabled replaces the obsolete rollback preference', async () => {
    const f = fixture();
    f.controller.setDesired('camera', false);
    await f.api.selectCameraDevice('b');
    f.api.publishDevices({
        devices: { camera: [], mic: [], output: [] },
        selected: { camera: 'default', mic: 'default', output: 'default' },
    });
    f.controller.setDesired('camera', true);
    const c = f.api.selectCameraDevice('c');
    await flush();
    f.requests[0].reject(new Error('camera c failed'));
    await c;
    assert.equal(f.context.selectedCameraDeviceId, 'default');
    assert.equal(f.context.committedCameraDeviceId, 'default');
});

test('an ended old camera cannot clear the newer camera selected while recovery was waiting', async () => {
    const f = fixture();
    const old = await start(f);
    f.context.sharingNow = false;
    const selection = f.api.selectCameraDevice('b');
    await flush();
    const ended = old.getVideoTracks()[0];
    ended.end();
    const recovery = f.api.handleUnexpectedLocalTrackEnded('camera', ended, 0);
    const active = stream('b');
    f.requests[1].resolve(active);
    await Promise.all([selection, recovery]);
    assert.equal(
        f.requests.length,
        2,
        'recovery shares the existing camera request'
    );
    assert.equal(f.context.cameraStream, active);
    assert.equal(f.context.selectedCameraDeviceId, 'b');
    assert.equal(active.getVideoTracks()[0].stopCount, 0);
    assert.equal(
        f.publications,
        1,
        'late recovery must not remove the new video track'
    );
});

test('failed camera recovery still clears its own ended stream and retains default preference', async () => {
    const f = fixture();
    const old = await start(f);
    f.context.sharingNow = false;
    const ended = old.getVideoTracks()[0];
    ended.end();
    const recovery = f.api.handleUnexpectedLocalTrackEnded('camera', ended, 0);
    await flush();
    f.requests[1].reject(new Error('default camera unavailable'));
    assert.equal(await recovery, false);
    assert.equal(f.context.cameraStream, undefined);
    assert.equal(f.context.selectedCameraDeviceId, 'default');
    assert.equal(f.context.committedCameraDeviceId, 'default');
    assert.equal(f.publications, 1);
});

test('a cancelled camera recovery cannot remove video while a newer selection is still pending', async () => {
    const f = fixture();
    const old = await start(f);
    f.context.sharingNow = false;
    const ended = old.getVideoTracks()[0];
    ended.end();
    const recovery = f.api.handleUnexpectedLocalTrackEnded('camera', ended, 0);
    await flush();
    const selection = f.api.selectCameraDevice('c');
    await flush();
    f.requests[1].reject(new Error('late default camera failure'));
    assert.equal(await recovery, false);
    assert.equal(f.context.cameraStream, old);
    assert.ok(f.controller.getSnapshot('camera').promise);
    assert.equal(f.publications, 0);
    const active = stream('c');
    f.requests[2].resolve(active);
    await selection;
    assert.equal(f.context.cameraStream, active);
    assert.equal(f.context.selectedCameraDeviceId, 'c');
    assert.equal(active.getVideoTracks()[0].stopCount, 0);
    assert.equal(f.publications, 1);
});

test('turning camera off during a device switch stops the old capture and every late replacement', async () => {
    await Promise.all(
        [false, true].map(async (sharing) => {
            const f = fixture();
            const active = await start(f);
            f.context.sharingNow = sharing;
            const selection = f.api.selectCameraDevice('b');
            await flush();
            await f.api.toggleCamera(f.context.currentPeer);
            assert.equal(active.getVideoTracks()[0].readyState, 'ended');
            assert.equal(active.getVideoTracks()[0].stopCount, 1);
            assert.equal(f.context.cameraStream, undefined);
            assert.equal(f.controller.getSnapshot('camera').desired, false);
            assert.equal(f.context.selectedCameraDeviceId, 'a');
            assert.equal(f.publications, sharing ? 0 : 1);
            const late = stream('b');
            f.requests[1].resolve(late);
            await selection;
            assert.equal(late.getVideoTracks()[0].stopCount, 1);
            assert.equal(f.context.cameraStream, undefined);
            assert.equal(f.controller.getSnapshot('camera').desired, false);
            assert.equal(f.publications, sharing ? 0 : 1);
        })
    );
});

test('cancelling first camera permission rejects the late capture without reopening video', async () => {
    const f = fixture();
    const opening = f.api.toggleCamera(f.context.currentPeer);
    await flush();
    await f.api.toggleCamera(f.context.currentPeer);
    assert.equal(f.context.cameraStream, undefined);
    assert.equal(f.controller.getSnapshot('camera').desired, false);
    const late = stream('late-first-capture');
    f.requests[0].resolve(late);
    await opening;
    assert.equal(late.getVideoTracks()[0].stopCount, 1);
    assert.equal(f.context.cameraStream, undefined);
});

test('leaving during a camera switch restores the adopted preference before the next session captures', async () => {
    await Promise.all(
        [false, true].map(async (lateFailure) => {
            const f = fixture();
            const original = await start(f);
            const oldSelection = f.api.selectCameraDevice('b');
            await flush();
            // The leave path invalidates capture before resetting local media.
            f.controller.setDesired('camera', false);
            f.controller.invalidate('camera');
            f.api.resetLocalVoiceState();
            assert.equal(original.getVideoTracks()[0].readyState, 'ended');
            assert.equal(f.context.selectedCameraDeviceId, 'a');
            assert.equal(f.selections.at(-1), 'a');

            // A fresh enumeration can change the disabled-session preference.
            f.api.publishDevices({
                devices: { camera: [], mic: [], output: [] },
                selected: {
                    camera: 'new-default',
                    mic: 'default',
                    output: 'default',
                },
            });
            f.controller.setDesired('camera', true);
            const nextCapture = f.api.startCamera(f.context.currentPeer);
            await flush();
            const active = stream('new-default');
            f.requests[2].resolve(active);
            assert.equal(await nextCapture, true);
            if (lateFailure)
                f.requests[1].reject(
                    new Error('previous session device failure')
                );
            else f.requests[1].resolve(stream('late-b'));
            await oldSelection;
            assert.equal(f.context.selectedCameraDeviceId, 'new-default');
            assert.equal(f.context.committedCameraDeviceId, 'new-default');
            assert.equal(f.selections.at(-1), 'new-default');
            assert.equal(f.context.cameraStream, active);
            assert.equal(active.getVideoTracks()[0].stopCount, 0);
        })
    );
});

test('camera disappearance replaces an in-flight device switch with an actual default capture', async () => {
    await Promise.all(
        [false, true].map(async (lateFailure) => {
            const f = fixture();
            const original = await start(f);
            const switching = f.api.selectCameraDevice('b');
            await flush();
            const fallback = f.api.handleMissingMediaDevice('camera');
            await flush();
            assert.equal(
                f.requests.length,
                3,
                'removed-device capture must not be shared with default recovery'
            );
            assert.equal(f.requests[2].constraints.video, true);
            assert.equal(original.getVideoTracks()[0].stopCount, 0);
            const active = stream('default');
            f.requests[2].resolve(active);
            assert.equal(await fallback, true);
            const late = stream('removed-b');
            if (lateFailure)
                f.requests[1].reject(new Error('removed camera failed'));
            else f.requests[1].resolve(late);
            await switching;
            assert.equal(f.context.cameraStream, active);
            assert.equal(f.context.selectedCameraDeviceId, 'default');
            assert.equal(f.context.committedCameraDeviceId, 'default');
            assert.equal(f.selections.at(-1), 'default');
            assert.equal(original.getVideoTracks()[0].stopCount, 1);
            assert.equal(active.getVideoTracks()[0].stopCount, 0);
            if (!lateFailure)
                assert.equal(late.getVideoTracks()[0].stopCount, 1);
            assert.equal(
                f.publications,
                0,
                'camera fallback must preserve an active screen share'
            );
        })
    );
});

test('camera fallback cancels a removed device before its capture microtask starts', async () => {
    const f = fixture();
    await start(f);
    const switching = f.api.selectCameraDevice('b');
    const fallback = f.api.handleMissingMediaDevice('camera');
    await flush();
    assert.equal(f.requests.length, 2);
    assert.equal(f.requests[1].constraints.video, true);
    const active = stream('default');
    f.requests[1].resolve(active);
    assert.equal(await fallback, true);
    await switching;
    assert.equal(f.context.selectedCameraDeviceId, 'default');
    assert.equal(f.context.cameraStream, active);
});

test('a later manual camera selection supersedes default recovery after device removal', async () => {
    const f = fixture();
    await start(f);
    const fallback = f.api.handleMissingMediaDevice('camera');
    await flush();
    const selection = f.api.selectCameraDevice('c');
    await flush();
    const active = stream('c');
    f.requests[2].resolve(active);
    await selection;
    const late = stream('late-default');
    f.requests[1].resolve(late);
    assert.equal(await fallback, false);
    assert.equal(f.context.selectedCameraDeviceId, 'c');
    assert.equal(f.context.cameraStream, active);
    assert.equal(active.getVideoTracks()[0].stopCount, 0);
    assert.equal(late.getVideoTracks()[0].stopCount, 1);
});
