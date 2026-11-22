import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// Exercise our adapter's asynchronous ownership boundaries without capture,
// browsers, native devices, network services or the optional upstream checkout.
const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../integrations/piik/client.ts', import.meta.url))],
    bundle: true, write: false, format: 'iife', platform: 'browser',
    tsconfigRaw: { compilerOptions: { target: 'ES2022' } },
    plugins: [{ name: 'isolated-piik-peers', setup(builder) {
        builder.onResolve({ filter: /\.deps\/upstream|^\.\/native$/ }, (args) => ({ path: args.path, namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
            export class HostProvisionalChild {
                prepare({ candidate, profile, stream }) {
                    this.peer?.dispose();
                    this.peer = {
                        peerId: candidate.childPeerId, connectionId: candidate.connectionId, profile, stream,
                        dispose() { this.disposed = true; },
                        async updateCaptureProfile(next) {
                            await this.beforeQuality?.(next);
                            if (this.disposed) return false;
                            this.profile = next;
                            return true;
                        },
                    };
                    window.peers.set(this.peer.peerId, this.peer);
                    return true;
                }
                updateProfile(profile) { return this.peer.updateCaptureProfile(profile); }
                activate() { return { kind: 'promote', peerId: this.peer.peerId, peer: this.peer }; }
                discard() { this.peer?.dispose(); }
            }
            export class NativeSenderPeer {}
            export class ViewerPeer {}
            export const decodeServerMessage = JSON.parse;
            export const applyVideoCaptureProfile = async () => {};
            export const createNativeCapture = () => ({stop(){},isActive(){return false},get(){return null},audioDiagnostics(){return null},captureDiagnostics(){return null}});
        ` }));
    } }],
});
const flush = () => new Promise((resolve) => setImmediate(resolve));
function fixture(options = {}) {
    const peers = new Map();
    const timers = new Map();
    let nextTimer = 0;
    const window = {
        peers,
        setTimeout(callback, delay) { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
        clearTimeout(id) { timers.delete(id); },
    };
    const context = vm.createContext({ window, performance });
    vm.runInContext(bundle.outputFiles[0].text, context);
    const events = new Map(), requests = [], delayed = new Map(), warnings = [];
    const socket = { connected: true,
        on(name, handler) { events.set(name, handler); },
        timeout() { return this; },
        emit(_event, input, reply) {
            assert.ok(this.connected, 'Disconnected requests must not enter the reconnect buffer');
            requests.push(input);
            if (input.action === 'list') reply(null, { ok: true, shares: [] });
            else if (input.action === 'publish' || input.action === 'watch') delayed.set(input.action, reply);
            else reply(null, { ok: false, reason: 'voice-owner-missing' });
        },
    };
    const runtime = context.window.PiikScreenMedia.createRuntime({ onWarning: (...args) => warnings.push(args), ...options });
    runtime.attachSocket(socket);
    const runTimer = () => {
        const [id, timer] = timers.entries().next().value;
        timers.delete(id);
        timer.callback();
        return timer.delay;
    };
    return {runtime, socket, events, requests, delayed, peers, timers, runTimer};
}
const stream = {getVideoTracks: () => [{getSettings: () => ({width: 1280, height: 720}), readyState: 'live'}]};

test('cancelled publication safely handles a late acknowledgement and denied cleanup', async () => {
    const {runtime, requests, delayed} = fixture();
    const publishing = runtime.publish(stream, {frameRate: 30});
    assert.equal(requests.find(input => input.action === 'publish').quality.maxAudioBitrate, 256_000);
    const cancelled = assert.rejects(publishing, /取消/);
    runtime.leave();
    delayed.get('publish')(null, {ok: true, sessionId: 'retired', shareId: 'old-share'});
    await cancelled;
    await flush();
    assert.ok(requests.some(input => input.action === 'close' && input.sessionId === 'retired'));
    assert.equal(runtime.snapshot().sharing, false);
    assert.equal(runtime.snapshot().原生共享音频, null);
});

test('departed viewer safely closes a late watch acknowledgement after authorization ends', async () => {
    const {runtime, events, requests, delayed} = fixture();
    runtime.setSession({roomId: 'lobby', peerId: 'me', voiceSessionGeneration: 1});
    await flush();
    events.get('piik:shares')([{id: 'share', peerId: 'another'}]);
    assert.ok(delayed.has('watch'));
    runtime.leave();
    delayed.get('watch')(null, {ok: true, sessionId: 'late-viewer'});
    await flush();
    assert.ok(requests.some(input => input.action === 'close' && input.sessionId === 'late-viewer'));
    assert.equal(runtime.snapshot().viewing, 0);
});

test('disconnected publication is rejected before it can queue in Socket.IO', async () => {
    const {runtime, socket, requests} = fixture();
    socket.connected = false;
    await assert.rejects(runtime.publish(stream, {frameRate: 30}), /连接已断开/);
    assert.equal(requests.length, 0);
    runtime.leave();
});

test('a late acknowledgement from an earlier reconnect cannot stop the recovered publication', async () => {
    let failures = 0;
    const { runtime, events, requests, delayed } = fixture({
        onPublicationFailure() { failures++; runtime.stopPublishing(); },
    });
    const reconnect = (voiceSessionGeneration) => {
        events.get('disconnect')();
        runtime.setSession({ roomId: 'lobby', peerId: 'me', voiceSessionGeneration });
    };
    reconnect(1);
    const first = runtime.publish(stream, { frameRate: 30 });
    delayed.get('publish')(null, { ok: true, sessionId: 'first', shareId: 'first-share' });
    await first;
    reconnect(2);
    const stale = delayed.get('publish');
    reconnect(3);
    delayed.get('publish')(null, { ok: true, sessionId: 'latest', shareId: 'latest-share' });
    await flush();
    stale(null, { ok: true, sessionId: 'stale', shareId: 'stale-share' });
    await flush();
    assert.equal(failures, 0);
    assert.equal(runtime.snapshot().sharing, true);
    assert.ok(requests.some(input => input.action === 'close' && input.sessionId === 'stale'));
    assert.ok(!requests.some(input => input.action === 'close' && input.sessionId === 'latest'));
    runtime.leave();
});

test('a closed viewer is retried without a list broadcast, and stop cancels further retries', async () => {
    const { runtime, events, requests, delayed, timers, runTimer } = fixture();
    runtime.setSession({ roomId: 'lobby', peerId: 'me', voiceSessionGeneration: 1 });
    await flush();
    const share = { id: 'share', peerId: 'another' };
    const watchers = () => requests.filter(input => input.action === 'watch').length;
    events.get('piik:shares')([share]);
    delayed.get('watch')(null, { ok: true, sessionId: 'first' });
    await flush();
    events.get('piik:closed')({ sessionId: 'first' });
    assert.equal(timers.size, 1);
    assert.equal(runTimer(), 500);
    assert.equal(watchers(), 2);
    delayed.get('watch')(null, { ok: true, sessionId: 'replacement' });
    await flush();
    assert.equal(runtime.snapshot().viewing, 1);

    events.get('piik:closed')({ sessionId: 'replacement' });
    assert.equal(timers.size, 1);
    events.get('piik:shares')([]);
    assert.equal(timers.size, 0);
    assert.equal(watchers(), 2);
    runtime.leave();
});

test('failed watch retries back off and stop after the retry limit', async () => {
    const { runtime, events, requests, delayed, timers, runTimer } = fixture();
    runtime.setSession({ roomId: 'lobby', peerId: 'me', voiceSessionGeneration: 1 });
    await flush();
    const share = { id: 'share', peerId: 'another' };
    events.get('piik:shares')([share]);
    delayed.get('watch')(null, { ok: false, reason: 'temporary' });
    await flush();
    for (const delay of [500, 1500, 3000]) {
        assert.equal(runTimer(), delay);
        delayed.get('watch')(null, { ok: false, reason: 'temporary' });
        // eslint-disable-next-line no-await-in-loop -- Each retry is scheduled by the previous failure.
        await flush();
    }
    assert.equal(timers.size, 0);
    events.get('piik:shares')([share]);
    assert.equal(requests.filter(input => input.action === 'watch').length, 4);
    runtime.leave();
});

test('a viewer leaving during a quality change does not roll back the other viewers', async () => {
    const { runtime, events, delayed, peers } = fixture();
    const original = { getVideoTracks: () => [{ readyState: 'live', getSettings: () => ({ width: 1920, height: 1080 }) }] };
    const publishing = runtime.publish(original, { frameRate: 60 });
    delayed.get('publish')(null, { ok: true, sessionId: 'host', shareId: 'share' });
    await publishing;

    const route = (revision, phase, childPeerIds, childPeerId) => events.get('piik:message')({
        sessionId: 'host',
        message: { type: 'route-update', revision, phase, assignment: { childPeerIds },
            candidate: { childPeerId, connectionId: childPeerId } },
    });
    route(1, 'prepare', ['leaving'], 'leaving');
    route(1, 'active', ['leaving']);
    route(2, 'prepare', ['leaving', 'remaining'], 'remaining');
    route(2, 'active', ['leaving', 'remaining']);
    route(3, 'prepare', ['leaving', 'remaining', 'superseded'], 'superseded');
    let resume;
    const wait = new Promise((resolve) => { resume = resolve; });
    peers.get('leaving').beforeQuality = () => wait;
    peers.get('superseded').beforeQuality = () => wait;
    const update = runtime.updateWeb(original, { resolutionPreset: '720p', frameRate: 30, maxBitrate: 6_000_000 });
    await flush();
    assert.equal(peers.get('remaining').profile.resolution.height, 720);
    route(4, 'prepare', ['remaining', 'joining'], 'joining');
    route(4, 'active', ['remaining', 'joining']);
    resume();
    await update;

    assert.equal(peers.get('leaving').disposed, true);
    assert.equal(peers.get('superseded').disposed, true);
    assert.equal(peers.get('remaining').profile.resolution.height, 720);
    assert.equal(peers.get('joining').profile.resolution.height, 720);
    runtime.leave();
});
