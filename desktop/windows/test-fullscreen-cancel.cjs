/* eslint-disable no-await-in-loop -- Sequential scenarios share one isolated document and control request ownership. */
const { app, BrowserWindow } = require('electron');
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');

const work = mkdtempSync(join(tmpdir(), 'voice-fullscreen-cancel-'));
const artifacts = resolve(__dirname, '../../integrations/piik/artifacts/fullscreen-cancel');
mkdirSync(artifacts, { recursive: true });
app.setPath('userData', join(work, 'profile'));
app.commandLine.appendSwitch('mute-audio'); app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
let win, deadline;
const cleanup = () => { clearTimeout(deadline); win?.destroy(); };
const fail = error => {
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify({ passed: false, error: error.stack, work }, null, 2));
    process.stderr.write(String(error.stack || error) + '\n'); cleanup(); app.exit(1);
};
process.on('uncaughtException', fail); process.on('unhandledRejection', fail);

async function verifyRenderer() {
    const api = window.VoiceFullscreenControls;
    let fullscreen = null, exits = 0;
    // Model browser completion order without entering OS fullscreen or showing a window.
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreen });
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: async () => {
        fullscreen = null; exits++; document.dispatchEvent(new Event('fullscreenchange'));
    } });
    const fixture = () => {
        api.destroy(); document.body.replaceChildren();
        const tile = document.createElement('article'), actions = document.createElement('div'), video = document.createElement('video');
        tile.className = 'video-tile'; actions.className = 'tile-header-actions';
        tile.style.cssText = 'width:320px;height:180px';
        const stream = new MediaStream(); video.srcObject = stream;
        tile.append(video, actions); document.body.append(tile);
        api.bindFullscreenChange(); api.attachTileButton({ tile, actions });
        let finish, reject;
        tile.requestFullscreen = () => new Promise((resolve, fail) => {
            finish = () => { fullscreen = tile; document.dispatchEvent(new Event('fullscreenchange')); resolve(); };
            reject = fail;
        });
        return { tile, video, stream, finish: () => finish(), reject: () => reject(new Error('obsolete request rejected')) };
    };
    const results = [];
    for (const cancel of ['exit', 'detach', 'destroy']) {
        const f = fixture(), before = exits;
        const pending = api.toggleTileFullscreen({ tile: f.tile });
        if (cancel === 'exit') api.exitTileFullscreen(f.tile);
        if (cancel === 'detach') api.detachTile(f.tile);
        if (cancel === 'destroy') api.destroy();
        f.finish();
        const accepted = await pending;
        results.push({ cancel, accepted, fullscreen: fullscreen === f.tile, exits: exits-before,
            layoutBlocked: api.isTileLayoutWriteBlocked(f.tile), samePlayer: f.tile.querySelector('video') === f.video,
            sameStream: f.video.srcObject === f.stream });
    }
    for (const completion of ['resolve', 'reject']) {
        const f = fixture(), before = exits, errors = [];
        const old = api.toggleTileFullscreen({ tile: f.tile, onError: error => errors.push(error.message) });
        api.exitTileFullscreen(f.tile);
        f.tile.requestFullscreen = async () => { fullscreen = f.tile; document.dispatchEvent(new Event('fullscreenchange')); };
        const current = await api.toggleTileFullscreen({ tile: f.tile });
        if (completion === 'resolve') f.finish(); else f.reject();
        const accepted = await old;
        results.push({ completion, accepted, current, fullscreen: fullscreen === f.tile, exits: exits-before, errors });
    }
    {
        const f = fixture(), before = exits, errors = [];
        let finish;
        f.tile.requestFullscreen = () => new Promise(resolve => { finish = resolve; });
        const old = api.toggleTileFullscreen({ tile: f.tile, onError: error => errors.push(error.message) });
        const other = document.createElement('article'); other.append(document.createElement('video')); document.body.append(other);
        api.attachTileButton({ tile: other });
        other.requestFullscreen = async () => { fullscreen = other; document.dispatchEvent(new Event('fullscreenchange')); };
        const current = await api.toggleTileFullscreen({ tile: other });
        finish(); const accepted = await old;
        results.push({ completion: 'another-tile', accepted, current, fullscreen: fullscreen === other, exits: exits-before, errors });
    }
    const f = fixture(), before = exits;
    const pending = api.toggleTileFullscreen({ tile: f.tile });
    f.tile.querySelector('.web-fullscreen-btn').click(); f.finish();
    const accepted = await pending;
    const web = { accepted, nativeFullscreen: fullscreen === f.tile, webFullscreen: f.tile.classList.contains('is-web-fullscreen'),
        exits: exits-before, samePlayer: f.tile.querySelector('video') === f.video, sameStream: f.video.srcObject === f.stream };
    api.destroy();
    return { results, web, nativeFullscreenApiInvoked: false, mediaCapture: false };
}

app.whenReady().then(async () => {
    deadline = setTimeout(() => fail(new Error('Fullscreen cancellation test exceeded 20 seconds')), 20000);
    win = new BrowserWindow({ show: false, width: 390, height: 844, webPreferences: {
        sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false,
    } });
    win.webContents.setAudioMuted(true); win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><meta charset="utf-8"><title>Isolated fullscreen cancellation</title><body>'));
    for (const file of ['shared/view-utils.js', 'media/fullscreen-controls.js']) {
        await win.webContents.executeJavaScript(readFileSync(resolve(__dirname, '../../src/views/js', file), 'utf8'));
    }
    const result = await win.webContents.executeJavaScript('('+verifyRenderer.toString()+')()');
    for (const row of result.results) {
        assert.equal(row.accepted, false);
        if (row.cancel) {
            assert.equal(row.fullscreen, false); assert.equal(row.exits, 1); assert.equal(row.layoutBlocked, false);
            assert.equal(row.samePlayer, true); assert.equal(row.sameStream, true);
        } else {
            assert.equal(row.current, true); assert.equal(row.fullscreen, true); assert.equal(row.exits, 0); assert.deepEqual(row.errors, []);
        }
    }
    assert.equal(result.web.accepted, false); assert.equal(result.web.nativeFullscreen, false);
    assert.equal(result.web.webFullscreen, true); assert.equal(result.web.exits, 1);
    assert.equal(result.web.samePlayer, true); assert.equal(result.web.sameStream, true);
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify({ passed: true, hidden: !win.isVisible(),
        muted: win.webContents.isAudioMuted(), ...result, work }, null, 2));
    cleanup(); process.stdout.write('PASS hidden fullscreen request cancellation with controlled browser API completion. No OS fullscreen or media capture.\n'); app.quit();
}).catch(fail);
