import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { StrictStream, StrictTrack } from './helpers/strict_media_peer.mjs';

const window = { setTimeout, clearTimeout };
vm.runInNewContext(
    readFileSync(
        new URL(
            '../src/views/js/voice/voice-audio-processing.js',
            import.meta.url
        ),
        'utf8'
    ),
    { window }
);
const flush = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
};

for (const constraint of ['sampleRate', 'echoCancellation']) {
    test(`cancelling a pending ${constraint} failure prevents further microphone acquisition`, async () => {
        const pending = deferred();
        let captures = 0;
        const runtime = window.VoiceAudioProcessing.createRuntime({
            mediaDevices: {
                getUserMedia: () => {
                    captures += 1;
                    return pending.promise;
                },
            },
        });
        const stage = runtime.stage({
            mode: 'browser',
            deviceId: 'synthetic-mic',
        });
        await flush();
        assert.equal(captures, 1);
        runtime.cancelPending();
        const rejected = assert.rejects(stage, { name: 'AbortError' });
        pending.reject(
            Object.assign(new Error('late format error'), {
                name: 'OverconstrainedError',
                constraint,
            })
        );
        await rejected;
        assert.equal(captures, 1);
    });
}

test('cancelling while constraints are applying releases the raw track without another constraint call', async () => {
    const pending = deferred();
    const track = new StrictTrack('audio', 'synthetic');
    const stream = new StrictStream([track]);
    let applies = 0;
    track.getSettings = () => ({
        echoCancellation: true,
        noiseSuppression: true,
    });
    track.applyConstraints = () => {
        applies += 1;
        return pending.promise;
    };
    const runtime = window.VoiceAudioProcessing.createRuntime({
        mediaDevices: { getUserMedia: async () => stream },
        stopStream: (value) =>
            value.getTracks().forEach((track) => {
                track.readyState = 'ended';
            }),
    });
    const stage = runtime.stage({ mode: 'off' });
    await flush();
    assert.equal(applies, 1);
    runtime.cancelPending();
    const rejected = assert.rejects(stage, { name: 'AbortError' });
    try {
        assert.equal(track.readyState, 'ended', 'cancel must release an acquired raw stream before constraints finish');
    } finally {
        pending.resolve();
        await rejected;
    }
    assert.equal(
        applies,
        1,
        'stale capture must not apply further processing flags'
    );
    assert.equal(track.readyState, 'ended');
});

test('a current format failure still retries with the same device and processing requirements', async () => {
    const requests = [];
    const track = new StrictTrack('audio', 'synthetic-format-fallback');
    track.getSettings = () => ({
        echoCancellation: 'all',
        noiseSuppression: true,
    });
    const stream = new StrictStream([track]);
    const runtime = window.VoiceAudioProcessing.createRuntime({
        mediaDevices: {
            getSupportedConstraints: () => ({
                noiseSuppression: true,
                autoGainControl: true,
            }),
            getUserMedia: async ({ audio }) => {
                requests.push(audio);
                if (requests.length === 1)
                    throw Object.assign(new Error('mono format unavailable'), {
                        name: 'OverconstrainedError',
                        constraint: 'channelCount',
                    });
                return stream;
            },
        },
    });
    assert.equal(
        await runtime.capture({ mode: 'browser', deviceId: 'synthetic-mic' }),
        stream
    );
    assert.equal(requests.length, 2);
    assert.equal(requests[0].channelCount, 1);
    assert.equal(requests[1].channelCount, undefined);
    assert.equal(requests[1].deviceId.exact, 'synthetic-mic');
    assert.equal(requests[1].echoCancellation.exact, 'all');
    assert.equal(requests[1].noiseSuppression.exact, true);
    assert.equal(requests[1].autoGainControl.exact, true);
});
