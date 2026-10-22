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

for (const completion of ['rejection', 'timeout']) {
    test(`a processing resume ${completion} cannot downgrade a context that has already recovered`, async () => {
        const failures = [];
        let reject;
        const context = {
            state: 'suspended',
            resume: () => new Promise((_, fail) => { reject = fail; }),
        };
        const state = { context };
        const f = fixture({
            getProcessingState: () => state,
            onProcessingFailure: value => failures.push(value),
        });
        f.runtime.recover();
        assert.equal(f.timers.size, 1);
        // A separate settings/gesture path has resumed this same branch.
        context.state = 'running';
        if (completion === 'rejection') reject(new Error('obsolete resume failed'));
        else [...f.timers.values()][0].callback();
        await flush();
        assert.deepEqual(failures, []);
        assert.equal(f.timers.size, 0);

        // A later, current failure must still receive the normal fallback.
        context.state = 'suspended';
        context.resume = () => Promise.reject(new Error('current resume failed'));
        f.runtime.recover();
        await flush();
        assert.deepEqual(failures, [state]);
        assert.equal(f.timers.size, 0);
        f.runtime.dispose();
    });
}

test('disposing recovery clears its pending processing timeout before resume settles', async () => {
    let reject;
    const failures = [];
    const state = { context: {
        state: 'suspended',
        resume: () => new Promise((_, fail) => { reject = fail; }),
    } };
    const f = fixture({
        getProcessingState: () => state,
        onProcessingFailure: value => failures.push(value),
    });
    f.runtime.start(); f.runtime.recover();
    assert.equal(f.timers.size, 2, 'polling and processing deadlines are both pending');
    f.runtime.dispose();
    assert.equal(f.timers.size, 0, 'all recovery timers belong to the disposed runtime');
    reject(new Error('late resume rejection after disposal'));
    await flush();
    assert.deepEqual(failures, []);
    assert.equal(f.runtime.recover(), false);
    assert.equal(f.timers.size, 0);
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

test('queued recovery for an old connection cannot rebuild its fresh replacement', async () => {
    const recovered = [];
    let connection = { connectionState: 'failed' };
    const f = fixture({
        getPeerStates: () => [{ peerId: 'a', connection }],
        onPeerRecovery: (id) => recovered.push(id),
    });
    f.runtime.recover();
    f.advance(1000);
    f.runtime.recover();
    connection = { connectionState: 'new' };
    f.runtime.recover();
    await flush();
    assert.equal(recovered.length, 0);
    f.advance(12000);
    f.runtime.recover();
    await flush();
    assert.deepEqual(recovered, ['a']);
    f.runtime.dispose();
});

test('queued peer recovery rechecks current media and connection state before acting', async () => {
    await Promise.all(
        ['connected', 'no-media', 'replaced', 'departed'].map(
            async (change) => {
                const recovered = [];
                const connection = { connectionState: 'failed' };
                let states = [{ peerId: 'a', connection }];
                const f = fixture({
                    getPeerStates: () => states,
                    onPeerRecovery: (id) => recovered.push(id),
                });
                f.runtime.recover();
                f.advance(1000);
                f.runtime.recover();
                if (change === 'connected')
                    connection.connectionState = 'connected';
                if (change === 'no-media') states[0].hasMedia = false;
                if (change === 'replaced')
                    states[0].connection = { connectionState: 'new' };
                if (change === 'departed') states = [];
                await flush();
                assert.equal(recovered.length, 0, change);
                f.runtime.dispose();
            }
        )
    );
});

test('connection replacements retain the recovery budget rather than restarting endless retries', async () => {
    let connection = { connectionState: 'failed' };
    const recovered = [],
        failures = [];
    const f = fixture({
        getPeerStates: () => [{ peerId: 'a', connection }],
        onPeerRecovery: (id) => {
            recovered.push(id);
            connection = { connectionState: 'failed' };
        },
        onPeerFailure: (failed) => failures.push(failed),
    });
    f.runtime.recover();
    for (let n = 0; n < 8; n++) {
        f.advance(10000);
        f.runtime.recover();
        // Each poll observes the replacement made by the previous attempt.
        // eslint-disable-next-line no-await-in-loop
        await flush();
    }
    assert.deepEqual(recovered, ['a', 'a', 'a']);
    assert.deepEqual(failures, [true]);
    f.runtime.dispose();
});

test('a failed resume of an old processing branch cannot replace a newer branch sharing its context', async () => {
    let reject;
    const context = {
        state: 'suspended',
        resume: () =>
            new Promise((_, fail) => {
                reject = fail;
            }),
    };
    const old = { context, stream: {} };
    let state = old;
    const failures = [];
    const f = fixture({
        getProcessingState: () => state,
        onProcessingFailure: (value) => failures.push(value),
    });
    f.runtime.recover();
    state = { context, stream: old.stream };
    reject(new Error('previous branch resume failed'));
    await flush();
    assert.equal(failures.length, 0);
    assert.equal(f.timers.size, 0);
    f.runtime.dispose();
});

test('the app reports stable processing branch ownership even when context and output are reused', () => {
    const source = readFileSync(
        new URL('../src/views/script.js', import.meta.url),
        'utf8'
    );
    const begin = source.indexOf(
        '    getProcessingState: () => {',
        source.indexOf('const audioRecoveryRuntime =')
    );
    const end = source.indexOf('    getPeerStates:', begin);
    assert.ok(begin >= 0 && end > begin);
    const body = source
        .slice(begin, end)
        .trim()
        .replace(/^getProcessingState:\s*/, '')
        .replace(/,$/, '');
    const stream = {},
        context = {},
        pipelines = new WeakMap();
    const previous = { context, stream };
    pipelines.set(stream, previous);
    const read = vm.runInNewContext(`(${body})`, {
        audioPipelines: pipelines,
        activeAudioPipelineStream: stream,
    });
    assert.equal(read(), previous);
    assert.equal(read(), previous);
    const current = { context, stream };
    pipelines.set(stream, current);
    assert.equal(read(), current);
    assert.notEqual(read(), previous);
});

for (const change of ['cleared', 'empty', 'ended']) {
    test(`${change} media clears playback blockage while its player remains present`, async () => {
        const blocked = [];
        const tracks = [{ readyState: 'live' }];
        const media = { getTracks: () => tracks };
        let plays = 0, allow = false;
        const element = {
            srcObject: media, paused: true,
            play() {
                plays++;
                if (!allow) return Promise.reject(Object.assign(new Error('gesture'), { name: 'NotAllowedError' }));
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
        assert.deepEqual(blocked, [true]);

        if (change === 'cleared') element.srcObject = null;
        if (change === 'empty') tracks.length = 0;
        if (change === 'ended') tracks[0].readyState = 'ended';
        f.runtime.recover();
        assert.deepEqual(blocked, [true, false]);
        assert.equal(plays, 1, 'retired media must not be retried');

        // Reusing a stream object after its tracks retire starts fresh playback.
        tracks.splice(0, tracks.length, { readyState: 'live' });
        element.srcObject = media;
        allow = true;
        f.runtime.recover();
        await flush();
        f.runtime.recover();
        assert.equal(plays, 2);
        assert.equal(element.paused, false);
        assert.deepEqual(blocked, [true, false]);
        f.runtime.dispose();
    });
}

test('retiring one blocked player keeps the recovery hint for another live blocked player', async () => {
    const blocked = [];
    const tracks = [{ readyState: 'live' }];
    let plays = 0;
    const first = {
        srcObject: { getTracks: () => tracks }, paused: true,
        play() {
            plays++;
            return Promise.reject(Object.assign(new Error('gesture'), { name: 'NotAllowedError' }));
        },
    };
    const second = { ...first, srcObject: stream() };
    const f = fixture({
        getMediaElements: () => [first, second],
        onPlaybackBlocked: (value) => blocked.push(value),
    });
    f.runtime.recover();
    await flush();
    f.runtime.recover();
    first.srcObject = null;
    f.runtime.recover();
    assert.ok(blocked.length > 0 && blocked.every(Boolean));
    assert.equal(plays, 2, 'the other blocked player still waits for a gesture');
    second.srcObject = null;
    f.runtime.recover();
    assert.equal(blocked.at(-1), false);
    assert.equal(plays, 2);
    f.runtime.dispose();
});

test('a pending play failure cannot block a new use of the same stream after clearing', async () => {
    let reject;
    let plays = 0;
    const blocked = [];
    const media = stream();
    const element = {
        srcObject: media, paused: true,
        play() {
            plays++;
            if (plays === 1) return new Promise((_, fail) => { reject = fail; });
            this.paused = false;
            return Promise.resolve();
        },
    };
    const f = fixture({
        getMediaElements: () => [element],
        onPlaybackBlocked: (value) => blocked.push(value),
    });
    f.runtime.recover();
    element.srcObject = null;
    f.runtime.recover();
    element.srcObject = media;
    f.runtime.recover();
    reject(Object.assign(new Error('old playback denied'), { name: 'NotAllowedError' }));
    await flush();
    f.runtime.recover();
    assert.equal(plays, 2);
    assert.equal(element.paused, false);
    assert.deepEqual(blocked, []);
    f.runtime.dispose();
});
