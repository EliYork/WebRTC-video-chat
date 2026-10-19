/* eslint-disable no-await-in-loop -- One isolated desktop lifecycle. */
import { spawn } from 'node:child_process';
import {
    mkdtempSync,
    readFileSync,
    existsSync,
    mkdirSync,
    copyFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import { startPiikLocal } from './piik-local-service.mjs';
const work = mkdtempSync(join(tmpdir(), 'eliyork-desktop-'));
const listener = createServer().listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = listener.address().port;
await new Promise((done) => listener.close(done));
const origin = `http://127.0.0.1:${port}`;
const piik = await startPiikLocal();
let desktop;
const node = spawn(process.execPath, [resolve('src/server.js')], {
    cwd: work,
    windowsHide: true,
    stdio: 'pipe',
    env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: String(port),
        USE_HTTPS: 'false',
        SFU_ENABLED: 'false',
        PIIK_ENABLED: 'true',
        PIIK_INTERNAL_URL: piik.baseURL,
    },
});
let output = '';
node.stdout.on('data', (b) => (output += b));
node.stderr.on('data', (b) => (output += b));
try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
        try {
            ready = (await fetch(`${origin}/room/lobby`)).ok;
        } catch {
            /* Node may still be binding its listener. */
        }
        if (ready) break;
        await new Promise((done) => setTimeout(done, 100));
    }
    assert.ok(ready, output);
    const report = join(work, 'report.json');
    const packaged = process.argv[2];
    desktop = spawn(
        packaged ||
            resolve('desktop/windows/node_modules/electron/dist/electron.exe'),
        [...(packaged ? [] : [resolve('desktop/windows')]), '--smoke-test'],
        {
            windowsHide: true,
            stdio: 'pipe',
            env: {
                ...process.env,
                ELIYORK_TEST_ORIGIN: origin,
                ELIYORK_TEST_USER_DATA: work,
                ELIYORK_TEST_CAPTURE: resolve(
                    'integrations/piik/.build/synthetic-capture.exe'
                ),
                ELIYORK_TEST_REPORT: report,
            },
        }
    );
    desktop.stdout.on('data', (b) => (output += b));
    desktop.stderr.on('data', (b) => (output += b));
    const timeout = setTimeout(() => desktop.kill(), 60000);
    const [code] = await once(desktop, 'exit');
    clearTimeout(timeout);
    assert.ok(
        existsSync(report),
        `${output}\n${existsSync(join(work, 'desktop.log')) ? readFileSync(join(work, 'desktop.log'), 'utf8') : ''}`
    );
    const data = JSON.parse(readFileSync(report));
    assert.equal(code, 0, output);
    assert.equal(data.audioMuted, true);
    assert.equal(data.roomReady, true);
    assert.equal(data.nativeHealth, 200);
    assert.equal(data.clipboardWrite, true);
    assert.equal(data.diagnosticsCopied, true);
    assert.equal(data.clipboardReadDenied, true);
    assert.equal(data.updaterLoaded, true);
    assert.equal(data.qualityLabelFits, true);
    assert.throws(
        () => process.kill(data.nativePid, 0),
        'native App must exit with client'
    );
    const artifacts = resolve('integrations/piik/artifacts');
    mkdirSync(artifacts, { recursive: true });
    copyFileSync(report, join(artifacts, 'desktop-smoke.json'));
    process.stdout.write(
        `PASS hidden Electron: sandbox, original room, real diagnostics clipboard write/readback, clipboard read denial, updater load, fake media, muted output and App cleanup. Logs ${work}\n`
    );
} finally {
    desktop?.kill();
    node.kill();
    piik.close();
}
