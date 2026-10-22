/* eslint-disable no-await-in-loop -- Bounded polls observe isolated server startup. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { once, EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { get as httpsGet } from 'node:https';
import { createServer as reservePort } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWebServer } from '../src/utils/WebServer.js';
import { createMediaReadiness } from '../src/utils/MediaReadiness.js';
import { createScreenSfuService } from '../src/utils/ScreenSfuService.js';
import { readScreenSfuConfig } from '../src/utils/ScreenSfuBudget.js';

const tlsRoot = dirname(fileURLToPath(new URL('./fixtures/tls/server.key', import.meta.url)));
const tlsEnv = { USE_HTTPS: 'true', TLS_KEY_FILE: 'server.key', TLS_CERT_FILE: 'server.crt' };
async function listen(server) {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    return server.address().port;
}

test('HTTP is explicit and never reads TLS files; invalid HTTPS configuration fails safely', () => {
    const { server, useHttps } = createWebServer(() => {}, {
        env: { USE_HTTPS: 'false' }, read() { assert.fail('HTTP read TLS files'); },
    });
    assert.equal(useHttps, false); assert.equal(server.listening, false);
    for (const USE_HTTPS of [undefined, '', 'TRUE', 'yes'])
        assert.throws(() => createWebServer(() => {}, { env: { USE_HTTPS } }), /USE_HTTPS/);
    for (const missing of ['TLS_KEY_FILE', 'TLS_CERT_FILE'])
        assert.throws(() => createWebServer(() => {}, { env: { ...tlsEnv, [missing]: '' } }), /configured together/);
    for (const env of [
        { ...tlsEnv, TLS_CERT_FILE: 'missing-secret-path.crt' },
        { ...tlsEnv, TLS_CERT_FILE: 'other.crt' },
    ]) {
        assert.throws(() => createWebServer(() => {}, { env, root: tlsRoot }), error => {
            assert.match(error.message, /Cannot start HTTPS/);
            assert.doesNotMatch(error.message, /missing-secret-path|BEGIN|fixtures|server\.key/);
            return true;
        });
    }
    assert.throws(() => createWebServer(() => {}, {
        env: tlsEnv, root: tlsRoot, read: () => 'PRIVATE_SECRET invalid PEM',
    }), error => !error.message.includes('PRIVATE_SECRET') && /Cannot start HTTPS/.test(error.message));
    const defaults = [];
    assert.throws(() => createWebServer(() => {}, {
        env: { USE_HTTPS: 'true' }, root: tlsRoot,
        read(path) { defaults.push(path); return 'invalid test PEM'; },
    }));
    assert.deepEqual(defaults, [join(tlsRoot, 'cert/selfsigned.key'), join(tlsRoot, 'cert/selfsigned.crt')]);
});

test('valid custom TLS pair serves an actual HTTPS request', async t => {
    const { server, useHttps } = createWebServer((_, res) => res.end('secure fixture'), { env: tlsEnv, root: tlsRoot });
    t.after(() => new Promise(resolve => server.close(resolve)));
    const port = await listen(server); assert.equal(useHttps, true);
    const body = await new Promise((resolve, reject) => {
        // Trust is relaxed only for this isolated request, never globally.
        httpsGet({ hostname: '127.0.0.1', port, rejectUnauthorized: false }, res => {
            let body = ''; res.on('data', chunk => { body += chunk; }); res.on('end', () => resolve(body));
        }).on('error', reject);
    });
    assert.equal(body, 'secure fixture');
});

test('readiness requires the configured legacy SFU and strips private snapshot details', async () => {
    let snapshot = { enabled: false, ready: false, unhealthy: false, clients: 17, address: 'secret-ip' };
    const screenSfu = { snapshot: () => snapshot };
    const get = createMediaReadiness({ screenSfu });
    assert.equal((await get()).mediaReady, true);
    snapshot = { ...snapshot, enabled: true };
    assert.equal((await get()).mediaReady, false);
    snapshot.ready = true; assert.equal((await get()).mediaReady, true);
    snapshot.unhealthy = true; assert.equal((await get()).mediaReady, false);
    snapshot = { ...snapshot, enabled: false, unhealthy: false };
    const invalid = createMediaReadiness({ screenSfu, sfuConfigValid: false });
    assert.equal((await invalid()).mediaReady, false);
    assert.doesNotMatch(JSON.stringify(await get()), /secret|clients|address/);
});

test('Piik readiness follows a real upstream response, failure and timeout', async t => {
    let mode = 'ok';
    const server = createServer((req, res) => {
        assert.equal(req.url, '/healthz');
        if (mode === 'timeout') return;
        res.writeHead(mode === 'ok' ? 200 : 503); res.end('{}');
    });
    t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
    const port = await listen(server);
    const get = createMediaReadiness({ piikEnabled: true, piikBaseURL: `http://127.0.0.1:${port}`,
        screenSfu: { snapshot: () => ({ enabled: false }) }, timeoutMs: 500 });
    assert.equal((await get()).mediaReady, true);
    mode = 'failed'; assert.equal((await get()).mediaReady, false);
    mode = 'timeout'; assert.equal((await get()).mediaReady, false);
    const offline = createMediaReadiness({ piikEnabled: true, piikBaseURL: 'invalid-url', screenSfu: { snapshot: () => ({}) } });
    assert.equal((await offline()).mediaReady, false);
});

test('SFU readiness remains false through startup, worker death, startup failure and closure', async t => {
    const config = readScreenSfuConfig({ SFU_ANNOUNCED_ADDRESS: '127.0.0.1' });
    const native = () => Object.assign(new EventEmitter(), { closed: false, close() { this.closed = true; } });
    const worker = native(), webRtcServer = native();
    let release;
    worker.createWebRtcServer = () => new Promise(resolve => { release = () => resolve(webRtcServer); });
    worker.getResourceUsage = async () => ({ ru_utime: 0, ru_stime: 0, ru_maxrss: 0 });
    const options = { config, createWorker: async () => worker, resourceSample: () => ({ memoryBytes: 1, freeBytes: 1e9, cpuPercent: 0 }), egressSample: () => 0 };
    const service = createScreenSfuService(options); t.after(() => service.close());
    assert.equal(service.snapshot().ready, false);
    const starting = service.start(); await Promise.resolve();
    assert.equal(service.snapshot().ready, false); release(); await starting;
    assert.equal(service.snapshot().ready, true);
    worker.emit('died'); assert.equal(service.snapshot().ready, false);
    service.close(); assert.equal(service.snapshot().ready, false);
    const failed = createScreenSfuService({ ...options, createWorker: async () => { throw Error('test unavailable'); } });
    t.after(() => failed.close());
    await assert.rejects(failed.start()); assert.equal(failed.snapshot().ready, false);
    const lateWorker = native();
    let finishWorker;
    const closing = createScreenSfuService({ ...options, createWorker: () => new Promise(resolve => { finishWorker = () => resolve(lateWorker); }) });
    t.after(() => closing.close());
    const pending = closing.start(); closing.close(); finishWorker();
    await assert.rejects(pending); assert.equal(closing.snapshot().ready, false); assert.equal(lateWorker.closed, true);
});

test('real mediasoup worker becomes ready on loopback and stops cleanly without media capture', { timeout: 10000 }, async t => {
    const reservation = reservePort(); const port = await listen(reservation);
    await new Promise(resolve => reservation.close(resolve));
    const service = createScreenSfuService({
        config: readScreenSfuConfig({ SFU_ANNOUNCED_ADDRESS: '127.0.0.1', SFU_LISTEN_IP: '127.0.0.1', SFU_PORT: port }),
        resourceSample: () => ({ memoryBytes: 1, freeBytes: 1e9, cpuPercent: 0 }), egressSample: () => 0,
    });
    t.after(() => service.close());
    const get = createMediaReadiness({ screenSfu: service });
    assert.equal((await get()).mediaReady, false);
    await service.start(); assert.equal((await get()).mediaReady, true);
    service.close(); assert.equal((await get()).mediaReady, false);
});

async function isolatedServer(t, overrides = {}) {
    const directory = mkdtempSync(join(tmpdir(), 'voice-readiness-'));
    const reservation = reservePort(); const port = await listen(reservation);
    await new Promise(resolve => reservation.close(resolve));
    let output = '';
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(SFU_|PIIK_|TLS_)/.test(key)));
    const child = spawn(process.execPath, ['--input-type=module', '-e',
        "await import(process.env.WEBRTC_TEST_SERVER); process.on('message', () => process.emit('SIGTERM'));"], {
        cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: { ...env, WEBRTC_TEST_SERVER: new URL('../src/server.js', import.meta.url).href,
            HOST: '127.0.0.1', PORT: String(port), USE_HTTPS: 'false', ENV: 'production',
            SFU_ENABLED: 'false', PIIK_ENABLED: 'false', CHAT_HISTORY_FILE: join(directory, 'history.json'), ...overrides },
    });
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
    const exited = once(child, 'exit');
    t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) { child.kill(); await exited; }
        rmSync(directory, { recursive: true, force: true });
    });
    return { child, exited, output: () => output, url: `http://127.0.0.1:${port}`,
        async ready() {
            for (let i = 0; i < 120; i++) {
                if (child.exitCode !== null) throw Error(output);
                try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) return; } catch { /* Still binding. */ }
                await new Promise(resolve => setTimeout(resolve, 30));
            }
            throw Error('Server startup timeout: ' + output);
        } };
}

test('real server fails TLS startup before listening and does not disclose configured paths', { timeout: 10000 }, async t => {
    const instance = await isolatedServer(t, { USE_HTTPS: 'true', TLS_KEY_FILE: 'secret-missing-key', TLS_CERT_FILE: 'secret-missing-cert' });
    const [code] = await instance.exited; assert.notEqual(code, 0);
    assert.match(instance.output(), /Cannot start HTTPS/);
    assert.doesNotMatch(instance.output(), /secret-missing|BEGIN PRIVATE KEY/);
    await assert.rejects(fetch(instance.url + '/healthz'));
});

for (const [name, overrides, expectedReady] of [
    ['P2P only', {}, true],
    ['invalid SFU config', { SFU_VIDEO_MBPS: '9999' }, false],
    ['configured worker cannot bind', { SFU_ENABLED: 'true', SFU_ANNOUNCED_ADDRESS: '127.0.0.1', SFU_LISTEN_IP: '203.0.113.254' }, false],
]) {
    test(`real server separates liveness and readiness: ${name}`, { timeout: 10000 }, async t => {
        const instance = await isolatedServer(t, overrides); await instance.ready();
        for (const route of ['healthz', 'readyz']) {
            const response = await fetch(instance.url + '/' + route), body = await response.json();
            assert.equal(response.status, route === 'healthz' || expectedReady ? 200 : 503);
            assert.equal(response.headers.get('cache-control'), 'no-store');
            assert.equal(body.ok, route === 'healthz' || expectedReady);
            assert.equal(body.mediaReady, expectedReady);
            assert.deepEqual(Object.keys(body.screenSfu).sort(), ['configValid', 'enabled', 'healthy', 'ready']);
            assert.doesNotMatch(JSON.stringify(body), /203\.0\.113|clients|publishers|sfu-unavailable/);
        }
        assert.equal((await fetch(instance.url + '/room/lobby')).status, 200);
    });
}
