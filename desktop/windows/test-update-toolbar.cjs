/* eslint-disable no-await-in-loop -- The same update session owns these sequential UI checks. */
const { app, BrowserWindow, ipcMain } = require('electron');
const { NsisUpdater } = require('electron-updater');
const { ElectronHttpExecutor } = require('electron-updater/out/electronHttpExecutor');
const { createUpdates } = require('./updater.cjs');
const { createServer } = require('node:http');
const { createHash } = require('node:crypto');
const { once } = require('node:events');
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');

const work = mkdtempSync(join(tmpdir(), 'voice-update-toolbar-'));
const artifacts = resolve(__dirname, '../../integrations/piik/artifacts/update-toolbar');
mkdirSync(artifacts, { recursive: true });
app.setPath('userData', join(work, 'profile'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('mute-audio');
app.on('window-all-closed', () => {});

const fixture = Buffer.from('Synthetic updater download. Never executed.');
const currentVersion = '0.1.8';
let version = currentVersion, downloads = 0, finishDownload, win, service, timer, periodic;
const order = [];
const styles = readFileSync(resolve(__dirname, '../../src/views/styles/startup.min.css'), 'utf8') +
    readFileSync(join(__dirname, 'titlebar.css'), 'utf8');
const server = createServer((request, response) => {
    if (request.url.endsWith('.css')) {
        response.setHeader('content-type', 'text/css');
        response.end(styles);
    } else if (request.url.startsWith('/room/')) {
        response.setHeader('content-type', 'text/html; charset=utf-8');
        response.end(`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/room.css">
            <header class="workspace-topbar"><div class="workspace-brand">
            <img class="workspace-mark" alt=""><strong>语音据点</strong></div>
            <div class="workspace-actions"><nav class="workspace-navigation">
            <button id="stageChannelsToggle">频道</button><button id="stageStageToggle">语音</button>
            <button id="stageChatToggle">收起聊天</button></nav></div></header>`);
    } else if (request.url.startsWith('/latest.yml')) {
        response.end(JSON.stringify({
            version,
            files: [{
                url: 'fixture.exe', size: fixture.length,
                sha512: createHash('sha512').update(fixture).digest('base64'),
            }],
            releaseDate: new Date().toISOString(),
        }));
    } else if (request.url.startsWith('/fixture.exe')) {
        downloads++;
        finishDownload = () => response.end(fixture);
    } else {
        response.writeHead(404).end();
    }
});
const finish = () => {
    clearTimeout(timer);
    service?.stop();
    if (win && !win.isDestroyed()) win.destroy();
    server.close();
};
const fail = error => {
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify({ passed: false, error: error.stack }, null, 2));
    finish();
    process.stderr.write(error.stack + '\n');
    app.exit(1);
};
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);

async function wait(check, label) {
    for (let i = 0; i < 240; i++) {
        if (await check()) return;
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw Error(`Timed out: ${label}`);
}

app.whenReady().then(async () => {
    timer = setTimeout(() => fail(Error('Update toolbar deadline')), 30000);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const config = join(work, 'update.yml');
    writeFileSync(config, JSON.stringify({
        provider: 'generic', url: origin, updaterCacheDirName: 'cache',
    }));
    const updater = new NsisUpdater(null, {
        version: currentVersion, name: 'voice-toolbar-test', isPackaged: true,
        appUpdateConfigPath: config, userDataPath: work, baseCachePath: work,
        whenReady: () => app.whenReady(), onQuit() {},
    });
    updater.httpExecutor = new ElectronHttpExecutor(() => {});
    updater.disableDifferentialDownload = true;
    updater.quitAndInstall = () => order.push('install');

    win = new BrowserWindow({
        show: false, width: 1280, height: 720, titleBarStyle: 'hidden',
        titleBarOverlay: { color: '#f4ebf0', symbolColor: '#49333f', height: 40 },
        webPreferences: {
            preload: join(__dirname, 'preload.cjs'),
            sandbox: true, contextIsolation: true, backgroundThrottling: false,
        },
    });
    win.webContents.setAudioMuted(true);
    service = createUpdates({
        updater, app: { getVersion: () => currentVersion }, window: () => null,
        log: () => {}, prepareInstall: async () => order.push('release'),
        timers: {
            setTimeout, clearTimeout,
            setInterval(fn, delay) { periodic = fn; return setInterval(fn, delay); }, clearInterval,
        },
    });
    const publish = ({ status, busy, version, progress, error }) => {
        win.webContents.send('voice:update-state', { status, busy, version, percent: progress?.percent, error });
    };
    service.subscribe(publish);
    win.webContents.on('did-finish-load', () => publish(service.snapshot()));
    ipcMain.handle('voice:update-toolbar-action', (event, action) => {
        assert.equal(event.senderFrame, win.webContents.mainFrame);
        assert.ok(['check', 'download', 'install'].includes(action));
        return service[action]();
    });
    const run = script => win.webContents.executeJavaScript(script);
    const button = 'document.querySelector(".desktop-update")';
    await win.loadURL(origin + '/room/lobby');
    assert.equal(await run(`${button}.hidden`), true);
    await wait(() => service.snapshot().status === 'current', 'startup check');
    assert.equal(await run(`${button}.hidden`), true);

    version = '0.1.9';
    periodic();
    await wait(() => run(`${button}.textContent === '更新' && !${button}.disabled`), 'background discovery');
    assert.equal(downloads, 0);
    assert.deepEqual(BrowserWindow.getAllWindows(), [win]);
    assert.equal(await run('typeof window.EliYorkDesktop.update'), 'undefined');
    await run(`${button}.click()`);
    assert.equal(downloads, 0, 'synthetic DOM events cannot start an update');
    const loaded = once(win.webContents, 'did-finish-load');
    win.webContents.reload();
    await loaded;
    await wait(() => run(`${button} && ${button}.textContent === '更新'`), 'offer restored on refresh');

    const layouts = [];
    for (const [width, height] of [[1280, 720], [800, 600]]) {
        win.setSize(width, height);
        await wait(() => run(`innerWidth >= ${width - 16} && innerWidth <= ${width}`), 'window resize');
        const layout = await run(`(() => {
            const button = ${button}, chat = document.querySelector('#stageChatToggle');
            const b = button.getBoundingClientRect(), c = chat.getBoundingClientRect();
            return { right: b.right, chatLeft: c.left, y: b.y, chatY: c.y, height: b.height, chatHeight: c.height,
                background: getComputedStyle(button).backgroundColor,
                noDrag: getComputedStyle(button).webkitAppRegion, immediateNeighbor: button.nextElementSibling === chat };
        })()`);
        assert.ok(layout.right < layout.chatLeft);
        assert.equal(layout.y, layout.chatY);
        assert.equal(layout.height, layout.chatHeight);
        assert.equal(layout.background, 'rgb(55, 107, 83)');
        assert.equal(layout.noDrag, 'no-drag');
        assert.equal(layout.immediateNeighbor, true);
        writeFileSync(join(artifacts, `available-${width}.png`), (await win.webContents.capturePage()).toPNG());
        layouts.push({ width, height, ...layout });
    }
    win.webContents.debugger.attach('1.3');
    const click = async () => {
        const point = await run(`(() => {
            const r = ${button}.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        })()`);
        for (const type of ['mousePressed', 'mouseReleased'])
            await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
    };
    await click();
    await wait(() => finishDownload, 'user starts download');
    assert.equal(await run(`${button}.disabled`), true);
    updater.emit('download-progress', { percent: 42, transferred: 42, total: 100, bytesPerSecond: 42 });
    await wait(() => run(`${button}.textContent === '下载 42%'`), 'progress');
    finishDownload();
    await wait(() => run(`${button}.textContent === '退出并安装' && !${button}.disabled`), 'verified download');
    assert.deepEqual(order, []);
    await run(`${button}.click()`);
    assert.deepEqual(order, [], 'synthetic DOM events cannot install');
    await click();
    await wait(() => order.includes('install'), 'explicit install handoff');
    assert.deepEqual(order, ['release', 'install']);
    assert.equal(downloads, 1);
    assert.equal(BrowserWindow.getAllWindows().length, 1);
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify({ passed: true, layouts, downloads, order }, null, 2));
    finish();
    process.stdout.write('PASS background checks, inline title bar, refresh, explicit download and install handoff.\n');
    app.quit();
}).catch(fail);
