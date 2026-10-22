import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const source = readFileSync(new URL('../src/views/js/media/remote-audio-gain.js', import.meta.url), 'utf8');
function fixture() {
    const contexts = [];
    const failures = [];
    const window = {};
    vm.runInNewContext(source, { window });
    const runtime = window.VoiceRemoteAudioGain.createRuntime({
        MediaStreamCtor: class { constructor(tracks) { this.tracks = tracks; } },
        onFailure: (error) => failures.push(error.message),
        createContext: () => {
            const context = { state: 'running', sinkId: '', currentTime: 0, sources: [], gains: [],
                destination: {}, close() { this.closed = true; return Promise.resolve(); },
                createGain() { const gain = { gain: { value: 0 }, connect() {}, disconnect() { this.disconnected = true; } }; this.gains.push(gain); return gain; },
                createMediaStreamSource(stream) { const node = { stream, connect() {}, disconnect() { this.disconnected = true; } }; this.sources.push(node); return node; },
            };
            contexts.push(context);
            return context;
        },
    });
    const track = { id: 'remote-1', readyState: 'live', stop() { throw new Error('must not stop remote track'); } };
    const element = () => ({ srcObject: { getAudioTracks: () => [track] }, dataset: {}, volume: 1, muted: false });
    return { runtime, contexts, failures, element, track };
}
test('200% uses independent gains and native playout never duplicates amplified audio', () => {
    const { runtime, contexts, element } = fixture();
    const voice = element(), screen = element();
    runtime.setVolume(voice, { volume: 2 });
    runtime.setVolume(screen, { volume: 1.5 });
    assert.equal(contexts.length, 1);
    assert.equal(contexts[0].gains[0].gain.value, 2);
    assert.equal(contexts[0].gains[1].gain.value, 1.5);
    assert.equal(voice.muted, true);
    assert.equal(screen.muted, true);
    assert.equal(runtime.describePlayer(voice).重复播放风险, false);
    voice.muted = false;
    assert.equal(runtime.describePlayer(voice).重复播放风险, true);
    runtime.setVolume(voice, { volume: 2 });
    assert.equal(runtime.describePlayer(voice).重复播放风险, false);
    runtime.setVolume(voice, { volume: 0.3 });
    assert.equal(voice.volume, 0.3);
    assert.equal(voice.muted, false);
    assert.equal(contexts[0].closed, undefined);
    runtime.setVolume(screen, { volume: 2, muted: true });
    assert.equal(screen.muted, true);
    assert.equal(contexts[0].closed, true);
    assert.ok(contexts[0].sources.every((node) => node.disconnected));
});
test('wrong sink stays silent until routed; unsupported amplification returns to native selected sink', () => {
    const { runtime, contexts, failures, element } = fixture();
    const player = element();
    player.dataset.outputSinkId = 'speaker';
    runtime.setVolume(player, { volume: 2 });
    assert.equal(contexts[0].gains[0].gain.value, 0);
    contexts[0].sinkId = 'speaker';
    runtime.activateOutput(player);
    assert.equal(contexts[0].gains[0].gain.value, 2);
    const token = runtime.getBranchToken(player);
    runtime.fallback(player, token);
    assert.equal(player.muted, false);
    assert.equal(player.volume, 1);
    assert.equal(player.dataset.outputSinkId, 'speaker');
    assert.deepEqual(failures, ['amplification-output-unsupported']);
});
test('late resume rejection cannot unmute a new muted state; changed track releases old graph', async () => {
    const { runtime, contexts, element, track } = fixture();
    const player = element();
    runtime.setVolume(player, { volume: 2 });
    let reject;
    contexts[0].state = 'suspended';
    contexts[0].resume = () => new Promise((_, fail) => { reject = fail; });
    runtime.setVolume(player, { volume: 2 });
    runtime.setVolume(player, { volume: 2, muted: true });
    reject(new Error('blocked'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(player.muted, true);
    runtime.setVolume(player, { volume: 2 });
    const old = contexts.at(-1);
    player.srcObject = { getAudioTracks: () => [{ ...track, id: 'remote-2' }] };
    runtime.setVolume(player, { volume: 2 });
    assert.equal(old.closed, true);
    runtime.destroy();
    assert.equal(runtime.getSnapshot().amplifiedPlayers, 0);
});

test('rewrapping or reordering the same live tracks preserves the active amplification graph', () => {
    const { runtime, contexts, element, track } = fixture();
    const second = { ...track, id: 'second' };
    const player = element();
    player.srcObject = { getAudioTracks: () => [track, second] };
    runtime.setVolume(player, { volume: 2 });
    const token = runtime.getBranchToken(player);
    player.srcObject = { getAudioTracks: () => [second, track] };
    runtime.setVolume(player, { volume: 1.5 });
    assert.equal(runtime.getBranchToken(player), token);
    assert.equal(contexts.length, 1);
    assert.equal(contexts[0].sources.length, 2);
    assert.equal(contexts[0].gains[0].gain.value, 1.5);
    assert.equal(player.muted, true);
    runtime.destroy();
});

test('a different receiver track with the same ID replaces the old amplification source', () => {
    const { runtime, contexts, element, track } = fixture();
    const player = element();
    runtime.setVolume(player, { volume: 2 });
    const previous = runtime.getBranchToken(player);
    const replacement = { ...track };
    assert.equal(replacement.id, track.id);
    player.srcObject = { getAudioTracks: () => [replacement] };
    runtime.setVolume(player, { volume: 1.5 });
    assert.notEqual(runtime.getBranchToken(player), previous);
    assert.equal(contexts[0].closed, true);
    assert.equal(contexts[0].sources[0].disconnected, true);
    assert.equal(contexts[1].sources[0].stream.tracks[0], replacement);
    assert.equal(contexts[1].gains[0].gain.value, 1.5);
    assert.equal(player.muted, true);
    runtime.destroy();
});

test('same-ID receiver replacement preserves other players sharing the output context', () => {
    const { runtime, contexts, element, track, failures } = fixture();
    const voice = element(), screen = element();
    runtime.setVolume(voice, { volume: 2 });
    runtime.setVolume(screen, { volume: 1.5 });
    const oldVoice = runtime.getBranchToken(voice);
    const screenToken = runtime.getBranchToken(screen);
    const replacement = { ...track };
    voice.srcObject = { getAudioTracks: () => [replacement] };
    runtime.setVolume(voice, { volume: 1.8 });
    assert.notEqual(runtime.getBranchToken(voice), oldVoice);
    assert.equal(runtime.getBranchToken(screen), screenToken);
    assert.equal(contexts.length, 1);
    assert.equal(contexts[0].closed, undefined);
    assert.equal(contexts[0].sources[0].disconnected, true);
    assert.equal(contexts[0].sources[1].disconnected, undefined);
    assert.equal(contexts[0].sources[2].stream.tracks[0], replacement);
    assert.equal(contexts[0].gains[1].gain.value, 1.5);
    assert.equal(contexts[0].gains[2].gain.value, 1.8);
    assert.equal(voice.muted, true);
    assert.equal(screen.muted, true);
    assert.deepEqual(failures, []);
    runtime.destroy();
});

test('a same-ID replacement is not released by the previous source resume failure', async () => {
    const { runtime, contexts, element, track, failures } = fixture();
    const player = element();
    runtime.setVolume(player, { volume: 2 });
    let reject;
    contexts[0].state = 'suspended';
    contexts[0].resume = () => new Promise((_, fail) => { reject ||= fail; });
    runtime.setVolume(player, { volume: 2 });
    player.srcObject = { getAudioTracks: () => [{ ...track }] };
    runtime.setVolume(player, { volume: 1.5 });
    const current = runtime.getBranchToken(player);
    reject(new Error('previous receiver resume failed'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(runtime.getBranchToken(player), current);
    assert.equal(contexts.at(-1).gains.at(-1).gain.value, 1.5);
    assert.equal(player.muted, true);
    assert.deepEqual(failures, []);
    runtime.destroy();
});

test('an earlier resume rejection preserves the same branch while its newer resume is pending', async () => {
    const { runtime, contexts, element, failures } = fixture();
    const player = element();
    runtime.setVolume(player, { volume: 2 });
    const branch = runtime.getBranchToken(player), context = contexts[0];
    const pending = [];
    context.state = 'suspended';
    context.resume = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
    runtime.setVolume(player, { volume: 1.8 });
    runtime.setVolume(player, { volume: 1.5 });
    pending[0].reject(new Error('obsolete resume failed'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(runtime.getBranchToken(player), branch);
    assert.equal(player.muted, true);
    assert.equal(context.closed, undefined);
    assert.deepEqual(failures, []);
    context.state = 'running'; pending[1].resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(branch.gain.gain.value, 1.5);
    assert.equal(runtime.getBranchToken(player), branch);
    runtime.destroy();
});

test('a late resume rejection leaves shared amplification intact after the context recovered', async () => {
    const { runtime, contexts, element, failures } = fixture();
    const voice = element(), screen = element();
    runtime.setVolume(voice, { volume: 2 });
    const context = contexts[0], pending = [];
    context.state = 'suspended';
    context.resume = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
    runtime.setVolume(voice, { volume: 1.8 });
    const voiceBranch = runtime.getBranchToken(voice);
    runtime.setVolume(screen, { volume: 1.5 });
    const screenBranch = runtime.getBranchToken(screen);
    context.state = 'running'; pending[1].resolve();
    await new Promise(resolve => setImmediate(resolve));
    pending[0].reject(new Error('previous resume failed after recovery'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(runtime.getBranchToken(voice), voiceBranch);
    assert.equal(runtime.getBranchToken(screen), screenBranch);
    assert.equal(voice.muted, true); assert.equal(screen.muted, true);
    assert.equal(runtime.getSnapshot().amplifiedPlayers, 2);
    assert.deepEqual(failures, []);
    runtime.destroy();
});

test('the current resume rejection still falls back once without stopping received tracks', async () => {
    const { runtime, contexts, element, failures, track } = fixture();
    const player = element();
    runtime.setVolume(player, { volume: 2 });
    contexts[0].state = 'suspended';
    contexts[0].resume = () => Promise.reject(new Error('current resume blocked'));
    runtime.setVolume(player, { volume: 1.5 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(runtime.getSnapshot().amplifiedPlayers, 0);
    assert.equal(player.muted, false); assert.equal(player.volume, 1);
    assert.equal(contexts[0].closed, true);
    assert.equal(track.readyState, 'live');
    assert.deepEqual(failures, ['current resume blocked']);
    runtime.destroy();
});
