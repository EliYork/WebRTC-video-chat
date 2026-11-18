/* eslint-disable no-console, no-await-in-loop -- Isolated cold profiles use the same server and network. */
const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createServer } = require('node:http');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { gzipSync } = require('node:zlib');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { build } = require('esbuild');
const root = resolve(__dirname, '../..');
const work = mkdtempSync(join(tmpdir(), 'voice-desktop-startup-'));
const artifacts = join(root, 'integrations/piik/artifacts/desktop-startup');
mkdirSync(artifacts, { recursive: true });
app.setPath('userData', join(work, 'profile'));
app.commandLine.appendSwitch('mute-audio');
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
const delay = ms => new Promise(done => setTimeout(done, ms));
const listen = async server => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port; };
const wait = async fn => {
    for (let i = 0; i < 900; i++) { if (await fn()) return; await delay(50); }
    throw Error('Desktop startup condition timed out');
};
const windows = [], proxies = [], pendingDelays = new Map();
let backend, piik, logs = '';
const cleanup = async () => {
    for (const win of windows) if (!win.isDestroyed()) win.destroy();
    for (const [timer, done] of pendingDelays) { clearTimeout(timer); done(); }
    for (const proxy of proxies) { proxy.closeAllConnections(); proxy.close(); }
    for (const processHandle of [backend, piik?.process]) {
        if (processHandle && processHandle.exitCode === null) {
            const ended = once(processHandle, 'exit'); processHandle.kill(); await ended;
        }
    }
};
app.whenReady().then(async () => {
    try {
        const { piikClientOverlay } = await import(pathToFileURL(join(root, 'scripts/piik-client-overlay.mjs')));
        const { startPiikLocal } = await import(pathToFileURL(join(root, 'scripts/piik-local-service.mjs')));
        const baseline = await build({
            entryPoints: [join(root, 'integrations/piik/client.ts')], bundle: true, write: false,
            format: 'iife', platform: 'browser', target: 'es2022', plugins: [piikClientOverlay],
            define: { 'import.meta.url': '"/vendor/piik-client.js"', 'import.meta.env': '{}' }, legalComments: 'eof',
        });
        piik = await startPiikLocal();
        const reservation = createServer(); const port = await listen(reservation);
        await new Promise(done => reservation.close(done));
        const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(TURN_|SFU_|PIIK_|TLS_)/.test(key)));
        backend = spawn(process.execPath, [join(root, 'src/server.js')], {
            cwd: work, windowsHide: true, stdio: 'pipe',
            env: { ...env, ELECTRON_RUN_AS_NODE: '1', HOST: '127.0.0.1', PORT: String(port), USE_HTTPS: 'false', ENV: 'production', SFU_ENABLED: 'false', PIIK_ENABLED: 'true', PIIK_INTERNAL_URL: piik.baseURL, CHAT_HISTORY_FILE: join(work, 'history.json') },
        });
        backend.stdout.on('data', value => { logs += value; }); backend.stderr.on('data', value => { logs += value; });
        await wait(async () => { try { return (await fetch(`http://127.0.0.1:${port}/readyz`)).ok; } catch { return false; } });
        const results = [];
        for (const mode of ['before', 'after', 'error', 'stalled', 'style-error', 'style-stalled']) {
            console.log('Checking desktop ' + mode);
            let navigations = 0;
            const proxy = createServer(async (req, res) => {
                try {
                    const path = new URL(req.url, 'http://local').pathname;
                    if (path === '/room/lobby') navigations++;
                    if ((path === '/vendor/piik-client.js' && mode === 'error') || (path === '/style.css' && mode === 'style-error')) {
                        res.writeHead(503); res.end('Controlled failure'); return;
                    }
                    if ((path === '/js/room/boot-runtime.js' && mode === 'stalled') ||
                        (path === '/style.css' && mode === 'style-stalled' && navigations === 1)) {
                        await new Promise(done => { const timer = setTimeout(() => { pendingDelays.delete(timer); done(); }, 40000); pendingDelays.set(timer, done); });
                        if (res.destroyed) return;
                    }
                    const response = await fetch(`http://127.0.0.1:${port}${req.url}`);
                    const headers = Object.fromEntries(response.headers);
                    delete headers['content-length']; delete headers['transfer-encoding']; delete headers['content-encoding'];
                    let body = Buffer.from(await response.arrayBuffer());
                    if (mode === 'before' && path === '/vendor/piik-client.js') body = Buffer.from(baseline.outputFiles[0].contents);
                    if (mode === 'before' && path === '/room/lobby') {
                        body = Buffer.from(body.toString().replace(/<script nonce="[^"]+">\(function exposeRoomBoot[\s\S]*?<\/script>/, '<script src="/js/shared/room-boot.js?v=baseline"></script>')
                            .replace('<script defer src="/vendor/piik-client.js">', '<script defer src="/vendor/screen-sfu-client.js"></script><script defer src="/vendor/piik-client.js">'));
                    }
                    if (/gzip/.test(req.headers['accept-encoding'] || '') && /text|javascript|json/.test(headers['content-type'] || '')) {
                        body = gzipSync(body); headers['content-encoding'] = 'gzip'; headers.vary = 'Accept-Encoding';
                    }
                    headers['cache-control'] = 'no-store'; res.writeHead(response.status, headers); res.end(body);
                } catch (error) { if (!res.headersSent) res.writeHead(500); res.end(String(error)); }
            });
            proxies.push(proxy); const proxyPort = await listen(proxy);
            const win = new BrowserWindow({ show: false, width: 1440, height: 900, webPreferences: { partition: 'desktop-startup-' + mode, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
            windows.push(win); win.webContents.setAudioMuted(true);
            win.webContents.session.setPermissionRequestHandler((_w, _p, cb) => cb(false));
            await win.loadURL('about:blank'); win.webContents.debugger.attach('1.3');
            const cdp = (method, params = {}) => win.webContents.debugger.sendCommand(method, params);
            const evaluate = async expression => {
                const result = await cdp('Runtime.evaluate', { expression, returnByValue: true });
                if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
                return result.result.value;
            };
            const exceptions = [];
            win.webContents.debugger.on('message', (_e, method, params) => { if (method === 'Runtime.exceptionThrown') exceptions.push(params.exceptionDetails.text); });
            await cdp('Network.enable'); await cdp('Runtime.enable'); await cdp('Network.setCacheDisabled', { cacheDisabled: true });
            if (mode === 'before' || mode === 'after') await cdp('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 128 * 1024, uploadThroughput: 64 * 1024 });
            if (mode === 'style-stalled') await cdp('Page.addScriptToEvaluateOnNewDocument', {
                source: 'const schedule = window.setTimeout; window.setTimeout = (fn, ms, ...args) => schedule(fn, ms === 30000 ? 2000 : ms, ...args);',
            });
            // Attach rejection handling immediately: the stalled scenario reloads during navigation.
            const navigation = win.loadURL(`http://127.0.0.1:${proxyPort}/room/lobby`).catch(error => error);
            if (mode === 'stalled' || mode === 'style-stalled') {
                await wait(() => evaluate(`document.documentElement?.dataset.roomBoot === 'stalled'`));
                const state = await evaluate(`({state:document.documentElement.dataset.roomBoot,domPending:document.readyState==='interactive',reloadVisible:getComputedStyle(document.querySelector('[data-room-reload]')).display!=='none',inert:document.querySelector('#main').inert})`);
                assert.equal(state.domPending, true); assert.equal(state.reloadVisible, true); assert.equal(state.inert, true);
                await evaluate(`document.querySelector('[data-room-reload]').click()`);
                await wait(() => navigations >= 2);
                if (mode === 'style-stalled') await wait(() => evaluate(`document.documentElement?.dataset.roomBoot === 'ready'`));
                results.push({ mode, ...state, reloadNavigated: true }); win.destroy(); continue;
            }
            const navigated = await navigation; if (navigated instanceof Error) throw navigated;
            if (mode === 'error' || mode === 'style-error') {
                assert.equal(await evaluate(`document.documentElement.dataset.roomBoot`), 'fallback');
                assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-room-reload]')).display !== 'none'`), true);
                assert.equal(await evaluate(`document.querySelector('#main').inert`), true);
                results.push({ mode, fallback: true }); win.destroy(); continue;
            }
            await wait(() => evaluate(`document.documentElement.dataset.roomBoot === 'ready'`));
            assert.deepEqual(exceptions, []);
            const state = await evaluate(`({readyMs:performance.getEntriesByName('voice-room-ready')[0].startTime,inert:document.querySelector('#main').inert,piik:!!window.PiikScreenMedia,resources:performance.getEntriesByType('resource').filter(r=>['script','css','link'].includes(r.initiatorType)).map(r=>({path:new URL(r.name).pathname,bytes:r.transferSize}))})`);
            assert.equal(state.inert, false); assert.equal(state.piik, true);
            if (mode === 'after') {
                assert.equal(state.resources.some(r => /screen-sfu-client|shared\/room-boot/.test(r.path)), false);
                writeFileSync(join(artifacts, 'desktop-ready.png'), (await win.webContents.capturePage()).toPNG());
            }
            results.push({ mode, ...state }); win.destroy();
        }
        const before = results.find(r => r.mode === 'before'), after = results.find(r => r.mode === 'after');
        const bytes = sample => sample.resources.reduce((total, r) => total + r.bytes, 0);
        assert.ok(bytes(after) < bytes(before) - 70000);
        writeFileSync(join(artifacts, 'result.json'), JSON.stringify({ passed: true, network: { latencyMs: 150, downloadKiBps: 128 }, results }, null, 2));
        console.log(JSON.stringify({ passed: true, beforeMs: before.readyMs, afterMs: after.readyMs, beforeBytes: bytes(before), afterBytes: bytes(after) }));
        await cleanup(); app.quit();
    } catch (error) {
        writeFileSync(join(artifacts, 'result.json'), JSON.stringify({ passed: false, error: error.stack, logs }, null, 2));
        console.error(error); await cleanup(); app.exit(1);
    }
});
