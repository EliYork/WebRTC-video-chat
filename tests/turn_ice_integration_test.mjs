/* eslint-disable no-await-in-loop -- Isolated server startup and raw Socket.IO request ordering. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const secret = 'test-only-turn-integration-secret-1234567890';
async function start(t, overrides = {}) {
    const directory = mkdtempSync(join(tmpdir(), 'voice-turn-'));
    const reservation = createServer().listen(0, '127.0.0.1'); await once(reservation, 'listening');
    const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
    let output = '';
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(SFU_|PIIK_|TURN_|TLS_)/.test(key)));
    const child = spawn(process.execPath, [fileURLToPath(new URL('../src/server.js', import.meta.url))], {
        cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...env, HOST: '127.0.0.1', PORT: String(port), USE_HTTPS: 'false', ENV: 'production',
            SFU_ENABLED: 'false', PIIK_ENABLED: 'false', CHAT_HISTORY_FILE: join(directory, 'history.json'), ...overrides },
    });
    child.stdout.on('data', value => { output += value; }); child.stderr.on('data', value => { output += value; });
    const exited = once(child, 'exit');
    t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) { child.kill(); await exited; }
        rmSync(directory, { recursive: true, force: true });
    });
    return { child, exited, output: () => output, url: `http://127.0.0.1:${port}`,
        async ready() {
            for (let n = 0; n < 100; n++) {
                if (child.exitCode !== null) throw Error(output);
                try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) return; } catch { /* Still binding. */ }
                await new Promise(resolve => setTimeout(resolve, 30));
            }
            throw Error('Server startup timeout');
        } };
}
async function client(t, origin, roomId = 'lobby') {
    const ws = new WebSocket(origin.replace('http:', 'ws:') + '/socket.io/?EIO=4&transport=websocket&roomId=' + roomId);
    t.after(() => ws.terminate());
    const frames = [], waits = new Set(); let fault, sequence = 0;
    ws.on('message', value => {
        const raw = value.toString(); if (raw === '2') { ws.send('3'); return; }
        frames.push(raw); waits.forEach(wake => wake());
    });
    ws.on('error', error => { fault = error; waits.forEach(wake => wake()); });
    const wait = async prefix => {
        const deadline = Date.now() + 4000;
        while (Date.now() < deadline) {
            if (fault) throw fault;
            const found = frames.find(row => row.startsWith(prefix)); if (found) return found;
            await new Promise(resolve => { const wake = () => { clearTimeout(timer); waits.delete(wake); resolve(); };
                const timer = setTimeout(wake, 30); waits.add(wake); });
        }
        throw Error('Socket response timeout');
    };
    await wait('0'); ws.send('40'); await wait('40');
    return { frames, async request(payload) {
        const id = ++sequence;
        ws.send('42' + id + JSON.stringify(['rtc:ice', ...(payload === undefined ? [] : [payload])]));
        const prefix = '43' + id + '[';
        return JSON.parse((await wait(prefix)).slice(('43' + id).length))[0];
    } };
}

test('real Socket.IO issues private short-lived TURN credentials only in an allowed guest connection', { timeout: 10000 }, async t => {
    const instance = await start(t, { TURN_URLS: 'turn:relay.example.test:3478?transport=udp', TURN_SHARED_SECRET: secret, TURN_TTL_SECONDS: '600' });
    await instance.ready();
    const page = await (await fetch(instance.url + '/room/lobby')).text();
    const bootstrap = JSON.parse(page.match(/const roomBootstrap = (.+)\r?\n/)[1]);
    assert.equal(bootstrap.turnEnabled, true);
    assert.equal(bootstrap.iceServers.every(entry => entry.urls.startsWith('stun:')), true);
    assert.equal(page.includes(secret), false); assert.equal(page.includes('relay.example.test'), false);
    const a = await client(t, instance.url), b = await client(t, instance.url), foreign = await client(t, instance.url, 'not-a-room');
    const first = await a.request(), second = await b.request();
    assert.equal(first.ok, true); assert.equal(first.ttlSeconds, 600);
    const turn = first.iceServers.at(-1);
    assert.equal(turn.credential, createHmac('sha1', secret).update(turn.username).digest('base64'));
    assert.notEqual(turn.username, second.iceServers.at(-1).username);
    assert.equal((await a.request()).iceServers.at(-1).username, turn.username);
    assert.equal((await a.request({ urls: ['turn:injected.example.test'] })).reason, 'invalid-payload');
    assert.equal((await foreign.request()).reason, 'invalid-room');
    for (let n = 0; n < 4; n++) assert.equal((await a.request()).ok, true);
    assert.equal((await a.request()).reason, 'ice-rate-limited');
    assert.equal((await b.request()).ok, true);
    assert.equal(b.frames.some(frame => frame.includes(turn.username)), false, 'credentials never broadcast to another socket');
    const health = await (await fetch(instance.url + '/readyz')).text();
    assert.doesNotMatch(health, /relay\.example|username|credential/); assert.equal(instance.output().includes(secret), false);
});

test('real server rejects partial TURN configuration before listening without logging its secret', { timeout: 10000 }, async t => {
    const instance = await start(t, { TURN_SHARED_SECRET: secret });
    const [code] = await instance.exited; assert.notEqual(code, 0);
    assert.match(instance.output(), /\[turn\]/); assert.equal(instance.output().includes(secret), false);
    await assert.rejects(fetch(instance.url + '/healthz'));
});
