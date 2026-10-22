/* eslint-disable no-await-in-loop -- Controlled results exercise sequential lifecycle states on one hidden page. */
const { app, BrowserWindow } = require('electron');
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');
const work = mkdtempSync(join(tmpdir(), 'voice-player-events-'));
const artifacts = resolve(__dirname, '../../integrations/piik/artifacts/player-events');
mkdirSync(artifacts, { recursive: true });
app.setPath('userData', join(work, 'profile'));
app.commandLine.appendSwitch('mute-audio'); app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
let win, deadline, result;
const cleanup = () => { clearTimeout(deadline); win?.destroy(); };
const fail = error => {
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify({ passed: false, error: error.stack, result, work }, null, 2));
    process.stderr.write(String(error.stack || error)+'\n'); cleanup(); app.exit(1);
};
process.on('uncaughtException', fail); process.on('unhandledRejection', fail);

async function verifyRenderer() {
    const subscribers = new Set(); let reads = 0, unsubscribed = 0;
    const opener = document.createElement('button'), other = document.createElement('button');
    document.body.append(opener, other); opener.focus();
    const options = {
        getLogs: () => { reads++; return { sessions: [], currentIndex: -1, storageState: 'Available' }; },
        subscribe: callback => { subscribers.add(callback); return () => { subscribers.delete(callback); unsubscribed++; }; },
    };
    const onClose = dialog => new Promise(resolve => dialog.addEventListener('close', resolve, { once: true }));
    const first = window.VoicePlayerEvents.show(options), oldRender = [...subscribers][0];
    const oldClosed = onClose(first), second = window.VoicePlayerEvents.show(options);
    const replacement = { oldDetached: !first.isConnected, subscribers: subscribers.size };
    const beforeReads = reads; oldRender(); replacement.lateRenderIgnored = reads === beforeReads;
    await oldClosed;
    replacement.newStillOpen = second.open;
    replacement.focusInNewDialog = second.contains(document.activeElement);
    const secondClosed = onClose(second); second.querySelector('button').click();
    const closeButton = { released: subscribers.size === 0, detached: !second.isConnected };
    await secondClosed;

    opener.focus();
    const third = window.VoicePlayerEvents.show(options), thirdClosed = onClose(third);
    third.close(); other.focus(); await thirdClosed;
    const nativeClose = { newerFocusPreserved: document.activeElement === other, released: subscribers.size === 0 };

    const detachedHost = document.createElement('article'); let failure;
    try { window.VoicePlayerEvents.show({ ...options, host: detachedHost }); } catch (error) { failure = error.name; }
    const openFailure = { failure, subscriptions: subscribers.size, detachedChildren: detachedHost.childElementCount };
    // A valid dialog can be opened after the failed attempt.
    const fourth = window.VoicePlayerEvents.show(options), fourthClosed = onClose(fourth);
    const recovery = { open: fourth.open, subscriptions: subscribers.size };
    fourth.querySelector('button').click(); await fourthClosed;
    return { replacement, closeButton, nativeClose, openFailure, recovery,
        finalSubscriptions: subscribers.size, unsubscribed, nativeDialog: true };
}

async function verifyCopyLifecycle() {
    const timers = new Map(), nativeSetTimeout = window.setTimeout, nativeClearTimeout = window.clearTimeout;
    let timerId = 0;
    window.setTimeout = callback => { timers.set(++timerId, callback); return timerId; };
    window.clearTimeout = id => timers.delete(id);
    const settle = () => new Promise(resolve => nativeSetTimeout(resolve, 0));
    const setup = (transport, write) => {
        window.EliYorkDesktop = transport === 'desktop' ? { writeClipboardText: write } : undefined;
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: write } });
        const state = { 会话: { state: 'idle', generation: null }, 本机音频: { 输入设备: 'Synthetic', deviceId: 'synthetic-secret' } };
        const sources = [], button = document.createElement('button'); button.textContent = '复制诊断'; document.body.append(button);
        const runtime = window.VoiceCallDiagnostics.createRuntime({ sanitize: window.__sanitizeDiagnostic,
            getState: () => state, getSources: () => sources, getConnections: () => [], storage: { getItem: () => null, setItem() {} } });
        return { runtime, state, sources, button };
    };
    const disposed = [], sessions = [];
    try {
        for (const transport of ['browser', 'desktop']) {
            for (const outcome of ['resolve', 'reject']) {
                let finish, writes = 0;
                const f = setup(transport, () => { writes++; return new Promise((resolve, reject) => { finish = outcome === 'resolve' ? resolve : reject; }); });
                const pending = f.runtime.copyCombined(f.button); await settle(); f.runtime.destroy();
                const released = !f.button.disabled && f.button.getAttribute('aria-busy') === 'false';
                f.button.textContent = 'New owner feedback'; finish(new Error('obsolete copy result')); await pending;
                disposed.push({ transport, outcome, writes, released, label: f.button.textContent,
                    dialogs: document.querySelectorAll('dialog').length, timers: timers.size }); f.button.remove();
            }
            let reject;
            const f = setup(transport, () => new Promise((_resolve, fail) => { reject = fail; }));
            const pending = f.runtime.copyCombined(f.button); await settle(); f.state.会话.generation = 2;
            reject(new Error('previous session denied')); await pending;
            sessions.push({ transport, retry: f.button.textContent === '会话已变化，请重试',
                released: !f.button.disabled, dialogs: document.querySelectorAll('dialog').length });
            f.runtime.destroy(); f.button.remove();
        }
        let finishSample, writes = 0;
        window.VoiceShareDiagnostics = { sync: () => new Promise(resolve => { finishSample = resolve; }) };
        const collecting = setup('browser', () => { writes++; return Promise.resolve(); });
        collecting.sources.push({ tile: {}, isScreenSharing: true });
        const pending = collecting.runtime.copyCombined(collecting.button); await settle(); collecting.runtime.destroy();
        finishSample({}); await pending;
        const collection = { writes, released: !collecting.button.disabled, label: collecting.button.textContent, timers: timers.size };
        collecting.button.remove();

        let payload;
        const success = setup('desktop', text => { payload = text; return Promise.resolve(); });
        await success.runtime.copyCombined(success.button);
        const currentSuccess = { copied: success.button.textContent === '诊断已复制',
            sanitized: !payload.includes('synthetic-secret'), released: !success.button.disabled };
        success.runtime.destroy(); success.button.remove();

        const failure = setup('browser', () => Promise.reject(new Error('current copy denied')));
        await failure.runtime.copyCombined(failure.button);
        const dialog = document.querySelector('dialog'), area = dialog?.querySelector('textarea');
        const currentFailure = { open: dialog?.open, sanitized: Boolean(area && !area.value.includes('synthetic-secret')),
            manualCopy: failure.button.textContent === '请在日志窗口手动复制' };
        const closed = new Promise(resolve => dialog.addEventListener('close', resolve, { once: true }));
        dialog.close(); await closed; failure.runtime.destroy(); failure.button.remove();
        return { disposed, sessions, collection, currentSuccess, currentFailure, finalTimers: timers.size,
            clipboardControlled: true, actualClipboardWrites: 0 };
    } finally { window.setTimeout = nativeSetTimeout; window.clearTimeout = nativeClearTimeout; }
}

async function verifySamplingLifecycle() {
    const timers = new Map(), nativeSetTimeout = window.setTimeout, nativeClearTimeout = window.clearTimeout;
    window.setTimeout = (callback, ms) => {
        const id = nativeSetTimeout(() => { timers.delete(id); callback(); }, ms); timers.set(id, ms); return id;
    };
    window.clearTimeout = id => { timers.delete(id); nativeClearTimeout(id); };
    const settle = () => new Promise(resolve => nativeSetTimeout(resolve, 0));
    const setup = (connections, sources = []) => {
        let connectionReads = 0, stored = 0;
        const state = { 会话: { state: 'joined', generation: 1 }, 本机音频: {} };
        const runtime = window.VoiceCallDiagnostics.createRuntime({ sanitize: window.__sanitizeDiagnostic,
            getState: () => state, getSources: () => sources,
            getConnections: () => { connectionReads++; return connections; },
            storage: { getItem: () => null, setItem: () => { stored++; } } });
        return { runtime, state, reads: () => connectionReads, stored: () => stored };
    };
    try {
        let finishShare, settled = false;
        window.VoiceShareDiagnostics = { sync: () => new Promise(resolve => { finishShare = resolve; }) };
        const sharing = setup([{ getStats: async () => new Map() }], [{}]);
        const oldShare = sharing.runtime.sample(); oldShare.then(() => { settled = true; }); await settle();
        sharing.runtime.destroy(); await settle();
        const share = { settledBeforeCollector: settled, cancelled: await oldShare === null };
        finishShare({}); await settle(); share.connectionReads = sharing.reads(); share.timers = timers.size;

        const stats = [];
        for (const outcome of ['resolve', 'reject']) {
            let finish;
            const f = setup([{ getStats: () => new Promise((resolve, reject) => { finish = outcome === 'resolve' ? resolve : reject; }) }]);
            const pending = f.runtime.sample(); await settle(); const timeoutsBefore = [...timers.values()].filter(ms => ms === 2500).length;
            f.runtime.destroy(); const timeoutsAfter = timers.size;
            const cancelled = await pending === null;
            finish(outcome === 'resolve' ? new Map() : new Error('obsolete statistics')); await settle();
            stats.push({ outcome, timeoutsBefore, timeoutsAfter, cancelled, stored: f.stored(), timers: timers.size });
        }
        let finishIdle, shareCalls = 0;
        window.VoiceShareDiagnostics = { sync: () => ++shareCalls === 1 ? new Promise(resolve => { finishIdle = resolve; }) : Promise.resolve({}) };
        const switching = setup([], [{}]);
        const oldReport = switching.runtime.report().then(() => 'unexpected report', error => error.message); await settle();
        switching.state.会话.generation = 2; switching.state.本机音频.麦克风增益_百分比 = 77;
        switching.runtime.start(); const rejected = await oldReport; finishIdle({}); await settle();
        const fresh = await switching.runtime.report(); switching.runtime.destroy();
        const session = { rejected, newGain: fresh.当前状态.本机音频.麦克风增益_百分比, timers: timers.size };

        const pc = { getStats: () => new Promise(() => {}) }, current = setup([pc]);
        const startedAt = performance.now(), failed = await current.runtime.sample();
        const elapsedMs = Math.round(performance.now() - startedAt);
        pc.getStats = async () => new Map(); const recovered = await current.runtime.sample(); current.runtime.destroy();
        return { share, stats, session, current: { elapsedMs, failure: failed.连接[0].状态,
            recovered: recovered.连接[0].路径 === 'P2P' && recovered.连接[0].状态 === undefined },
        finalTimers: timers.size, controlledCollectors: true, mediaCapture: false };
    } finally { window.setTimeout = nativeSetTimeout; window.clearTimeout = nativeClearTimeout; }
}

app.whenReady().then(async () => {
    deadline = setTimeout(() => fail(new Error('Player events test exceeded 20 seconds')), 20000);
    win = new BrowserWindow({ show: false, width: 390, height: 844, webPreferences: {
        sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false,
    } });
    win.webContents.setAudioMuted(true); win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    let permissionRequests = 0;
    win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => { permissionRequests++; callback(false); });
    await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><meta charset="utf-8"><title>Isolated event dialog lifecycle</title><body>'));
    await win.webContents.executeJavaScript('window.__eventErrors=[];addEventListener("error",e=>window.__eventErrors.push(e.message));addEventListener("unhandledrejection",e=>window.__eventErrors.push(String(e.reason)));');
    await win.webContents.executeJavaScript(readFileSync(resolve(__dirname, '../../src/views/js/voice/voice-player-events.js'), 'utf8'));
    result = await win.webContents.executeJavaScript('('+verifyRenderer.toString()+')()');
    const schemaUrl = 'data:text/javascript;base64,'+Buffer.from(readFileSync(resolve(__dirname, '../../src/views/js/shared/voice-diagnostic-schema.js'))).toString('base64');
    await win.webContents.executeJavaScript('(async()=>{window.__sanitizeDiagnostic=(await import('+JSON.stringify(schemaUrl)+')).sanitizeVoiceDiagnostic;})()');
    await win.webContents.executeJavaScript(readFileSync(resolve(__dirname, '../../src/views/js/voice/voice-call-diagnostics.js'), 'utf8'));
    const copyLifecycle = await win.webContents.executeJavaScript('('+verifyCopyLifecycle.toString()+')()');
    const samplingLifecycle = await win.webContents.executeJavaScript('('+verifySamplingLifecycle.toString()+')()');
    const errors = await win.webContents.executeJavaScript('window.__eventErrors');
    assert.deepEqual(errors, []); assert.equal(permissionRequests, 0);
    assert.deepEqual(result.replacement, { oldDetached: true, subscribers: 1, lateRenderIgnored: true,
        newStillOpen: true, focusInNewDialog: true });
    assert.deepEqual(result.closeButton, { released: true, detached: true });
    assert.deepEqual(result.nativeClose, { newerFocusPreserved: true, released: true });
    assert.deepEqual(result.openFailure, { failure: 'InvalidStateError', subscriptions: 0, detachedChildren: 0 });
    assert.deepEqual(result.recovery, { open: true, subscriptions: 1 }); assert.equal(result.finalSubscriptions, 0);
    for (const row of copyLifecycle.disposed) {
        assert.equal(row.writes, 1); assert.equal(row.released, true); assert.equal(row.label, 'New owner feedback');
        assert.equal(row.dialogs, 0); assert.equal(row.timers, 0);
    }
    for (const row of copyLifecycle.sessions) { assert.equal(row.retry, true); assert.equal(row.released, true); assert.equal(row.dialogs, 0); }
    assert.deepEqual(copyLifecycle.collection, { writes: 0, released: true, label: '复制诊断', timers: 0 });
    assert.deepEqual(copyLifecycle.currentSuccess, { copied: true, sanitized: true, released: true });
    assert.deepEqual(copyLifecycle.currentFailure, { open: true, sanitized: true, manualCopy: true });
    assert.equal(copyLifecycle.finalTimers, 0);
    assert.deepEqual(samplingLifecycle.share, { settledBeforeCollector: true, cancelled: true, connectionReads: 0, timers: 0 });
    for (const row of samplingLifecycle.stats) {
        assert.equal(row.timeoutsBefore, 1); assert.equal(row.timeoutsAfter, 0); assert.equal(row.cancelled, true);
        assert.equal(row.stored, 0); assert.equal(row.timers, 0);
    }
    assert.deepEqual(samplingLifecycle.session, { rejected: 'session-changed', newGain: 77, timers: 0 });
    assert.match(samplingLifecycle.current.failure, /统计读取失败或超时/); assert.equal(samplingLifecycle.current.recovered, true);
    assert.ok(samplingLifecycle.current.elapsedMs >= 2000 && samplingLifecycle.current.elapsedMs < 6000);
    assert.equal(samplingLifecycle.finalTimers, 0);
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify({ passed: true, hidden: !win.isVisible(),
        muted: win.webContents.isAudioMuted(), ...result, copyLifecycle, samplingLifecycle, permissionRequests, errors, work }, null, 2));
    cleanup(); process.stdout.write('PASS hidden native event dialogs, diagnostics copy and sampling cancellation. Clipboard and collectors controlled, no media capture.\n'); app.quit();
}).catch(fail);
