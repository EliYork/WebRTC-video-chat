/* eslint-disable no-await-in-loop -- Bounded polls observe the isolated server startup. */
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { createServer } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import Logger from '../src/utils/Log.js';
import { createVoiceCallSignaling } from '../src/utils/VoiceCallSignaling.js';
import { createVoicePeerBindings, readPeerHandshake } from '../src/utils/VoicePeerIdentity.js';

const source = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const deferred = () => {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
};

for (const phase of ['queued', 'discovery', 'joining']) {
    test(`hangup during ${phase} cannot resurrect a voice session`, async () => {
        const entered = deferred();
        const gate = deferred();
        const events = [];
        const socket = {
            id: 'cancelled', data: {}, rooms: new Set(),
            async join(room) {
                this.rooms.add(room);
                if (phase === 'joining') { entered.resolve(); await gate.promise; }
            },
            async leave(room) { this.rooms.delete(room); },
            emit: (...args) => events.push(args),
            to: () => ({ emit: (...args) => events.push(args) }),
        };
        const signaling = createVoiceCallSignaling({
            authorizePeer: () => true,
            resolveRoomId: (room) => room === 'game' ? room : undefined,
            io: { in: () => ({ async fetchSockets() {
                if (phase === 'discovery') { entered.resolve(); await gate.promise; }
                return [];
            } }) },
        });
        const pending = signaling.join({ roomId: 'game', peerId: 'test' }, socket);
        if (phase !== 'queued') await entered.promise;
        await signaling.leave(socket);
        gate.resolve();
        assert.equal((await pending).reason, 'voice-join-cancelled');
        assert.equal(signaling.getVoiceOwner(socket), undefined);
        assert.equal(socket.rooms.size, 0);
        assert.equal(events.length, 0);
    });
}

for (const room of ['game', 'lobby']) {
    test(`latest competing voice join owns ${room} without leftover membership`, async () => {
        const entered = deferred();
        const gate = deferred();
        let joins = 0;
        const socket = {
            id: 'switch', data: {}, rooms: new Set(), emit() {}, to: () => ({ emit() {} }),
            async join(roomId) {
                this.rooms.add(roomId);
                if (++joins === 1) { entered.resolve(); await gate.promise; }
            },
            async leave(roomId) { this.rooms.delete(roomId); },
        };
        const signaling = createVoiceCallSignaling({
            authorizePeer: () => true,
            resolveRoomId: (value) => ['game', 'lobby'].includes(value) ? value : undefined,
            io: { in: () => ({ fetchSockets: async () => [] }) },
        });
        const old = signaling.join({ roomId: 'game', peerId: 'old' }, socket);
        await entered.promise;
        const current = signaling.join({ roomId: room, peerId: 'new' }, socket);
        gate.resolve();
        assert.equal((await old).ok, false);
        assert.equal((await current).ok, true);
        assert.equal(signaling.getVoiceOwner(socket).peerId, 'new');
        assert.deepEqual([...socket.rooms], [room]);
    });
}

test('logger survives an unwritable path and resumes file logging after repair', () => {
    const dir = mkdtempSync(join(tmpdir(), 'voice-log-test-'));
    const logger = new Logger('production');
    const original = console.error;
    const errors = [];
    console.error = (...args) => errors.push(args);
    try {
        logger.logFilePath = dir;
        assert.doesNotThrow(() => logger.warn('first'));
        assert.doesNotThrow(() => logger.info('second'));
        assert.equal(errors.filter((args) => args[0].startsWith('[log]')).length, 1);
        logger.logFilePath = join(dir, 'repaired.log');
        logger.info('recovered');
        assert.match(readFileSync(logger.logFilePath, 'utf8'), /recovered/);
        assert.equal(logger.writeFailed, false);
    } finally {
        console.error = original;
        rmSync(dir, { recursive: true });
    }
});

test('wrong-shaped stored peer volumes are recoverable and explicit mute survives', () => {
    for (const saved of [null, 42, 'text', [], { peer: 0 }]) {
        let stored = JSON.stringify(saved);
        const window = { VoiceViewUtils: {
            safeStorageGet: () => stored,
            writeJsonStorage: (_, value) => { stored = JSON.stringify(value); },
        } };
        vm.runInNewContext(source('views/js/media/output-volume-state.js'), { window });
        const api = window.VoiceOutputVolumeState;
        assert.equal(api.getPeerVolume('peer'), saved?.peer === 0 ? 0 : 1);
        assert.doesNotThrow(() => api.setPeerVolume('peer', 0.5));
        assert.equal(api.getPeerVolume('peer'), 0.5);
        api.setPeerVolume('peer', 2);
        assert.equal(api.getPeerVolume('peer'), 2);
        assert.equal(api.getEffectiveOutputVolume(2, api.getPeerVolume('peer')), 4);
        assert.equal(api.getEffectiveOutputVolume(0, 2), 0);
    }
});

test('peer volume retention preserves recent values and observes external storage updates', () => {
    let stored = JSON.stringify(Object.fromEntries(
        Array.from({ length: 300 }, (_, index) => [`peer-${index}`, 0.5])
    ));
    const window = { VoiceViewUtils: {
        safeStorageGet: () => stored,
        writeJsonStorage: (_, value) => { stored = JSON.stringify(value); },
    } };
    vm.runInNewContext(source('views/js/media/output-volume-state.js'), { window });
    const api = window.VoiceOutputVolumeState;
    api.setPeerVolume('peer-0', 0);
    assert.equal(Object.keys(JSON.parse(stored)).length, 256);
    assert.equal(api.getPeerVolume('peer-0'), 0);
    assert.equal(api.getPeerVolume('peer-1'), 1);
    assert.equal(api.getPeerVolume('peer-299'), 0.5);
    stored = JSON.stringify({ 'peer-0': 2 });
    assert.equal(api.getPeerVolume('peer-0'), 2);
});

test('stage runtime never accesses old layout storage, including denied storage', () => {
    const window = { get localStorage() { throw new Error('storage denied'); } };
    vm.runInNewContext(source('views/js/room/stage-layout-runtime.js'), { window });
    assert.equal(typeof window.VoiceStageLayout.createRuntime, 'function');
    assert.doesNotMatch(source('views/script.js'), /PageLayout|voicePageLayout|initializeLayoutFromStorage/);
});

test('application and PeerServer agree on a unique handshake identity', () => {
    const token = randomBytes(32).toString('hex');
    const id = `voice-${createHash('sha256').update(token).digest('hex')}`;
    const query = new URLSearchParams({ key: 'peerjs', id, token });
    assert.deepEqual(readPeerHandshake(`/peerjs/peerjs?${query}`), { id, token });
    query.append('token', token);
    assert.equal(readPeerHandshake(`/peerjs/peerjs?${query}`), undefined);
});

test('PeerJS admission uses the registered Client credential and socket', () => {
    const token = randomBytes(32).toString('hex');
    const id = `voice-${createHash('sha256').update(token).digest('hex')}`;
    const bindings = createVoicePeerBindings();
    class Socket extends EventEmitter {
        readyState = WebSocket.OPEN;
        terminate() { this.readyState = WebSocket.CLOSED; this.emit('close'); }
    }
    let socket = new Socket();
    let registeredToken = randomBytes(32).toString('hex');
    const client = { getSocket: () => socket, getId: () => id, getToken: () => registeredToken };
    bindings.observe(socket, { id, token });
    assert.equal(bindings.authorizes(id, token), false, 'handshake alone grants no authority');
    assert.equal(bindings.register(client), false);
    assert.equal(socket.readyState, WebSocket.CLOSED);
    socket = new Socket();
    registeredToken = token;
    bindings.observe(socket, { id, token });
    assert.equal(bindings.register(client), true);
    assert.equal(bindings.authorizes(id, token), true);
    socket = new Socket();
    assert.equal(bindings.authorizes(id, token), false, 'a different socket has to register before admission');
});

test('real PeerJS registration binds admission and same-room relay to the live connection', { timeout: 20000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'voice-upgrade-test-'));
    const reservation = createServer();
    reservation.listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const port = reservation.address().port;
    await new Promise((done) => reservation.close(done));
    const app = spawn(process.execPath, [resolve('src/server.js')], {
        cwd: dir, windowsHide: true,
        env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), USE_HTTPS: 'false', ENV: 'production', PIIK_ENABLED: 'false', SFU_ENABLED: 'false', CHAT_HISTORY_FILE: join(dir, 'history.json') },
    });
    let output = '';
    app.stdout.on('data', (chunk) => { output += chunk; });
    app.stderr.on('data', (chunk) => { output += chunk; });
    const clients = [];
    const opened = async (url, predicate) => {
        const client = new WebSocket(url);
        client.on('error', () => {});
        clients.push(client);
        const message = await waitMessage(client, predicate);
        return { client, message };
    };
    const waitMessage = (client, predicate) => new Promise((done, reject) => {
        const signal = AbortSignal.timeout(3000);
        const cleanup = () => {
            client.off('message', receive);
            client.off('error', fail);
            signal.removeEventListener('abort', onAbort);
        };
        const fail = (error) => { cleanup(); reject(error); };
        const onAbort = () => fail(signal.reason);
        const receive = (value) => {
            const message = value.toString();
            if (predicate(message)) { cleanup(); done(message); }
        };
        client.on('message', receive);
        client.on('error', fail);
        signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
        let ready = false;
        for (let i = 0; i < 100 && !ready; i++) {
            try { ready = (await fetch(`http://127.0.0.1:${port}/`)).ok; } catch { /* Server may still be binding. */ }
            if (app.exitCode !== null) throw new Error(output);
            if (!ready) await new Promise((done) => setTimeout(done, 50));
        }
        assert.ok(ready, 'isolated app must start');
        const base = `http://127.0.0.1:${port}`;
        const landing = await fetch(base, { redirect: 'manual' });
        assert.equal(landing.status, 302);
        assert.equal(landing.headers.get('location'), '/room/lobby');
        const html = await (await fetch(base + '/room/lobby')).text();
        const assets = [...html.matchAll(/(?:href|src)="(\/style\.css|\/script\.js|\/js\/room\/boot-runtime\.js)\?v=([a-f0-9]{64})"/g)];
        assert.deepEqual(assets.map(match => match[1]), ['/style.css', '/js/room/boot-runtime.js', '/script.js']);
        await Promise.all(assets.map(async ([, path, hash]) => {
            const response = await fetch(`${base}${path}?v=${hash}`);
            assert.equal(response.status, 200);
            assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
            assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'), hash);
            const oldHash = (hash[0] === '0' ? '1' : '0') + hash.slice(1);
            for (const query of ['', `?v=${oldHash}`, `?v=${hash}&v=${oldHash}`]) {
                const stale = await fetch(base + path + query, { method: 'HEAD' });
                assert.equal(stale.status, 200);
                assert.equal(stale.headers.get('cache-control'), 'no-cache');
            }
        }));
        await Promise.all(['/room/lobby', '/audio-worklet/rnnoise-processor.js'].map(async (path) => {
            const response = await fetch(`http://127.0.0.1:${port}${path}`);
            assert.equal(response.status, 200);
            const policy = response.headers.get('content-security-policy');
            const scriptPolicy = policy.split(';').find((rule) => rule.startsWith('script-src '));
            assert.ok(scriptPolicy.includes("'wasm-unsafe-eval'"), 'RNNoise WASM compilation allowed');
            assert.equal(scriptPolicy.includes("'unsafe-eval'"), false, 'JavaScript eval remains blocked');
            assert.doesNotMatch(policy, /unpkg\.com|(?:kit|ka-f)\.fontawesome\.com/, 'local assets do not need external CDN permissions');
        }));
        const openSocket = async () => {
            const socket = await opened(`ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`, (msg) => msg.startsWith('0'));
            assert.ok(JSON.parse(socket.message.slice(1)).sid);
            const connected = waitMessage(socket.client, msg => msg.startsWith('40'));
            socket.client.send('40');
            await connected;
            return socket.client;
        };
        const socket = await openSocket();
        const token = randomBytes(32).toString('hex');
        const id = `voice-${createHash('sha256').update(token).digest('hex')}`;
        const peerQuery = new URLSearchParams({ key: 'peerjs', id, token });
        const peerURL = `ws://127.0.0.1:${port}/peerjs/peerjs?${peerQuery}`;
        const openPeer = (url = peerURL) => opened(url, (msg) => JSON.parse(msg).type === 'OPEN');
        const peer = await openPeer();
        let sequence = 0;
        const request = async (name, payload, transport = socket) => {
            const number = sequence++;
            const prefix = `43${number}[`;
            const response = waitMessage(transport, msg => msg.startsWith(prefix));
            transport.send(`42${number}${JSON.stringify(payload === undefined ? [name] : [name, payload])}`);
            return JSON.parse((await response).slice(prefix.length - 1))[0];
        };
        const credential = { peerId: id, peerToken: token, roomId: 'lobby' };
        assert.equal((await request('voice:join', { ...credential, peerToken: randomBytes(32).toString('hex') })).reason, 'voice-peer-unverified');
        assert.equal((await request('voice:snapshot')).ok, false);
        const accepted = await request('voice:join', credential);
        assert.equal(accepted.ok, true);
        const firstClosed = once(peer.client, 'close', { signal: AbortSignal.timeout(3000) });
        const replacement = await openPeer();
        await firstClosed;
        assert.equal((await request('voice:join', credential)).voiceSessionGeneration, accepted.voiceSessionGeneration);
        const replacementClosed = once(replacement.client, 'close', { signal: AbortSignal.timeout(3000) });
        replacement.client.close();
        await replacementClosed;
        assert.equal((await request('voice:join', credential)).reason, 'voice-peer-unverified');
        const reconnected = await openPeer();
        assert.equal((await request('voice:join', credential)).voiceSessionGeneration, accepted.voiceSessionGeneration);
        const recipientSocket = await openSocket();
        const recipientToken = randomBytes(32).toString('hex');
        const recipientId = `voice-${createHash('sha256').update(recipientToken).digest('hex')}`;
        const recipientQuery = new URLSearchParams({ key: 'peerjs', id: recipientId, token: recipientToken });
        const recipient = await openPeer(`ws://127.0.0.1:${port}/peerjs/peerjs?${recipientQuery}`);
        assert.equal((await request('voice:join', { peerId: recipientId, peerToken: recipientToken, roomId: 'lobby' }, recipientSocket)).ok, true);
        const relayed = waitMessage(recipient.client, msg => JSON.parse(msg).type === 'OFFER');
        reconnected.client.send(JSON.stringify({ type: 'OFFER', dst: recipientId, payload: { connectionId: 'fixture' } }));
        assert.equal(JSON.parse(await relayed).src, id);
        reconnected.client.send('{bad JSON');
        reconnected.client.send('null');
        reconnected.client.send('42');
        assert.equal((await request('voice:snapshot')).peerId, id);
        assert.equal((await fetch(`http://127.0.0.1:${port}/room/game`)).status, 200);
        assert.equal(app.exitCode, null);
        const logs = readFileSync(join(dir, 'logs/node.log'), 'utf8');
        assert.match(logs, /\[peerjs\]/);
        assert.match(logs, /\[screen-media\] provider=legacy/);
    } finally {
        clients.forEach((client) => client.terminate());
        const exit = app.exitCode === null ? once(app, 'exit', { signal: AbortSignal.timeout(3000) }) : undefined;
        app.kill();
        await exit;
        rmSync(dir, { recursive: true });
    }
});
