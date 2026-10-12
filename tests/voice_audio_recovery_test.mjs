import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const window = {};
vm.runInNewContext(
    readFileSync(
        new URL(
            '../src/views/js/voice/voice-audio-recovery.js',
            import.meta.url
        ),
        'utf8'
    ),
    { window }
);
const createRuntime = window.VoiceAudioRecovery.createRuntime;
const flush = () => new Promise((resolve) => setImmediate(resolve));
const stream = () => ({ getTracks: () => [{ readyState: 'live' }] });
const fixture = (options = {}) => {
    let time = 0;
    let id = 0;
    const timers = new Map();
    const runtime = createRuntime({
        now: () => time,
        setTimer: (callback, delay) => {
            timers.set(++id, { callback, at: time + delay });
            return id;
        },
        clearTimer: (key) => timers.delete(key),
        ...options,
    });
    return {
        runtime,
        timers,
        advance(ms) {
            time += ms;
        },
    };
};

test('paused replacement playback recovers automatically; permission denial offers a gesture retry', async () => {
    const blocked = [];
    let plays = 0;
    let allow = false;
    const element = {
        srcObject: stream(),
        paused: true,
        play() {
            plays++;
            if (!allow)
                return Promise.reject(
                    Object.assign(new Error('gesture'), {
                        name: 'NotAllowedError',
                    })
                );
            this.paused = false;
            return Promise.resolve();
        },
    };
    const f = fixture({
        getMediaElements: () => [element],
        onPlaybackBlocked: (value) => blocked.push(value),
    });
    f.runtime.recover();
    await flush();
    f.runtime.recover();
    assert.equal(plays, 1, 'blocked autoplay must not be retried forever');
    assert.deepEqual(blocked, [true]);
    allow = true;
    f.runtime.recover({ userGesture: true });
    assert.equal(
        plays,
        2,
        'play must be invoked before returning from the recovery click'
    );
    await flush();
    f.runtime.recover();
    assert.deepEqual(blocked, [true, false]);
    element.srcObject = stream();
    element.paused = true;
    f.runtime.recover();
    await flush();
    assert.equal(plays, 3);
    assert.equal(element.paused, false);
    f.runtime.dispose();
});

test('a suspended processing context resumes or falls back on timeout, with stale pipelines ignored', async () => {
    const failed = [];
    const context = {
        state: 'suspended',
        resume() {
            this.state = 'running';
            return Promise.resolve();
        },
    };
    let state = { context };
    const f = fixture({
        getProcessingState: () => state,
        onProcessingFailure: (value) => failed.push(value),
    });
    f.runtime.recover();
    await flush();
    assert.equal(context.state, 'running');
    assert.equal(failed.length, 0);
    context.state = 'suspended';
    context.resume = () => new Promise(() => {});
    f.runtime.recover();
    f.runtime.recover();
    assert.equal(f.timers.size, 1, 'one bounded resume per context');
    [...f.timers.values()][0].callback();
    await flush();
    assert.equal(failed.length, 1);
    f.runtime.recover();
    state = { context: { state: 'running' } };
    [...f.timers.values()][0].callback();
    await flush();
    assert.equal(
        failed.length,
        1,
        'an old failed context cannot replace a newer pipeline'
    );
    f.runtime.dispose();
});

test('failed DTLS despite connected ICE rebuilds only the affected peer, bounded to three attempts', async () => {
    const recovered = [];
    const failures = [];
    const failed = {
        connectionState: 'failed',
        iceConnectionState: 'connected',
    };
    const healthy = { connectionState: 'connected' };
    const states = [
        { peerId: 'bad', connection: failed },
        { peerId: 'good', connection: healthy },
        { peerId: 'muted-without-media', hasMedia: false },
    ];
    const f = fixture({
        getPeerStates: () => states,
        onPeerRecovery: (id) => recovered.push(id),
        onPeerFailure: (value) => failures.push(value),
    });
    f.runtime.recover();
    assert.equal(recovered.length, 0);
    f.advance(1000);
    f.runtime.recover();
    await flush();
    f.advance(3000);
    f.runtime.recover();
    await flush();
    f.advance(6000);
    f.runtime.recover();
    await flush();
    f.advance(12000);
    f.runtime.recover();
    await flush();
    assert.deepEqual(recovered, ['bad', 'bad', 'bad']);
    assert.deepEqual(failures, [true]);
    states[0].connection = healthy;
    f.runtime.recover();
    assert.deepEqual(failures, [true, false]);
    assert.equal(recovered.length, 3);
    f.runtime.dispose();
});

test('new or transiently disconnected connections get grace time, and disposal cancels queued recovery', async () => {
    const recovered = [];
    const connection = { connectionState: 'new' };
    const f = fixture({
        getPeerStates: () => [{ peerId: 'a', connection }],
        onPeerRecovery: (id) => recovered.push(id),
    });
    f.runtime.start();
    f.runtime.recover();
    f.advance(11000);
    f.runtime.recover();
    await flush();
    assert.equal(recovered.length, 0);
    f.advance(1000);
    f.runtime.recover();
    f.runtime.dispose();
    await flush();
    assert.equal(recovered.length, 0);
    assert.equal(f.timers.size, 0);
    assert.equal(f.runtime.recover(), false);
});
