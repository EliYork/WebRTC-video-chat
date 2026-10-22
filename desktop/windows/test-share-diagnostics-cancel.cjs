/* eslint-disable no-await-in-loop -- Exercise ordered completion of controlled stats on one isolated page. */
const { app, BrowserWindow } = require('electron');
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');
const work = mkdtempSync(join(tmpdir(), 'share-diagnostics-cancel-'));
const artifacts = resolve(__dirname, '../../integrations/piik/artifacts/share-diagnostics-cancel');
mkdirSync(artifacts, { recursive: true });
app.setPath('userData', join(work, 'profile'));
app.commandLine.appendSwitch('mute-audio'); app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
let win, deadline, result;
const cleanup = () => { clearTimeout(deadline); win?.destroy(); };
const fail = error => {
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify({ passed: false, error: error.stack, result, work }, null, 2));
    process.stderr.write(String(error.stack || error) + '\n'); cleanup(); app.exit(1);
};
process.on('uncaughtException', fail); process.on('unhandledRejection', fail);

async function verifyRenderer() {
    const api = window.VoiceShareDiagnostics;
    const nativeSetTimeout = window.setTimeout, nativeClearTimeout = window.clearTimeout;
    const timers = new Set();
    const settle = () => new Promise(resolve => nativeSetTimeout(resolve, 0));
    window.setTimeout = (callback, delay) => {
        const id = nativeSetTimeout(() => { timers.delete(id); callback(); }, delay);
        timers.add(id); return id;
    };
    window.clearTimeout = id => { timers.delete(id); nativeClearTimeout(id); };
    let published = 0, observed = 0;
    window.VoiceScreenCodecs = { observeConnection: () => observed++ };
    const fixture = () => {
        const tile = document.createElement('article'), video = document.createElement('video');
        video.muted = true;
        const stream = new MediaStream(); video.srcObject = stream;
        tile.append(video); document.body.append(tile);
        const requests = [];
        const pc = { getStats: () => new Promise((resolve, reject) => requests.push({ resolve, reject })) };
        const input = { tile, video, stream, pc, isScreenSharing: true, onSample: () => published++ };
        return { input, requests, destroy: () => { api.remove(tile); tile.remove(); } };
    };
    try {
        const removed = [];
        for (const outcome of ['resolve', 'reject']) {
            const f = fixture();
            let settled = false;
            const pending = api.sync(f.input, { force: true }); pending.then(() => { settled = true; });
            await settle(); const before = timers.size;
            f.destroy(); const immediately = timers.size; await settle();
            const settledBeforeStats = settled;
            f.requests[0][outcome](outcome === 'resolve' ? new Map() : Error('late private stats'));
            const oldResult = await pending; await settle();
            removed.push({ outcome, before, immediately, settledBeforeStats,
                cancelled: oldResult === undefined, published, observed, cached: Boolean(api.getCached(f.input.tile)),
                sameVideo: f.input.tile.querySelector('video') === f.input.video,
                sameStream: f.input.video.srcObject === f.input.stream });
        }

        const f = fixture();
        const old = api.sync(f.input, { force: true }); await settle();
        const nextStream = new MediaStream(); f.input.video.srcObject = nextStream;
        const next = { ...f.input, stream: nextStream };
        const current = api.sync(next, { force: true }); await settle();
        const replacement = { readsBeforeOldStats: f.requests.length, timers: timers.size,
            oldCancelled: await old === undefined, distinct: old !== current };
        f.requests[0].reject(Error('old connection rejected')); await settle();
        replacement.retainedPending = api.sync(next, { force: true }) === current;
        f.requests[1].resolve(new Map()); const snapshot = await current;
        replacement.currentPublished = api.getCached(f.input.tile) === snapshot;
        replacement.sameVideo = f.input.tile.querySelector('video') === f.input.video;
        replacement.newStream = f.input.video.srcObject === nextStream;
        replacement.observed = observed; replacement.published = published;
        f.destroy();

        const queued = fixture();
        const queuedPending = api.sync(queued.input, { force: true }); queued.destroy();
        await queuedPending; await settle();
        const beforeRead = { reads: queued.requests.length, timers: timers.size };

        const outgoing = fixture();
        const outgoingPending = api.sync({ ...outgoing.input, isLocal: true,
            outgoingConnections: [outgoing.input.pc, outgoing.input.pc] }, { force: true });
        await settle(); const outgoingBefore = timers.size; outgoing.destroy();
        const outgoingImmediately = timers.size;
        const outgoingCancelled = await outgoingPending === undefined;
        outgoing.requests[0].resolve(new Map()); outgoing.requests[1].reject(Error('late outgoing stats'));
        await settle();

        const valid = fixture(), started = performance.now();
        const failed = await api.sync(valid.input, { force: true });
        const elapsedMs = Math.round(performance.now() - started);
        valid.input.pc.getStats = async () => new Map();
        const recovered = await api.sync(valid.input, { force: true });
        valid.requests[0].reject(Error('late timeout rejection')); await settle(); valid.destroy();
        return { removed, replacement, beforeRead,
            outgoing: { before: outgoingBefore, immediately: outgoingImmediately, cancelled: outgoingCancelled },
            current: { elapsedMs, failure: failed.连接[0].状态, recovered: recovered.连接[0].状态 === '等待视频统计' },
            finalTimers: timers.size, statsControlled: true, mediaCapture: false };
    } finally {
        for (const timer of timers) nativeClearTimeout(timer);
        window.setTimeout = nativeSetTimeout; window.clearTimeout = nativeClearTimeout;
    }
}

async function verifyFrameLifecycle() {
    const api = window.VoiceShareDiagnostics;
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));
    const originalNow = Object.getOwnPropertyDescriptor(performance, 'now');
    let now = 0, nextId = 0;
    Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
    const scheduled = [], active = new Set();
    const makeVideo = stream => {
        const video = document.createElement('video'); video.muted = true; video.srcObject = stream;
        video.requestVideoFrameCallback = fn => {
            const id = ++nextId; scheduled.push({ id, fn }); active.add(id); return id;
        };
        video.cancelVideoFrameCallback = id => active.delete(id);
        return video;
    };
    const fire = (row, timestamp, metadata) => { active.delete(row.id); now = timestamp + 1; row.fn(timestamp, metadata); };
    const rows = [];
    try {
        for (const change of ['video', 'video-reuse', 'stream', 'panel', 'remove']) {
            const tile = document.createElement('article'), stream = new MediaStream(), video = makeVideo(stream);
            tile.append(video); document.body.append(tile);
            const input = { tile, video, stream, isScreenSharing: true };
            const read = () => api.sync(input, { force: change !== 'panel' });
            if (change === 'panel') { api.sync(input); tile.querySelector('.share-diagnostics').open = true; await settle(); }
            await read(); const old = scheduled.at(-1);
            if (change === 'video' || change === 'video-reuse') {
                input.video = makeVideo(stream); video.replaceWith(input.video); await read();
                if (change === 'video-reuse') { input.video.replaceWith(video); input.video = video; await read(); }
            } else if (change === 'stream') {
                input.stream = new MediaStream(); video.srcObject = input.stream; await read();
            } else if (change === 'panel') {
                const panel = tile.querySelector('.share-diagnostics'); panel.open = false; await settle();
                panel.open = true; await read();
            } else { api.remove(tile); await read(); }
            const current = scheduled.at(-1), registered = scheduled.length;
            fire(old, 1000, { presentedFrames: 900, processingDuration: 0.9 });
            const stale = await read();
            const registrationsAfterOld = scheduled.length, activeAfterOld = active.size;
            fire(current, 2000, { presentedFrames: 60 }); const first = await read();
            fire(scheduled.at(-1), 3000, { presentedFrames: 120 }); const measured = await read();
            const sameVideo = tile.querySelector('video') === input.video, sameStream = input.video.srcObject === input.stream;
            api.remove(tile); tile.remove(); await settle();
            rows.push({ change, noObsoleteChain: registered === registrationsAfterOld, activeAfterOld,
                staleDecode: stale.播放画面.最近帧解码准备_ms, firstFps: first.播放画面.提交合成器帧率,
                currentFps: measured.播放画面.提交合成器帧率, remaining: active.size, sameVideo, sameStream });
        }
        return { rows, finalCallbacks: active.size, callbackDeliveryControlled: true, mediaCapture: false };
    } finally {
        if (originalNow) Object.defineProperty(performance, 'now', originalNow);
        else delete performance.now;
    }
}

app.whenReady().then(async () => {
    deadline = setTimeout(() => fail(new Error('Share diagnostics cancellation test exceeded 15 seconds')), 15000);
    win = new BrowserWindow({ show: false, width: 390, height: 844, webPreferences: {
        sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false,
    } });
    win.webContents.setAudioMuted(true); win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    let permissionRequests = 0;
    win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => { permissionRequests++; callback(false); });
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><meta charset="utf-8"><title>Isolated share diagnostics cancellation</title><body>'));
    await win.webContents.executeJavaScript('window.__errors=[];addEventListener("error",e=>window.__errors.push(e.message));addEventListener("unhandledrejection",e=>window.__errors.push(String(e.reason)));');
    await win.webContents.executeJavaScript(readFileSync(resolve(__dirname, '../../src/views/js/voice/voice-share-stats-view.js'), 'utf8'));
    await win.webContents.executeJavaScript(readFileSync(resolve(__dirname, '../../src/views/js/voice/voice-share-diagnostics.js'), 'utf8'));
    result = await win.webContents.executeJavaScript('(' + verifyRenderer.toString() + ')()');
    const frameLifecycle = await win.webContents.executeJavaScript('(' + verifyFrameLifecycle.toString() + ')()');
    const errors = await win.webContents.executeJavaScript('window.__errors');
    assert.deepEqual(errors, []); assert.equal(permissionRequests, 0);
    for (const row of result.removed) {
        assert.equal(row.before, 1); assert.equal(row.immediately, 0); assert.equal(row.settledBeforeStats, true);
        assert.equal(row.cancelled, true); assert.equal(row.observed, 0); assert.equal(row.published, 0);
        assert.equal(row.cached, false); assert.equal(row.sameVideo, true); assert.equal(row.sameStream, true);
    }
    assert.deepEqual(result.replacement, { readsBeforeOldStats: 2, timers: 1, oldCancelled: true, distinct: true,
        retainedPending: true, currentPublished: true, sameVideo: true, newStream: true, observed: 1, published: 1 });
    assert.deepEqual(result.beforeRead, { reads: 0, timers: 0 });
    assert.deepEqual(result.outgoing, { before: 2, immediately: 0, cancelled: true });
    assert.match(result.current.failure, /统计读取失败或超时/); assert.equal(result.current.recovered, true);
    assert.ok(result.current.elapsedMs >= 2000 && result.current.elapsedMs < 6000); assert.equal(result.finalTimers, 0);
    for (const row of frameLifecycle.rows) {
        assert.equal(row.noObsoleteChain, true); assert.equal(row.activeAfterOld, 1);
        assert.equal(row.staleDecode, null); assert.equal(row.firstFps, null); assert.equal(row.currentFps, 60);
        assert.equal(row.remaining, 0); assert.equal(row.sameVideo, true); assert.equal(row.sameStream, true);
    }
    assert.equal(frameLifecycle.finalCallbacks, 0);
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify({ passed: true, hidden: !win.isVisible(),
        muted: win.webContents.isAudioMuted(), ...result, frameLifecycle, permissionRequests, errors, work }, null, 2));
    cleanup(); process.stdout.write('PASS hidden share diagnostics cancellation, frame ownership and timeout recovery. Controlled stats and callbacks, no media capture.\n'); app.quit();
}).catch(fail);
