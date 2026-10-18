import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import WebSocket from 'ws';
import Logger from '../src/utils/Log.js';
import { createVoiceCallSignaling } from '../src/utils/VoiceCallSignaling.js';

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
        let stored = saved;
        const window = { VoiceViewUtils: {
            readJsonStorage: () => stored,
            writeJsonStorage: (_, value) => { stored = value; },
        } };
        vm.runInNewContext(source('views/js/media/output-volume-state.js'), { window });
        const api = window.VoiceOutputVolumeState;
        assert.equal(api.getPeerVolume('peer'), saved?.peer === 0 ? 0 : 1);
        assert.doesNotThrow(() => api.setPeerVolume('peer', 0.5));
        assert.equal(api.getPeerVolume('peer'), 0.5);
    }
});

test('stage runtime never accesses old layout storage, including denied storage', () => {
    const window = { get localStorage() { throw new Error('storage denied'); } };
    vm.runInNewContext(source('views/js/room/stage-layout-runtime.js'), { window });
    assert.equal(typeof window.VoiceStageLayout.createRuntime, 'function');
    assert.doesNotMatch(source('views/script.js'), /PageLayout|voicePageLayout|initializeLayoutFromStorage/);
});

test('real server supports both WebSocket protocols and survives malformed PeerJS messages', { timeout: 20000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'voice-upgrade-test-'));
    const reservation = createServer();
    reservation.listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const port = reservation.address().port;
    await new Promise((done) => reservation.close(done));
    const app = spawn(process.execPath, [resolve('src/server.js')], {
        cwd: dir, windowsHide: true,
        env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), USE_HTTPS: 'false', ENV: 'production', SFU_ENABLED: 'false', CHAT_HISTORY_FILE: join(dir, 'history.json') },
    });
    let output = '';
    app.stdout.on('data', (chunk) => { output += chunk; });
    app.stderr.on('data', (chunk) => { output += chunk; });
    const clients = [];
    const opened = async (url, predicate) => {
        const client = new WebSocket(url);
        clients.push(client);
        const message = await new Promise((resolveMessage, reject) => {
            client.on('error', reject);
            client.on('message', (value) => { if (predicate(value.toString())) resolveMessage(value.toString()); });
        });
        return { client, message };
    };
    try {
        let ready = false;
        for (let i = 0; i < 100 && !ready; i++) {
            try { ready = (await fetch(`http://127.0.0.1:${port}/`)).ok; } catch {}
            if (app.exitCode !== null) throw new Error(output);
            if (!ready) await new Promise((done) => setTimeout(done, 50));
        }
        assert.ok(ready, 'isolated app must start');
        await Promise.all(['/room/lobby', '/audio-worklet/rnnoise-processor.js'].map(async (path) => {
            const response = await fetch(`http://127.0.0.1:${port}${path}`);
            assert.equal(response.status, 200);
            const policy = response.headers.get('content-security-policy');
            const scriptPolicy = policy.split(';').find((rule) => rule.startsWith('script-src '));
            assert.ok(scriptPolicy.includes("'wasm-unsafe-eval'"), 'RNNoise WASM compilation allowed');
            assert.equal(scriptPolicy.includes("'unsafe-eval'"), false, 'JavaScript eval remains blocked');
        }));
        const socket = await opened(`ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`, (msg) => msg.startsWith('0'));
        assert.ok(JSON.parse(socket.message.slice(1)).sid);
        const connected = once(socket.client, 'message');
        socket.client.send('40');
        assert.match((await connected)[0].toString(), /^40/);
        const peer = await opened(`ws://127.0.0.1:${port}/peerjs/peerjs?key=peerjs&id=audit-peer&token=audit`, (msg) => JSON.parse(msg).type === 'OPEN');
        peer.client.send('{bad JSON');
        peer.client.send('null');
        peer.client.send('42');
        const ack = once(socket.client, 'message');
        socket.client.send('420["voice:snapshot"]');
        assert.match((await ack)[0].toString(), /^430\[/);
        assert.equal((await fetch(`http://127.0.0.1:${port}/room/game`)).status, 200);
        assert.equal(app.exitCode, null);
        assert.match(readFileSync(join(dir, 'logs/node.log'), 'utf8'), /\[peerjs\]/);
    } finally {
        clients.forEach((client) => client.terminate());
        const exit = app.exitCode === null ? once(app, 'exit') : undefined;
        app.kill();
        await exit;
        rmSync(dir, { recursive: true });
    }
});
