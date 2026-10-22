import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(
    new URL('../src/views/js/voice/voice-channel-sounds.js', import.meta.url),
    'utf8'
);
function api() {
    const window = {};
    vm.runInNewContext(source, { window });
    return window.VoiceChannelSounds;
}
const member = (id, extra = {}) => ({
    socketId: id,
    peerId: `peer-${id}`,
    joinedVoice: true,
    ...extra,
});
const roster = (...members) => ({ channels: [{ slug: 'lobby', members }] });
const own = { localSocketId: 'self', localPeerId: 'peer-self' };

test('membership sounds use canonical room changes, never initial roster, metadata or other rooms', () => {
    const heard = [];
    let time = 0;
    const tracker = api().createTracker({
        notify: (kind) => heard.push(kind),
        now: () => time,
    });
    tracker.observe(roster(member('a')), own);
    assert.equal(heard.length, 0);
    tracker.enter('lobby', roster(member('a'), member('self')), own);
    assert.deepEqual(heard, ['join']);
    assert.equal(tracker.enter('lobby', roster(), own), false);
    tracker.observe(
        roster(
            member('a', { muted: true, peerId: 'rebuilt-peer' }),
            member('self')
        ),
        own
    );
    tracker.observe({ channels: [{ slug: 'other', members: [] }] }, own);
    assert.deepEqual(heard, ['join']);
    tracker.observe(roster(member('a'), member('b'), member('self')), own);
    tracker.observe(roster(member('a'), member('b'), member('self')), own);
    assert.deepEqual(heard, ['join', 'join']);
    time = 600;
    tracker.observe(roster(member('a'), member('self')), own);
    assert.deepEqual(heard, ['join', 'join', 'leave']);
    tracker.leave();
    tracker.leave();
    tracker.observe(roster(member('b')), own);
    assert.deepEqual(heard, ['join', 'join', 'leave', 'leave']);
});

test('local reconnect baselines, initial members, burst updates and stale peer identity do not replay', () => {
    const heard = [];
    let time = 0;
    const tracker = api().createTracker({
        notify: (kind) => heard.push(kind),
        now: () => time,
    });
    tracker.enter('lobby', undefined, own);
    tracker.observe(roster(member('a'), member('self')), own);
    tracker.observe(roster(member('a'), member('b')), own);
    tracker.observe(roster(member('a'), member('b'), member('c')), own);
    assert.deepEqual(heard, ['join', 'join']); // One sound for the burst.
    tracker.rebase();
    tracker.observe(roster(), { ...own, connected: false });
    tracker.observe(roster(member('a'), member('self')), own);
    tracker.enter('lobby', roster(), own);
    assert.equal(heard.length, 2);
    time = 1000;
    tracker.observe(
        roster(
            member('a'),
            member('different-socket', { peerId: own.localPeerId })
        ),
        own
    );
    assert.equal(heard.length, 2);
    tracker.reset();
    tracker.leave();
    assert.equal(heard.length, 2);
});

function audioFixture({ unsupported = false } = {}) {
    let created = 0,
        closes = 0;
    const oscillators = [],
        gains = [],
        routes = [];
    const settings = { enabled: true, volume: 0.35 };
    const output = { volume: 0.5, muted: false, deviceId: 'default' };
    let failSink = false;
    const context = {
        state: 'running',
        currentTime: 0,
        destination: {},
        resume: async () => {},
        close: async () => {
            closes++;
        },
        createGain: () => {
            const events = [];
            const gain = {
                value: 0,
                setValueAtTime: (...args) => events.push(['start', ...args]),
                linearRampToValueAtTime: (...args) =>
                    events.push(['attack', ...args]),
                exponentialRampToValueAtTime: (...args) =>
                    events.push(['decay', ...args]),
            };
            const node = { gain, events, connect() {}, disconnect() {} };
            gains.push(node);
            return node;
        },
        createOscillator: () => {
            const node = {
                frequency: {},
                connect() {},
                disconnect() {},
                start: (time) => {
                    node.started = time;
                },
                stop: (time) => {
                    node.stopped = time;
                },
            };
            oscillators.push(node);
            return node;
        },
        ...(!unsupported && {
            setSinkId: async (id) => {
                routes.push(id);
                if (failSink) throw Error('sink missing');
            },
        }),
    };
    const player = api().createTonePlayer({
        getSettings: () => settings,
        getOutput: () => output,
        createContext: () => {
            created++;
            return context;
        },
    });
    return {
        player,
        context,
        output,
        settings,
        oscillators,
        gains,
        routes,
        get created() {
            return created;
        },
        get closes() {
            return closes;
        },
        failSink: () => {
            failSink = true;
        },
    };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

for (const nextDevice of ['second-headset', 'default']) {
    test(`changing pending notification output to ${nextDevice} discards the earlier membership tone`, async () => {
        const f = audioFixture();
        await f.player.unlock();
        let finish;
        f.context.setSinkId = async (id) => {
            f.routes.push(id);
            if (id === 'first-headset') await new Promise(resolve => { finish = resolve; });
        };
        f.output.deviceId = 'first-headset';
        const firstRoute = f.player.syncOutput();
        await flush();
        const obsoleteTone = f.player.play('join');
        f.output.deviceId = nextDevice;
        const currentRoute = f.player.syncOutput();
        finish();
        const [, played, routed] = await Promise.all([firstRoute, obsoleteTone, currentRoute]);
        assert.equal(routed, true);
        assert.equal(played, false);
        assert.equal(f.oscillators.length, 0, 'the old event must not be replayed on the new output');
        assert.deepEqual(f.routes, ['first-headset', nextDevice]);
        assert.equal(await f.player.play('leave'), true);
        assert.deepEqual(f.oscillators.map(node => node.frequency.value), [587.33, 523.251]);
        f.player.destroy();
    });
}

test('an obsolete completed output route leaves notification gain silent until the selected route is ready', async () => {
    const f = audioFixture();
    await f.player.unlock();
    let finishFirst, finishSecond;
    f.context.setSinkId = id => new Promise(resolve => {
        if (id === 'first-headset') finishFirst = resolve;
        else finishSecond = resolve;
    });
    f.output.deviceId = 'first-headset';
    const first = f.player.syncOutput();
    await flush();
    const completion = first.then(result => ({ result, gain: f.gains[0].gain.value }));
    f.output.deviceId = 'second-headset';
    const second = f.player.syncOutput();
    finishFirst();
    await flush();
    const obsolete = await completion;
    finishSecond();
    assert.equal(await second, true);
    assert.equal(obsolete.result, false);
    assert.equal(obsolete.gain, 0);
    assert.equal(f.gains[0].gain.value, 0.175);
    f.player.destroy();
});

test('repeated synchronization of the same pending output keeps the latest membership event', async () => {
    const f = audioFixture();
    await f.player.unlock();
    let finish;
    f.context.setSinkId = async id => {
        f.routes.push(id);
        await new Promise(resolve => { finish = resolve; });
    };
    f.output.deviceId = 'headset';
    const first = f.player.syncOutput();
    await flush();
    const tone = f.player.play('join');
    const repeated = f.player.syncOutput();
    finish();
    const [routed, played] = await Promise.all([first, tone, repeated]);
    assert.equal(routed, true);
    assert.equal(played, true);
    assert.deepEqual(f.routes, ['headset']);
    assert.equal(f.oscillators.length, 2);
    f.player.destroy();
});

test('two soft notes ascend on join, descend on leave with attack/decay and no microphone connection', async () => {
    const f = audioFixture();
    assert.equal(await f.player.play('join'), false);
    assert.equal(f.created, 0);
    await f.player.unlock();
    assert.equal(await f.player.play('join'), true);
    assert.deepEqual(
        f.oscillators.map((x) => x.frequency.value),
        [523.251, 587.33]
    );
    assert.equal(f.gains[0].gain.value, 0.175); // Notification volume × master volume.
    assert.equal(f.gains[1].events[1][0], 'attack');
    assert.equal(f.gains[1].events[2][0], 'decay');
    assert.ok(f.oscillators[1].stopped < 0.3);
    assert.equal(await f.player.play('leave'), true);
    assert.deepEqual(
        f.oscillators.slice(2).map((x) => x.frequency.value),
        [587.33, 523.251]
    );
    f.player.destroy();
    f.player.destroy();
    assert.equal(f.closes, 1);
    assert.equal(await f.player.play('join'), false);
});

test('notification switch, master mute and zero volume cancel tones without queued playback', async () => {
    const f = audioFixture();
    f.settings.enabled = false;
    assert.equal(await f.player.unlock(), false);
    assert.equal(f.created, 0);
    f.settings.enabled = true;
    await f.player.unlock();
    await f.player.play('join');
    f.output.muted = true;
    await f.player.syncOutput();
    assert.equal(f.gains[0].gain.value, 0);
    assert.equal(f.oscillators[0].stopped, undefined); // Stopped immediately.
    assert.equal(await f.player.play('leave'), false);
    f.output.muted = false;
    f.settings.volume = 0;
    assert.equal(await f.player.play('join'), false);
    f.settings.volume = 0.35;
    f.output.volume = 0;
    assert.equal(await f.player.play('join'), false);
    f.player.destroy();
});

test('selected headset is respected; failures and unsupported custom sinks stay silent', async () => {
    const f = audioFixture();
    await f.player.unlock();
    f.output.deviceId = 'headset';
    assert.equal(await f.player.play('join'), true);
    assert.deepEqual(f.routes, ['headset']);
    f.failSink();
    f.output.deviceId = 'removed';
    assert.equal(await f.player.play('join'), false);
    assert.equal(f.gains[0].gain.value, 0);
    assert.equal(f.oscillators.length, 2);
    const unsupported = audioFixture({ unsupported: true });
    await unsupported.player.unlock();
    unsupported.output.deviceId = 'headset';
    assert.equal(await unsupported.player.play('join'), false);
    unsupported.output.deviceId = 'default';
    assert.equal(await unsupported.player.play('join'), true);
    f.player.destroy();
    unsupported.player.destroy();
});

test('notification controls restore and save per-browser preferences and remove all listeners on teardown', () => {
    const storage = new Map([
        ['voice-channel-sounds-enabled', 'false'],
        ['voice-channel-sounds-volume', '0.6'],
    ]);
    const element = () => ({
        listeners: new Map(),
        addEventListener(name, fn) {
            this.listeners.set(name, fn);
        },
        removeEventListener(name) {
            this.listeners.delete(name);
        },
    });
    const elements = Object.fromEntries(
        [
            'voiceEventSounds',
            'voiceEventVolume',
            'voiceEventVolumeValue',
            'voiceEventSoundStatus',
        ].map((id) => [id, element()])
    );
    const document = { ...element(), getElementById: (id) => elements[id] };
    const window = {
        document,
        VoiceViewUtils: {
            safeStorageGet: (key) => storage.get(key) ?? null,
            safeStorageSet: (key, value) => {
                storage.set(key, String(value));
                return true;
            },
        },
    };
    vm.runInNewContext(source, { window });
    const runtime = window.VoiceChannelSounds.createRuntime({
        document,
        getOutput: () => ({ muted: true, volume: 0, deviceId: 'default' }),
        getIdentity: () => own,
        isConnected: () => true,
    });
    assert.equal(elements.voiceEventSounds.checked, false);
    assert.equal(elements.voiceEventVolume.disabled, true);
    assert.equal(elements.voiceEventVolumeValue.textContent, '60%');
    elements.voiceEventSounds.checked = true;
    elements.voiceEventSounds.listeners.get('change')();
    assert.equal(storage.get('voice-channel-sounds-enabled'), 'true');
    elements.voiceEventVolume.value = 0.2;
    elements.voiceEventVolume.listeners.get('input')();
    assert.equal(storage.get('voice-channel-sounds-volume'), '0.2');
    assert.equal(elements.voiceEventVolumeValue.textContent, '20%');
    runtime.destroy();
    assert.equal(document.listeners.size, 0);
    assert.equal(elements.voiceEventVolume.listeners.size, 0);
    assert.equal(elements.voiceEventSounds.listeners.size, 0);
});
