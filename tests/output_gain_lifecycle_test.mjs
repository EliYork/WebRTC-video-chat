import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const deviceSource = read('../src/views/js/voice/voice-device-runtime.js');
const gainSource = read('../src/views/js/media/remote-audio-gain.js');
const pageSource = read('../src/views/script.js');
const begin = pageSource.indexOf('const applyOutputDevice =');
const end = pageSource.indexOf('const applyOutputSettings =', begin);
assert.ok(begin >= 0 && end > begin);
const flush = () => new Promise((resolve) => setImmediate(resolve));

function fixture() {
    const window = {};
    vm.runInNewContext(deviceSource, { window });
    vm.runInNewContext(gainSource, { window });
    const contexts = [];
    const errors = [];
    const gainFailures = [];
    const selections = [];
    let rejectOld;
    let reapplications = 0;
    const gain = window.VoiceRemoteAudioGain.createRuntime({
        MediaStreamCtor: class { constructor(tracks) { this.tracks = tracks; } },
        onFailure: (error) => gainFailures.push(error),
        createContext() {
            const first = contexts.length === 0;
            const context = {
                state: 'running', sinkId: '', currentTime: 0, destination: {},
                gains: [], sources: [],
                close() { this.state = 'closed'; return Promise.resolve(); },
                async setSinkId(id) {
                    if (first && id === 'speaker') {
                        await new Promise((_, reject) => { rejectOld = reject; });
                    }
                    this.sinkId = id;
                },
                createGain() {
                    const node = { gain: { value: 0 }, connect() {}, disconnect() { this.disconnected = true; } };
                    this.gains.push(node);
                    return node;
                },
                createMediaStreamSource() {
                    const node = { connect() {}, disconnect() { this.disconnected = true; } };
                    this.sources.push(node);
                    return node;
                },
            };
            contexts.push(context);
            return context;
        },
    });
    const track = {
        id: 'remote-audio', readyState: 'live',
        stop() { throw new Error('output routing must not stop the remote track'); },
    };
    const player = {
        srcObject: { getAudioTracks: () => [track] },
        dataset: { outputSinkId: 'speaker' },
        sinkId: 'speaker', volume: 1, muted: false,
        async setSinkId(id) { this.sinkId = id; },
    };
    const context = vm.createContext({
        selectedOutputDeviceId: 'speaker', outputSelectionRevision: 1,
        canSelectAudioOutput: () => true,
        voiceDeviceRuntimeApi: window.VoiceDeviceRuntime,
        remoteAudioGain: gain,
        voiceDeviceRuntime: { setSelected: (...args) => selections.push(args) },
        voiceMediaDebug: { record() {} },
        voiceStatusViewApi: { ERROR_LABELS: { output: { 'device-not-found': 'missing', unknown: 'unknown' } } },
        voiceStatusView: { setMediaError: (...args) => errors.push(args) },
        notifyMediaDock() {},
        applyOutputSettingsToRemoteMedia: () => { reapplications++; },
        console: { warn() {} },
    });
    const apply = vm.runInContext(pageSource.slice(begin, end) + '\napplyOutputDevice', context);
    gain.setVolume(player, { volume: 2 });
    return {
        apply: () => apply(player, true), gain, player, context, contexts,
        errors, gainFailures, selections,
        failOld: () => {
            assert.equal(typeof rejectOld, 'function', 'old context routing has started');
            rejectOld(Object.assign(new Error('retired output failed'), { name: 'NotFoundError' }));
        },
        getReapplications: () => reapplications,
    };
}

for (const state of [{ volume: 0.4 }, { volume: 2, muted: true }]) {
    test(`retired amplification routing cannot change the output after ${state.muted ? 'mute' : 'native volume restoration'}`, async () => {
        const f = fixture();
        const old = f.apply();
        await flush();
        f.gain.setVolume(f.player, state);
        assert.equal(await f.apply(), true);
        f.failOld();
        await old;

        assert.equal(f.context.selectedOutputDeviceId, 'speaker');
        assert.equal(f.player.sinkId, 'speaker');
        assert.equal(f.player.muted, Boolean(state.muted));
        assert.equal(f.player.volume, Math.min(1, state.volume));
        assert.equal(f.gain.getBranchToken(f.player), undefined);
        assert.equal(f.contexts[0].state, 'closed');
        assert.ok(f.contexts[0].sources.every((node) => node.disconnected));
        assert.deepEqual(f.errors, []);
        assert.deepEqual(f.gainFailures, []);
        assert.deepEqual(f.selections, []);
        assert.equal(f.getReapplications(), 0);
        f.gain.destroy();
    });
}

test('a retired amplification failure cannot reset a replacement branch already playing on the selected output', async () => {
    const f = fixture();
    const old = f.apply();
    await flush();
    f.gain.setVolume(f.player, { volume: 0.5 });
    f.gain.setVolume(f.player, { volume: 1.5 });
    const replacement = f.gain.getBranchToken(f.player);
    assert.equal(await f.apply(), true);
    f.failOld();
    await old;

    assert.equal(f.context.selectedOutputDeviceId, 'speaker');
    assert.equal(f.gain.getBranchToken(f.player), replacement);
    assert.equal(f.contexts[0].state, 'closed');
    assert.equal(f.contexts[1].state, 'running');
    assert.equal(f.contexts[1].sinkId, 'speaker');
    assert.equal(f.contexts[1].gains[0].gain.value, 1.5);
    assert.equal(f.player.muted, true);
    assert.deepEqual(f.errors, []);
    assert.deepEqual(f.gainFailures, []);
    assert.deepEqual(f.selections, []);
    assert.equal(f.getReapplications(), 0);
    f.gain.destroy();
});

test('a current amplification routing failure still restores native playback and requests default output', async () => {
    const f = fixture();
    const current = f.apply();
    await flush();
    f.failOld();
    assert.equal(await current, false);

    assert.equal(f.context.selectedOutputDeviceId, 'default');
    assert.equal(f.gain.getBranchToken(f.player), undefined);
    assert.equal(f.player.volume, 1);
    assert.equal(f.player.muted, false);
    assert.equal(f.errors.length, 1);
    assert.equal(f.errors[0][1], 'device-not-found');
    assert.equal(f.gainFailures.length, 1);
    assert.deepEqual(f.selections, [['output', 'default']]);
    assert.equal(f.getReapplications(), 1);
    f.gain.destroy();
});
