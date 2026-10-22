/* eslint-disable no-await-in-loop -- Controlled results exercise one isolated hidden page sequentially. */
const { app, BrowserWindow } = require('electron');
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const ejs = require('ejs');
const assert = require('node:assert/strict');
const work = mkdtempSync(join(tmpdir(), 'voice-dock-lifecycle-'));
const artifacts = resolve(__dirname, '../../integrations/piik/artifacts/dock-lifecycle');
mkdirSync(artifacts, { recursive: true });
app.setPath('userData', join(work, 'profile'));
app.commandLine.appendSwitch('mute-audio'); app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
let win, deadline, escapeLayers;
const cleanup = () => { clearTimeout(deadline); win?.destroy(); };
const fail = error => {
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify({ passed: false, error: error.stack, escapeLayers, work }, null, 2));
    process.stderr.write(String(error.stack || error)+'\n'); cleanup(); app.exit(1);
};
process.on('uncaughtException', fail); process.on('unhandledRejection', fail);

async function verifyRenderer() {
    const template = new DOMParser().parseFromString(window.__dockTemplate, 'text/html').querySelector('#buttons');
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));
    const fixture = () => {
        const root = template.cloneNode(true); document.body.replaceChildren(root);
        const state = { actualVoiceJoined: true, desiredVoiceJoined: true, mediaControlsAvailable: true,
            browserScreenShareSupported: true, outputVolume: 1, microphoneGain: 100 };
        const create = () => {
            const subscribers = new Set();
            const adapter = Object.fromEntries(['hangUp', 'joinVoice', 'leaveVoice', 'selectCamera', 'selectMicrophone',
                'selectOutput', 'setOutputMuted', 'setOutputVolume', 'startScreenShare', 'stopScreenShare',
                'toggleCamera', 'toggleMicrophone'].map(name => [name, () => true]));
            adapter.getSnapshot = () => ({ ...state });
            adapter.subscribe = callback => { subscribers.add(callback); callback({ ...state }); return () => subscribers.delete(callback); };
            const runtime = window.VoiceMediaDockRuntime.createMediaDockRuntime({ root, adapter }); runtime.init();
            return { adapter, runtime, emit: patch => {
                Object.assign(state, patch); subscribers.forEach(callback => callback({ ...state }));
            } };
        };
        return { root, create, copy: root.querySelector('#copyRoomLink'), screenButton: root.querySelector('#shareScreen'),
            start: root.querySelector('[data-screen-share-start]'), screen: root.querySelector('[data-device-popover="screen"]'),
            feedback: root.querySelector('[data-share-dialog-feedback]'),
            toggle: type => root.querySelector(`[data-control-menu="${type}"]`).click() };
    };
    const copies = [], screens = [], current = [], copyTimers = new Set();
    const nativeSetTimeout = window.setTimeout, nativeClearTimeout = window.clearTimeout;
    window.setTimeout = (callback, ms, ...args) => {
        const id = nativeSetTimeout(callback, ms, ...args); if (ms === 1500) copyTimers.add(id); return id;
    };
    window.clearTimeout = id => { copyTimers.delete(id); nativeClearTimeout(id); };
    try {
        for (const copied of [true, false]) {
            const f = fixture(), first = f.create(); let finish;
            first.adapter.copyRoomLink = () => new Promise(resolve => { finish = resolve; });
            f.copy.click(); first.runtime.destroy();
            const second = f.create(); second.adapter.copyRoomLink = () => Promise.resolve(!copied);
            try {
                f.copy.click(); await settle();
                const before = f.copy.getAttribute('aria-label'), timersBefore = copyTimers.size;
                finish(copied); await settle();
                copies.push({ copied, before, after: f.copy.getAttribute('aria-label'), timersBefore,
                    timersAfter: copyTimers.size, sameButton: f.root.querySelector('#copyRoomLink') === f.copy });
            } finally { second.runtime.destroy(); }
        }
        for (const change of ['other-popover', 'reopened', 'superseded', 'new-request', 'destroyed']) {
            for (const started of [true, false]) {
                const f = fixture(), first = f.create(); let finish, finishNew, second;
                first.adapter.startScreenShare = () => new Promise(resolve => { finish = resolve; });
                f.screenButton.click(); f.start.click();
                try {
                    if (change === 'destroyed') { first.runtime.destroy(); second = f.create(); f.screenButton.click(); }
                    else if (change === 'superseded' || change === 'new-request') {
                        first.emit({ screenSharePending: true });
                        f.screen.querySelector('[data-share-action="stop"]').click(); await settle();
                        first.emit({ screenSharePending: false }); f.screenButton.click();
                        if (change === 'new-request') {
                            first.adapter.startScreenShare = () => new Promise(resolve => { finishNew = resolve; });
                            f.start.click();
                        }
                    } else { f.toggle('mic'); if (change === 'reopened') f.toggle('screen'); }
                    const panel = change === 'other-popover' ? f.root.querySelector('[data-device-popover="mic"]') : f.screen;
                    f.feedback.textContent = 'Current settings feedback';
                    const before = panel.classList.contains('is-open');
                    finish(started); await settle();
                    const row = { change, started, before, after: panel.classList.contains('is-open'),
                        feedback: f.feedback.textContent, sameRoot: document.querySelector('#buttons') === f.root,
                        nativeOpen: change === 'other-popover' ? panel.matches(':popover-open') : panel.open };
                    if (finishNew) {
                        row.newStillPending = f.start.disabled;
                        finishNew(true); await settle(); row.newCompleted = !f.screen.open;
                    }
                    screens.push(row);
                } finally { first.runtime.destroy(); second?.runtime.destroy(); }
            }
        }
        for (const started of [true, false]) {
            const f = fixture(), owner = f.create(); let finish, calls = 0;
            owner.adapter.startScreenShare = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
            try {
                f.screenButton.click(); f.start.click(); const synchronousCalls = calls;
                finish(started); await settle();
                current.push({ started, synchronousCalls, open: f.screen.open, feedback: f.feedback.textContent });
            } finally { owner.runtime.destroy(); }
        }
    } finally { window.setTimeout = nativeSetTimeout; window.clearTimeout = nativeClearTimeout; }
    return { copies, screens, current, pendingCopyTimers: copyTimers.size, controlledAdapter: true };
}

async function verifyEscapeLayers() {
    const template = new DOMParser().parseFromString(window.__dockTemplate, 'text/html').querySelector('#buttons');
    const ui = window.VoiceRemoteVolumeUI, fullscreen = window.VoiceFullscreenControls;
    // Match production registration order: member volume, fullscreen, then dock.
    ui.init(); fullscreen.bindFullscreenChange();
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));
    const key = (isComposing = false) => {
        const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, isComposing });
        (document.activeElement || document).dispatchEvent(event); return event.defaultPrevented;
    };
    const fixture = () => {
        const root = template.cloneNode(true), tile = document.createElement('article'), video = document.createElement('video');
        const stream = new MediaStream(); video.srcObject = stream; video.muted = true;
        tile.append(video); document.body.replaceChildren(root, tile);
        const state = { actualVoiceJoined: true, desiredVoiceJoined: true, mediaControlsAvailable: true,
            browserScreenShareSupported: true, outputVolume: 1, microphoneGain: 100 };
        const adapter = Object.fromEntries(['hangUp', 'joinVoice', 'leaveVoice', 'selectCamera', 'selectMicrophone',
            'selectOutput', 'setOutputMuted', 'setOutputVolume', 'startScreenShare', 'stopScreenShare',
            'toggleCamera', 'toggleMicrophone'].map(name => [name, () => true]));
        adapter.getSnapshot = () => ({ ...state });
        adapter.subscribe = callback => { callback({ ...state }); return () => {}; };
        const runtime = window.VoiceMediaDockRuntime.createMediaDockRuntime({ root, adapter }); runtime.init();
        fullscreen.attachTileButton({ tile }); tile.querySelector('.web-fullscreen-btn').click();
        return { root, tile, adapter, video, stream,
            panel: type => root.querySelector(`[data-device-popover="${type}"]`),
            open: type => root.querySelector(`[data-control-menu="${type}"]`).click(),
            webOpen: () => tile.classList.contains('is-web-fullscreen'),
            destroy: () => { ui.closePopover(); runtime.destroy(); fullscreen.detachTile(tile); } };
    };
    const rows = [];
    try {
        for (const type of ['screen', 'mic']) {
            const f = fixture();
            try {
                f.open(type); const nativeOpen = type === 'screen' ? f.panel(type).open : f.panel(type).matches(':popover-open');
                const consumed = key(); await settle();
                const afterFirst = { web: f.webOpen(), panel: f.panel(type).classList.contains('is-open') };
                key(); await settle();
                rows.push({ type, nativeOpen, consumed, afterFirst, finalWeb: f.webOpen(),
                    sameStream: f.video.srcObject === f.stream });
            } finally { f.destroy(); }
        }
        const f = fixture();
        let composition, volume, pending;
        try {
            f.open('mic'); const composingConsumed = key(true);
            composition = { consumed: composingConsumed, web: f.webOpen(), mic: f.panel('mic').classList.contains('is-open') };
            if (!f.webOpen()) f.tile.querySelector('.web-fullscreen-btn').click();
            if (!f.panel('mic').classList.contains('is-open')) f.open('mic');
            const panel = ui.openPopover({ event: { clientX: 30, clientY: 50 } }); panel.querySelector('input').focus();
            key(); await settle();
            volume = { removed: !panel.isConnected, web: f.webOpen(), mic: f.panel('mic').classList.contains('is-open') };
            key(); await settle(); volume.micAfterSecond = f.panel('mic').classList.contains('is-open'); volume.webAfterSecond = f.webOpen();
            key(); volume.webAfterThird = f.webOpen();
        } finally { f.destroy(); }
        const p = fixture();
        try {
            let finish;
            p.adapter.startScreenShare = () => new Promise(resolve => { finish = resolve; });
            p.open('screen'); p.root.querySelector('[data-screen-share-start]').click();
            const consumed = key(); await settle();
            pending = { consumed, web: p.webOpen(), dialog: p.panel('screen').open,
                feedback: p.root.querySelector('[data-share-dialog-feedback]').textContent };
            finish(false); await settle(); key(); await settle();
            pending.dialogAfterCancel = p.panel('screen').open; pending.webAfterCancel = p.webOpen();
            key(); pending.finalWeb = p.webOpen();
        } finally { p.destroy(); }
        return { rows, composition, volume, pending, keyboardEventsControlled: true, controlledAdapter: true, mediaCapture: false };
    } finally { ui.destroy(); fullscreen.destroy(); }
}

app.whenReady().then(async () => {
    deadline = setTimeout(() => fail(new Error('Dock lifecycle test exceeded 20 seconds')), 20000);
    win = new BrowserWindow({ show: false, width: 390, height: 844, webPreferences: {
        sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false,
    } });
    win.webContents.setAudioMuted(true); win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    let permissionRequests = 0;
    win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => { permissionRequests++; callback(false); });
    await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><meta charset="utf-8"><title>Isolated dock lifecycle</title><body>'));
    await win.webContents.executeJavaScript('window.__dockErrors=[];addEventListener("error",e=>window.__dockErrors.push(e.message));addEventListener("unhandledrejection",e=>window.__dockErrors.push(String(e.reason)));');
    const html = await ejs.renderFile(resolve(__dirname, '../../src/views/room/index.ejs'), {
        channelName: 'Fixture', roomId: 'fixture', channels: [], cspNonce: 'fixture', roomBootstrap: '{}', piikEnabled: false,
    });
    await win.webContents.executeJavaScript('window.__dockTemplate='+JSON.stringify(html));
    for (const path of ['audio-processing-view.js', 'media-dock-runtime.js']) {
        await win.webContents.executeJavaScript(readFileSync(resolve(__dirname, '../../src/views/js/media', path), 'utf8'));
    }
    const result = await win.webContents.executeJavaScript('('+verifyRenderer.toString()+')()');
    for (const path of ['shared/view-utils.js', 'media/peer-volume-ui.js', 'media/fullscreen-controls.js']) {
        await win.webContents.executeJavaScript(readFileSync(resolve(__dirname, '../../src/views/js', path), 'utf8'));
    }
    escapeLayers = await win.webContents.executeJavaScript('(' + verifyEscapeLayers.toString() + ')()');
    const errors = await win.webContents.executeJavaScript('window.__dockErrors');
    assert.deepEqual(errors, []); assert.equal(permissionRequests, 0); assert.equal(result.pendingCopyTimers, 0);
    for (const row of result.copies) {
        assert.equal(row.after, row.before); assert.equal(row.timersBefore, 1); assert.equal(row.timersAfter, 1);
        assert.equal(row.sameButton, true);
    }
    for (const row of result.screens) {
        assert.equal(row.before, true, JSON.stringify(row)); assert.equal(row.after, true, JSON.stringify(row));
        assert.equal(row.nativeOpen, true, JSON.stringify(row));
        assert.equal(row.feedback, 'Current settings feedback'); assert.equal(row.sameRoot, true);
        if (row.change === 'new-request') { assert.equal(row.newStillPending, true); assert.equal(row.newCompleted, true); }
    }
    for (const row of result.current) {
        assert.equal(row.synchronousCalls, 1); assert.equal(row.open, !row.started);
        if (!row.started) assert.match(row.feedback, /操作未完成或已取消/);
    }
    for (const row of escapeLayers.rows) {
        assert.equal(row.nativeOpen, true); assert.equal(row.consumed, true);
        assert.deepEqual(row.afterFirst, { web: true, panel: false });
        assert.equal(row.finalWeb, false); assert.equal(row.sameStream, true);
    }
    assert.deepEqual(escapeLayers.composition, { consumed: false, web: true, mic: true });
    assert.deepEqual(escapeLayers.volume, { removed: true, web: true, mic: true,
        micAfterSecond: false, webAfterSecond: true, webAfterThird: false });
    assert.equal(escapeLayers.pending.consumed, true); assert.equal(escapeLayers.pending.web, true);
    assert.equal(escapeLayers.pending.dialog, true); assert.match(escapeLayers.pending.feedback, /停止共享/);
    assert.equal(escapeLayers.pending.dialogAfterCancel, false); assert.equal(escapeLayers.pending.webAfterCancel, true);
    assert.equal(escapeLayers.pending.finalWeb, false);
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify({ passed: true, hidden: !win.isVisible(),
        muted: win.webContents.isAudioMuted(), ...result, escapeLayers, permissionRequests, errors, work }, null, 2));
    cleanup(); process.stdout.write('PASS hidden dock lifecycle with actual template, native dialogs and controlled adapter; no clipboard writes or media capture.\n'); app.quit();
}).catch(fail);
