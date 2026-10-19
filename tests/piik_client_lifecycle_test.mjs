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
            export class HostProvisionalChild {}
            export class NativeSenderPeer {}
            export class ViewerPeer {}
            export const decodeServerMessage = JSON.parse;
            export const applyVideoCaptureProfile = async () => {};
            export const createNativeCapture = () => ({stop(){},isActive(){return false},get(){return null}});
        ` }));
    } }],
});
const flush = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
    const context = vm.createContext({ window: {}, performance });
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
    const runtime = context.window.PiikScreenMedia.createRuntime({ onWarning: (...args) => warnings.push(args) });
    runtime.attachSocket(socket);
    return {runtime, socket, events, requests, delayed};
}
const stream = {getVideoTracks: () => [{getSettings: () => ({width: 1280, height: 720}), readyState: 'live'}]};

test('cancelled publication safely handles a late acknowledgement and denied cleanup', async () => {
    const {runtime, requests, delayed} = fixture();
    const publishing = runtime.publish(stream, {frameRate: 30});
    const cancelled = assert.rejects(publishing, /取消/);
    runtime.leave();
    delayed.get('publish')(null, {ok: true, sessionId: 'retired', shareId: 'old-share'});
    await cancelled;
    await flush();
    assert.ok(requests.some(input => input.action === 'close' && input.sessionId === 'retired'));
    assert.equal(runtime.snapshot().sharing, false);
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
