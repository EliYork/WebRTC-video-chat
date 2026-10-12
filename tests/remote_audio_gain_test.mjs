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
    track.id = 'remote-2';
    runtime.setVolume(player, { volume: 2 });
    assert.equal(old.closed, true);
    runtime.destroy();
    assert.equal(runtime.getSnapshot().amplifiedPlayers, 0);
});
