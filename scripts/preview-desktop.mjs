// User-started local UI acceptance. Does not open an existing browser, install
// anything, change production, or capture media before the user chooses it.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, createWriteStream, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { startPiikLocal } from './piik-local-service.mjs';

const root = resolve(import.meta.dirname, '..');
const directory = join(root, 'integrations/piik/.build/ui-preview');
mkdirSync(directory, { recursive: true });
const work = mkdtempSync(join(directory, 'run-'));
const log = createWriteStream(join(work, 'preview.log'));
const listener = createServer().listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = listener.address().port;
await new Promise(done => listener.close(done));
const origin = `http://127.0.0.1:${port}`;
const checking = process.argv.includes('--check');
let piik, server, client;
let closing = false;
function stop() {
    if (closing) return;
    closing = true;
    client?.stdout.unpipe(log);
    client?.stderr.unpipe(log);
    server?.stdout.unpipe(log);
    server?.stderr.unpipe(log);
    piik?.process.stderr.unpipe(log);
    client?.kill();
    server?.kill();
    piik?.close();
    log.end();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
try {
    piik = await startPiikLocal();
    piik.process.stderr.pipe(log, { end: false });
    server = spawn(process.execPath, [join(root, 'src/server.js')], {
        cwd: work, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), USE_HTTPS: 'false',
            ENV: 'production', SFU_ENABLED: 'false', PIIK_ENABLED: 'true',
            PIIK_INTERNAL_URL: piik.baseURL, CHAT_HISTORY_FILE: join(work, 'chat-history.json') },
    });
    server.on('error', error => { log.write(error.stack); stop(); });
    server.on('exit', stop);
    server.stdout.pipe(log, { end: false });
    server.stderr.pipe(log, { end: false });
    let ready = false;
    for (let i = 0; i < 100 && !closing; i++) {
        // eslint-disable-next-line no-await-in-loop -- Wait for this local service.
        try { ready = (await fetch(`${origin}/room/lobby`)).ok; } catch { /* binding */ }
        if (ready) break;
        // eslint-disable-next-line no-await-in-loop -- Bound startup wait.
        await delay(100);
    }
    if (!ready || closing) throw Error('Local preview server failed; see preview.log');
    writeFileSync(join(directory, 'latest.txt'), `${work}\n${origin}\n`);
    client = spawn(join(root, 'desktop/windows/node_modules/electron/dist/electron.exe'),
        [join(root, 'desktop/windows'), `--preview-origin=${origin}`, ...(checking ? ['--smoke-test'] : [])], {
            cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, ELIYORK_PREVIEW_USER_DATA: join(work, 'profile'),
                ...(checking ? { ELIYORK_TEST_ORIGIN: origin, ELIYORK_TEST_USER_DATA: join(work, 'profile'),
                    ELIYORK_TEST_CAPTURE: join(root, 'integrations/piik/.build/synthetic-capture.exe'),
                    ELIYORK_TEST_REPORT: join(work, 'report.json') } : {}) },
        });
    client.stdout.pipe(log, { end: false });
    client.stderr.pipe(log, { end: false });
    client.on('error', error => { log.write(error.stack); stop(); });
    client.on('exit', code => { if (code) process.exitCode = code; stop(); });
} catch (error) {
    log.write(error.stack);
    process.exitCode = 1;
    stop();
}
