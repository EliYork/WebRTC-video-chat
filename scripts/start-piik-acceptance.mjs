/* eslint-disable no-await-in-loop -- Sequential readiness and shutdown. */
// Local acceptance only. No browser, input injection, capture, certificate
// installation or firewall changes. Capture starts only from the channel UI.
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { resolve, join } from 'node:path';
import {
    existsSync,
    readFileSync,
    mkdirSync,
    mkdtempSync,
    writeFileSync,
    createWriteStream,
} from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { createSecureContext } from 'node:tls';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';
import { startPiikLocal } from './piik-local-service.mjs';

const { values } = parseArgs({
    options: {
        origin: { type: 'string', default: 'http://localhost:3300' },
        'capture-process': { type: 'string' },
        help: { type: 'boolean' },
    },
});
if (values.help) {
    process.stdout.write(
        'npm run dev:piik:acceptance -- --origin https://LAN-IP:3443\nDefault: http://localhost:3300 (Windows only). Ctrl+C stops owned processes.\n'
    );
    process.exit(0);
}
const root = resolve(import.meta.dirname, '..');
const build = join(root, 'integrations/piik/.build');
const url = new URL(values.origin);
if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
)
    throw new Error(
        '--origin must be a plain HTTP(S) origin, without a room path'
    );
const hostname = url.hostname.replace(/^\[|\]$/g, '');
const local = ['localhost', '127.0.0.1', '::1'].includes(hostname);
if (!local && url.protocol !== 'https:')
    throw new Error(
        'LAN acceptance requires HTTPS; use localhost HTTP for Windows-only checks'
    );
const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
const capture = resolve(
    values['capture-process'] || join(build, 'runtime/native/piik-capture.exe')
);
for (const path of [
    join(build, 'piik-server.exe'),
    join(build, 'piik-app.exe'),
    capture,
    join(build, 'client.js'),
    join(build, 'protocol.mjs'),
]) {
    if (!existsSync(path))
        throw new Error(`Missing ${path}; run npm run build:piik:app`);
}
let certificate;
if (url.protocol === 'https:') {
    const cert = readFileSync(join(root, 'cert/selfsigned.crt'));
    const key = readFileSync(join(root, 'cert/selfsigned.key'));
    createSecureContext({ cert, key }); // Reject invalid/mismatched keys before starting children.
    certificate = new X509Certificate(cert);
    const matches = isIP(hostname)
        ? certificate.checkIP(hostname)
        : certificate.checkHost(hostname, { subject: 'never' });
    if (
        !matches ||
        Date.now() < Date.parse(certificate.validFrom) ||
        Date.now() > Date.parse(certificate.validTo)
    )
        throw new Error(
            'HTTPS certificate must be current and include the origin host in its SAN'
        );
}
mkdirSync(join(build, 'acceptance'), { recursive: true });
const session = mkdtempSync(join(build, 'acceptance/run-'));
const children = [];
const logs = [];
let stopping;
let app;
const manifest = (stopped = false) =>
    writeFileSync(
        join(session, 'processes.json'),
        JSON.stringify(
            {
                origin: url.origin,
                launcherPid: process.pid,
                stopped,
                processes: children.map(({ label, child }) => ({
                    label,
                    pid: child.pid,
                    exited: child.exitCode !== null || child.signalCode !== null,
                })),
            },
            null,
            2
        )
    );
async function waitExit(child, milliseconds) {
    if (child.exitCode !== null || child.signalCode !== null) return true;
    let timer;
    const ended = () => child.off('exit', onExit);
    let onExit;
    const result = await Promise.race([
        new Promise((done) => {
            onExit = () => done(true);
            child.once('exit', onExit);
        }),
        new Promise((done) => {
            timer = setTimeout(() => done(false), milliseconds);
        }),
    ]);
    clearTimeout(timer);
    ended();
    return result;
}
function stop(code = 0) {
    if (stopping) return stopping;
    stopping = (async () => {
        // App gets its upstream cancellation command first, releasing WGC/MFT/Pion.
        if (app?.exitCode === null) {
            app.stdin.end('\n');
            if (!(await waitExit(app, 10000))) {
                const killer = spawn(
                    'taskkill.exe',
                    ['/PID', String(app.pid), '/T', '/F'],
                    { windowsHide: true, stdio: 'ignore' }
                );
                await waitExit(killer, 3000);
            }
        }
        for (const { child } of children) {
            if (child.exitCode === null && child.signalCode === null)
                child.kill();
            await waitExit(child, 3000);
        }
        manifest(true);
        for (const log of logs) log.end();
        process.stdin.pause();
        process.stdout.write(
            `Stopped this acceptance session. Logs retained: ${session}\n`
        );
        process.exitCode = code;
    })();
    return stopping;
}
function track(label, child) {
    children.push({ label, child });
    child.on('error', (error) => {
        process.stderr.write(`${label}: ${error.message}\n`);
        void stop(1);
    });
    child.on('exit', () => {
        if (!stopping) void stop(1);
    });
    return child;
}
function logTo(name, stream) {
    const file = createWriteStream(join(session, name));
    logs.push(file);
    stream.pipe(file, { end: false });
    return file;
}
function ready() {
    return new Promise((done) => {
        // HTTPS readiness pins the exact preflighted certificate. This checks
        // our local listener, not Windows/Android CA trust (a manual gate).
        const req = (certificate ? https : http).get(
            {
                hostname: isIP(hostname) ? hostname : '127.0.0.1',
                port,
                path: '/room/lobby',
                rejectUnauthorized: false,
            },
            (res) => {
                const matches =
                    !certificate ||
                    res.socket.getPeerCertificate().fingerprint256 ===
                        certificate.fingerprint256;
                res.resume();
                done(matches && res.statusCode === 200);
            }
        );
        req.setTimeout(700, () => req.destroy());
        req.on('error', () => done(false));
    });
}
process.on('SIGINT', () => {
    void stop();
});
process.on('SIGTERM', () => {
    void stop();
});
process.stdin.on('data', (bytes) => {
    if (bytes.toString().trim().toLowerCase() === 'q') void stop();
});
try {
    const piik = await startPiikLocal();
    if (stopping) {
        piik.close();
        throw new Error('Startup cancelled');
    }
    track('Piik Go', piik.process);
    logTo('go-stdout.log', piik.process.stdout);
    logTo('go-stderr.log', piik.process.stderr);
    const platform = track(
        'Node',
        spawn(process.execPath, [join(root, 'src/server.js')], {
            cwd: session,
            windowsHide: true,
            stdio: 'pipe',
            env: {
                ...process.env,
                HOST:
                    hostname === 'localhost'
                        ? '127.0.0.1'
                        : isIP(hostname)
                          ? hostname
                          : '0.0.0.0',
                PORT: String(port),
                USE_HTTPS: String(!!certificate),
                PIIK_ENABLED: 'true',
                PIIK_INTERNAL_URL: piik.baseURL,
                SFU_ENABLED: 'false',
                ENV: 'dev',
                CHAT_HISTORY_FILE: join(session, 'chat-history.json'),
            },
        })
    );
    logTo('node-stdout.log', platform.stdout);
    logTo('node-stderr.log', platform.stderr);
    let listening = false;
    platform.stdout.on('data', (bytes) => {
        if (bytes.toString().includes('Listening at ')) listening = true;
    });
    let platformReady = false;
    for (let i = 0; i < 100 && !stopping; i++) {
        if (listening && (await ready())) {
            platformReady = true;
            break;
        }
        await delay(100);
    }
    if (!platformReady || stopping)
        throw new Error(`Node did not become ready; inspect ${session}`);
    app = track(
        'Piik App',
        spawn(
            join(build, 'piik-app.exe'),
            [
                '--site',
                url.origin,
                '--config',
                join(session, 'app.json'),
                '--debug',
                '--log-dir',
                join(session, 'app-logs'),
                '--capture-process',
                capture,
            ],
            {
                cwd: session,
                windowsHide: true,
                stdio: 'pipe',
                env: { ...process.env, PIIK_CLIENT_GATE_NO_BROWSER: 'true' },
            }
        )
    );
    // Endpoint stdout includes a control capability: keep it in memory, never log it.
    let endpoint = '';
    app.stdout.on('data', (bytes) => {
        endpoint = (endpoint + bytes).slice(-65536);
    });
    app.stdin.on('error', () => {}); // Exit can race the cancellation byte.
    logTo('app-stderr.log', app.stderr);
    let appReady = false;
    for (let i = 0; i < 300 && !stopping; i++) {
        if (endpoint.includes('instanceToken')) {
            appReady = true;
            break;
        }
        await delay(100);
    }
    if (!appReady || stopping)
        throw new Error(`App did not become ready; inspect ${session}`);
    manifest();
    process.stdout.write(
        `Ready: ${url.origin}/room/lobby\nNode ${platform.pid}; Piik Go ${piik.process.pid}; App ${app.pid}\nLogs: ${session}\nNo browser opened. Select App native sharing in the original channel. Ctrl+C or q + Enter stops this session.\n`
    );
    if (certificate)
        process.stdout.write(
            'HTTPS certificate matched. Windows and Android CA trust must still be verified in each browser.\n'
        );
    if (values['capture-process'])
        process.stdout.write(
            'Custom capture process selected; this is not evidence of physical WGC/hardware encoding.\n'
        );
} catch (error) {
    process.stderr.write(`${error.message}\n`);
    await stop(1);
}
