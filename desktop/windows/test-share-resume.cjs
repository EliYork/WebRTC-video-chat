/* eslint-disable no-await-in-loop -- Sequential controlled promises exercise one isolated page without active windows. */
const { app, BrowserWindow } = require('electron');
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');
const work = mkdtempSync(join(tmpdir(), 'voice-share-resume-'));
const artifacts = resolve(__dirname, '../../integrations/piik/artifacts/share-resume');
mkdirSync(artifacts, { recursive: true });
app.setPath('userData', join(work, 'profile'));
app.commandLine.appendSwitch('mute-audio'); app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
let win, deadline;
const cleanup = () => { clearTimeout(deadline); win?.destroy(); };
const fail = error => {
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify({ passed: false, error: error.stack, work }, null, 2));
    process.stderr.write(String(error.stack || error)+'\n'); cleanup(); app.exit(1);
};
process.on('uncaughtException', fail); process.on('unhandledRejection', fail);

async function verifyRenderer() {
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    const sample = f => document.dispatchEvent(new CustomEvent('voice:share-sample', { detail: { tile: f.tile } }));
    const fixture = () => {
        document.body.replaceChildren();
        const root = document.createElement('main'), stage = document.createElement('div'), tile = document.createElement('article');
        const video = document.createElement('video'); stage.id = 'video-grid'; tile.id = 'fixture'; tile.className = 'is-stage-focus';
        tile.append(video); stage.append(tile); root.append(stage); document.body.append(root);
        const stream = new MediaStream(); video.srcObject = stream;
        let paused = true;
        Object.defineProperties(video, { paused: { get: () => paused }, readyState: { get: () => 2 }, videoWidth: { get: () => 1280 } });
        const source = {};
        const runtime = window.VoiceShareWatchStatus.createRuntime({ root, getSource: () => source }); runtime.init();
        return { runtime, tile, video, stream, source, setPaused: value => { paused = value; },
            button: tile.querySelector('button'), label: tile.querySelector('span') };
    };
    const results = [];
    for (const change of ['new-request', 'new-stream', 'stream-replaced-and-restored', 'already-playing', 'emptied-and-reused', 'played-then-paused', 'destroyed']) {
        const f = fixture(), pending = [];
        f.video.play = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
        f.button.click(); const synchronousPlay = pending.length === 1;
        if (change === 'new-request') f.button.click();
        if (change === 'new-stream') f.video.srcObject = new MediaStream();
        if (change === 'stream-replaced-and-restored') {
            f.video.srcObject = new MediaStream(); sample(f);
            f.video.srcObject = f.stream; sample(f);
        }
        if (change === 'already-playing') f.setPaused(false);
        if (change === 'emptied-and-reused') f.video.dispatchEvent(new Event('emptied'));
        if (change === 'played-then-paused') {
            f.setPaused(false); f.video.dispatchEvent(new Event('playing'));
            f.setPaused(true); f.video.dispatchEvent(new Event('pause'));
        }
        if (change === 'destroyed') f.runtime.destroy();
        const before = f.label.textContent;
        pending[0].reject(new Error('obsolete playback denied')); await settle();
        const after = f.label.textContent;
        let recovered = null;
        if (pending[1]) {
            f.setPaused(false); pending[1].resolve(); await settle(); recovered = f.label.textContent === '';
        }
        results.push({ change, synchronousPlay, before, after, recovered,
            samePlayer: f.tile.querySelector('video') === f.video });
        f.runtime.destroy();
    }
    const current = [];
    for (const failure of ['throw', 'reject']) {
        const f = fixture();
        f.video.play = () => {
            if (failure === 'throw') throw new Error('current play denied');
            return Promise.reject(new Error('current play denied'));
        };
        f.button.click(); await settle();
        const error = f.label.textContent, retryVisible = !f.button.hidden;
        await new Promise(resolve => setTimeout(resolve, 1100));
        f.video.dispatchEvent(new Event('resize')); sample(f);
        const retained = f.label.textContent === error;
        f.source.pc = { connectionState: 'disconnected' }; sample(f);
        const connectionPriority = f.tile.dataset.playbackState === 'reconnecting' && f.button.hidden;
        f.source.pc.connectionState = 'connected'; sample(f);
        const failureRestored = f.label.textContent === error;
        let finish;
        f.video.play = () => new Promise(resolve => { finish = resolve; });
        f.button.click(); const pendingCleared = f.label.textContent === '播放已暂停';
        f.setPaused(false); finish(); await settle();
        current.push({ failure, error, retryVisible, retained, connectionPriority, failureRestored, pendingCleared,
            recovered: f.label.textContent === '', sameStream: f.video.srcObject === f.stream });
        f.runtime.destroy();
    }
    const buffering = [], originalNow = Date.now;
    let now = 10000;
    Date.now = () => now;
    try {
        for (const change of ['emptied', 'ended', 'error', 'loadeddata', 'playing', 'new-stream', 'new-stream-waiting']) {
            const f = fixture();
            const sample = () => document.dispatchEvent(new CustomEvent('voice:share-sample', { detail: { tile: f.tile } }));
            try {
                f.setPaused(false); f.video.dispatchEvent(new Event('waiting')); now += 1000; sample();
                const before = f.tile.dataset.playbackState;
                if (change.startsWith('new-stream')) f.video.srcObject = new MediaStream();
                else f.video.dispatchEvent(new Event(change));
                if (change === 'new-stream-waiting') f.video.dispatchEvent(new Event('waiting'));
                sample();
                const after = f.tile.dataset.playbackState, clearedText = f.label.textContent === '';
                if (change !== 'new-stream-waiting') f.video.dispatchEvent(new Event('stalled'));
                now += 800; sample(); const withinDelay = f.tile.dataset.playbackState;
                now += 1; sample(); const afterDelay = f.tile.dataset.playbackState;
                f.video.dispatchEvent(new Event('playing'));
                buffering.push({ change, before, after, clearedText, withinDelay, afterDelay,
                    recovered: f.tile.dataset.playbackState, samePlayer: f.tile.querySelector('video') === f.video,
                    expectedStream: change.startsWith('new-stream') ? f.video.srcObject !== f.stream : f.video.srcObject === f.stream });
            } finally { f.runtime.destroy(); }
        }
    } finally { Date.now = originalNow; }
    return { results, current, buffering, mediaCapture: false, playbackStateControlled: true,
        documentVisibilityControlled: true, bufferingClockControlled: true };
}

app.whenReady().then(async () => {
    deadline = setTimeout(() => fail(new Error('Shared playback resume test exceeded 20 seconds')), 20000);
    win = new BrowserWindow({ show: false, width: 390, height: 844, webPreferences: {
        sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false,
    } });
    win.webContents.setAudioMuted(true); win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    const errors = [];
    await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><meta charset="utf-8"><title>Isolated playback recovery</title><body>'));
    await win.webContents.executeJavaScript('window.__resumeErrors=[];addEventListener("error",e=>window.__resumeErrors.push(e.message));addEventListener("unhandledrejection",e=>window.__resumeErrors.push(String(e.reason)));');
    await win.webContents.executeJavaScript(readFileSync(resolve(__dirname, '../../src/views/js/voice/share-watch-status.js'), 'utf8'));
    const result = await win.webContents.executeJavaScript('('+verifyRenderer.toString()+')()');
    errors.push(...await win.webContents.executeJavaScript('window.__resumeErrors'));
    assert.deepEqual(errors, []);
    for (const row of result.results) {
        assert.equal(row.synchronousPlay, true); assert.equal(row.before, row.after); assert.equal(row.samePlayer, true);
        if (row.recovered !== null) assert.equal(row.recovered, true);
    }
    for (const row of result.current) {
        assert.match(row.error, /未能恢复播放/); assert.equal(row.retryVisible, true);
        assert.equal(row.retained, true); assert.equal(row.connectionPriority, true);
        assert.equal(row.failureRestored, true); assert.equal(row.pendingCleared, true);
        assert.equal(row.recovered, true); assert.equal(row.sameStream, true);
    }
    for (const row of result.buffering) {
        assert.equal(row.before, 'buffering'); assert.equal(row.after, 'playing'); assert.equal(row.clearedText, true);
        assert.equal(row.withinDelay, 'playing'); assert.equal(row.afterDelay, 'buffering'); assert.equal(row.recovered, 'playing');
        assert.equal(row.samePlayer, true); assert.equal(row.expectedStream, true);
    }
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify({ passed: true, hidden: !win.isVisible(),
        muted: win.webContents.isAudioMuted(), ...result, errors, work }, null, 2));
    cleanup(); process.stdout.write('PASS hidden shared playback resume ownership, retry and buffering lifecycle. Controlled playback state and clock, no media capture.\n'); app.quit();
}).catch(fail);
