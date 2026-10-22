/* eslint-disable no-await-in-loop -- Sequential sizes verify one hidden renderer and its resize listeners. */
const { app, BrowserWindow } = require('electron');
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');
const work = mkdtempSync(join(tmpdir(), 'peer-volume-viewport-'));
const artifacts = resolve(__dirname, '../../integrations/piik/artifacts/peer-volume');
mkdirSync(artifacts, { recursive: true });
app.setPath('userData', join(work, 'profile'));
app.commandLine.appendSwitch('mute-audio'); app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
let win, deadline, keyboard;
const rows = [];
const cleanup = () => { clearTimeout(deadline); win?.destroy(); };
const fail = error => {
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify({ passed: false, error: error.stack, rows, keyboard, work }, null, 2));
    process.stderr.write(String(error.stack || error) + '\n'); cleanup(); app.exit(1);
};
process.on('uncaughtException', fail); process.on('unhandledRejection', fail);

function openPopover() {
    window.__volumeCalls = [];
    window.VoiceRemoteVolumeUI.openPopover({ event: { clientX: innerWidth - 2, clientY: innerHeight - 2 }, controls: [
        { titleText: '语音音量', currentVolume: 75, onVolumeInput: value => window.__volumeCalls.push(['voice', value]) },
        { titleText: '屏幕共享音量', currentVolume: 50, muteLabel: '共享静音',
            onMutedChange: muted => window.__volumeCalls.push(['muted', muted]) },
    ] });
}

async function inspectPopover() {
    const panel = document.querySelector('.peer-volume-popover'), rect = panel.getBoundingClientRect();
    const bounds = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    panel.scrollTop = 0;
    const range = panel.querySelector('input'), rangeRect = range.getBoundingClientRect();
    const rangeReachable = document.elementFromPoint(rangeRect.x + rangeRect.width / 2, rangeRect.y + rangeRect.height / 2) === range;
    range.value = '35'; range.dispatchEvent(new Event('input', { bubbles: true }));
    panel.scrollTop = panel.scrollHeight;
    const mute = panel.querySelector('.peer-volume-mute'), muteRect = mute.getBoundingClientRect();
    const muteReachable = document.elementFromPoint(muteRect.x + muteRect.width / 2, muteRect.y + muteRect.height / 2) === mute;
    mute.click();
    const calls = window.__volumeCalls.splice(0);
    return { width: innerWidth, height: innerHeight, bounds, rangeReachable, muteReachable, calls };
}

function verifyKeyboard() {
    const ui = window.VoiceRemoteVolumeUI;
    ui.closePopover();
    const opener = document.createElement('button'), other = document.createElement('button');
    opener.textContent = '成员音量'; other.textContent = '其他控件';
    opener.style.cssText = 'position:fixed;left:150px;top:200px;width:70px;height:32px';
    document.body.append(opener, other);
    let disabled = false, activation;
    opener.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation();
        activation = { detail: event.detail, x: event.clientX, y: event.clientY };
        ui.openPopover({ event, disabled, emptyText: disabled ? '无共享音频' : '', titleText: '屏幕共享音量' });
    });
    const escape = () => {
        const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        document.activeElement.dispatchEvent(event); return event.defaultPrevented;
    };
    opener.focus(); opener.click();
    let panel = document.querySelector('.peer-volume-popover');
    const rect = panel.getBoundingClientRect(), trigger = opener.getBoundingClientRect();
    const opened = { activation, anchored: Math.abs(rect.left - trigger.left) < 1 && Math.abs(rect.top - trigger.bottom - 4) < 1,
        focused: document.activeElement === panel.querySelector('input'), role: panel.getAttribute('role'), label: panel.getAttribute('aria-label') };
    panel.querySelector('input').focus();
    const prevented = escape();
    const closed = { prevented, removed: !panel.isConnected, focusReturned: document.activeElement === opener };
    disabled = true; opener.focus(); opener.click(); panel = document.querySelector('.peer-volume-popover');
    const empty = { focused: document.activeElement === panel, disabled: panel.querySelector('input').disabled,
        text: panel.querySelector('.peer-volume-empty').textContent };
    escape(); disabled = false;
    opener.focus(); opener.click(); other.focus(); other.click();
    const outside = { closed: !document.querySelector('.peer-volume-popover'), preservedFocus: document.activeElement === other };
    opener.focus(); opener.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 40, clientY: 60, detail: 1 }));
    panel = document.querySelector('.peer-volume-popover');
    const pointer = { left: panel.style.left, top: panel.style.top, preservedFocus: document.activeElement === opener };
    ui.closePopover(); opener.remove(); other.remove();
    return { opened, closed, empty, outside, pointer, activationControlled: true };
}

app.whenReady().then(async () => {
    deadline = setTimeout(() => fail(new Error('Volume viewport test exceeded 15 seconds')), 15000);
    win = new BrowserWindow({ show: false, width: 390, height: 160, useContentSize: true, webPreferences: {
        sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false,
    } });
    win.webContents.setAudioMuted(true); win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    let permissionRequests = 0;
    win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => { permissionRequests++; callback(false); });
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><meta charset="utf-8"><title>Isolated volume viewport</title><body>'));
    await win.webContents.executeJavaScript('window.__errors=[];addEventListener("error",e=>window.__errors.push(e.message));addEventListener("unhandledrejection",e=>window.__errors.push(String(e.reason)));');
    const css = ['base.css', 'media.css'].map(name => readFileSync(resolve(__dirname, '../../src/views/styles', name), 'utf8')).join('\n');
    await win.webContents.executeJavaScript('(()=>{const style=document.createElement("style");style.textContent=' + JSON.stringify(css) + ';document.head.append(style);})()');
    for (const path of ['shared/view-utils.js', 'media/peer-volume-ui.js']) {
        await win.webContents.executeJavaScript(readFileSync(resolve(__dirname, '../../src/views/js', path), 'utf8'));
    }
    await win.webContents.executeJavaScript('window.VoiceRemoteVolumeUI.init();undefined');
    for (const [name, width, height, reopen] of [
        ['short', 390, 160, true], ['narrow', 180, 240, true],
        ['normal', 390, 600, true], ['resize-open', 220, 180, false],
    ]) {
        win.setContentSize(width, height);
        await win.webContents.executeJavaScript('new Promise(resolve=>setTimeout(resolve,40))');
        if (reopen) await win.webContents.executeJavaScript('(' + openPopover.toString() + ')()');
        rows.push({ name, ...await win.webContents.executeJavaScript('(' + inspectPopover.toString() + ')()') });
    }
    win.setContentSize(390, 600);
    await win.webContents.executeJavaScript('new Promise(resolve=>setTimeout(resolve,40))');
    keyboard = await win.webContents.executeJavaScript('(' + verifyKeyboard.toString() + ')()');
    const errors = await win.webContents.executeJavaScript('window.__errors');
    for (const row of rows) {
        assert.ok(row.bounds.left >= 7.5 && row.bounds.top >= 7.5, JSON.stringify(row));
        assert.ok(row.bounds.right <= row.width - 7.5 && row.bounds.bottom <= row.height - 7.5, JSON.stringify(row));
        assert.equal(row.rangeReachable, true); assert.equal(row.muteReachable, true);
        assert.deepEqual(row.calls, [['voice', 35], ['muted', row.name === 'resize-open' ? false : true]]);
    }
    assert.deepEqual(keyboard.opened.activation, { detail: 0, x: 0, y: 0 });
    assert.equal(keyboard.opened.anchored, true); assert.equal(keyboard.opened.focused, true);
    assert.equal(keyboard.opened.role, 'dialog'); assert.equal(keyboard.opened.label, '屏幕共享音量');
    assert.deepEqual(keyboard.closed, { prevented: true, removed: true, focusReturned: true });
    assert.deepEqual(keyboard.empty, { focused: true, disabled: true, text: '无共享音频' });
    assert.deepEqual(keyboard.outside, { closed: true, preservedFocus: true });
    assert.deepEqual(keyboard.pointer, { left: '40px', top: '60px', preservedFocus: true });
    assert.deepEqual(errors, []); assert.equal(permissionRequests, 0);
    await win.webContents.executeJavaScript('window.VoiceRemoteVolumeUI.destroy()');
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify({ passed: true, hidden: !win.isVisible(),
        muted: win.webContents.isAudioMuted(), rows, keyboard, errors, permissionRequests, mediaCapture: false, work }, null, 2));
    cleanup(); process.stdout.write('PASS hidden volume viewport, keyboard focus, scroll reachability and independent controls. No media capture.\n'); app.quit();
}).catch(fail);
