/* eslint-disable no-await-in-loop -- Bounded polls observe an isolated server and hidden page. */
const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createServer } = require('node:net');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');

const work = mkdtempSync(join(tmpdir(), 'voice-camera-cancel-'));
const artifacts = resolve(__dirname, '../../integrations/piik/artifacts/camera-cancel');
mkdirSync(artifacts, { recursive: true });
app.setPath('userData', join(work, 'profile'));
app.commandLine.appendSwitch('mute-audio');
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
let win, server, output = '', failed = false;
const browserErrors = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const cleanup = async () => {
    win?.destroy();
    if (server && server.exitCode === null) {
        const exited = once(server, 'exit');
        server.kill();
        await exited;
    }
};
const fail = async error => {
    if (failed) return;
    failed = true;
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify({ passed: false, error: error.stack, output, browserErrors, work }, null, 2));
    await cleanup();
    app.exit(1);
};
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
app.whenReady().then(async () => {
    const reservation = createServer().listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    const origin = `http://127.0.0.1:${port}`;
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(TURN_|SFU_|PIIK_|TLS_)/.test(key)));
    server = spawn(process.execPath, [resolve(__dirname, '../../src/server.js')], {
        cwd: work, windowsHide: true, stdio: 'pipe',
        env: { ...env, ELECTRON_RUN_AS_NODE: '1', HOST: '127.0.0.1', PORT: String(port), USE_HTTPS: 'false', ENV: 'production',
            SFU_ENABLED: 'false', PIIK_ENABLED: 'false', CHAT_HISTORY_FILE: join(work, 'history.json') },
    });
    server.stdout.on('data', value => { output += value; });
    server.stderr.on('data', value => { output += value; });
    let ready = false;
    for (let n = 0; n < 100; n++) {
        if (server.exitCode !== null) throw Error(output);
        try { ready = (await fetch(origin + '/readyz', { signal: AbortSignal.timeout(1000) })).ok; } catch { /* Listener is still binding. */ }
        if (ready) break;
        await delay(40);
    }
    assert.ok(ready, output);
    win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: {
        sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true,
    } });
    win.webContents.setAudioMuted(true);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('console-message', event => browserErrors.push(event.message));
    win.webContents.session.setPermissionCheckHandler(() => false);
    win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
        const url = new URL(details.url);
        callback({ cancel: /^(https?|wss?):$/.test(url.protocol) && (url.hostname !== '127.0.0.1' || url.port !== String(port)) });
    });
    const run = code => win.webContents.executeJavaScript(code);
    const wait = condition => run(`new Promise((resolve,reject)=>{const until=Date.now()+10000;const poll=()=>{if(${condition})resolve();else if(Date.now()>until)reject(Error('Camera condition timeout: '+${JSON.stringify(condition)}));else setTimeout(poll,30)};poll()})`);
    await win.loadURL(origin + '/room/lobby');
    await wait(`document.documentElement.dataset.roomBoot==='ready' && document.querySelector('#chat-panel').dataset.chatConnectionState==='connected'`);
    await run(`(()=>{
        const t=window.__cameraTest={requests:[],tracks:[],pending:[],microphoneAttempts:0};
        t.makeStream=()=>{
            const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;
            canvas.getContext('2d').fillRect(0,0,64,64);
            const source=canvas.captureStream(5),track=source.getVideoTracks()[0].clone();
            source.getTracks().forEach(track=>track.stop());t.tracks.push(track);
            return new MediaStream([track]);
        };
        navigator.mediaDevices.getUserMedia=constraints=>{
            if(constraints.audio){t.microphoneAttempts++;return Promise.reject(new DOMException('Synthetic test denies microphone','NotAllowedError'));}
            t.requests.push(constraints);
            return t.requests.length===1?Promise.resolve(t.makeStream()):new Promise(resolve=>t.pending.push(()=>resolve(t.makeStream())));
        };
        navigator.mediaDevices.getDisplayMedia=()=>Promise.reject(new DOMException('Synthetic test denies desktop','NotAllowedError'));
        navigator.mediaDevices.enumerateDevices=async()=>['camera-a','camera-b'].map(deviceId=>({deviceId,kind:'videoinput',groupId:'synthetic',label:'Synthetic '+deviceId}));
        document.querySelector('#destroyPeer').click();
    })()`);
    await wait(`document.querySelector('#main').dataset.voiceState==='joined'`);
    await run(`document.querySelector('#toggleVideo').click()`);
    await wait(`document.querySelector('#toggleVideo').getAttribute('aria-pressed')==='true' && window.__cameraTest.tracks.length===1`);
    await run(`document.querySelector('[data-control-menu="camera"]').click()`);
    await wait(`document.querySelector('[data-device-type="camera"][data-device-id="camera-b"]')`);
    await run(`document.querySelector('[data-device-type="camera"][data-device-id="camera-b"]').click()`);
    await wait(`window.__cameraTest.pending.length===1 && document.querySelector('#toggleVideo').getAttribute('aria-busy')==='true'`);
    const switching = await run(`(()=>{const b=document.querySelector('#toggleVideo');return {enabled:!b.disabled,busy:b.getAttribute('aria-busy'),label:b.getAttribute('aria-label'),oldTrack:window.__cameraTest.tracks[0].readyState};})()`);
    assert.deepEqual(switching, { enabled: true, busy: 'true', label: '关闭摄像头', oldTrack: 'live' });
    await run(`document.querySelector('#toggleVideo').click()`);
    await wait(`window.__cameraTest.tracks[0].readyState==='ended' && document.querySelector('#toggleVideo').getAttribute('aria-pressed')==='false' && document.querySelector('#toggleVideo').getAttribute('aria-busy')==='false'`);
    await run(`window.__cameraTest.pending.shift()()`);
    await wait(`window.__cameraTest.tracks.length===2 && window.__cameraTest.tracks[1].readyState==='ended'`);
    // Start a second capture with no active camera, then use the real cancel button.
    await run(`document.querySelector('#toggleVideo').click()`);
    await wait(`window.__cameraTest.requests.length===3 && window.__cameraTest.pending.length===1 && document.querySelector('#toggleVideo').getAttribute('aria-busy')==='true'`);
    const opening = await run(`(()=>{const b=document.querySelector('#toggleVideo');return {enabled:!b.disabled,label:b.getAttribute('aria-label'),pressed:b.getAttribute('aria-pressed')};})()`);
    assert.deepEqual(opening, { enabled: true, label: '取消开启摄像头', pressed: 'false' });
    await run(`document.querySelector('#toggleVideo').click();window.__cameraTest.pending.shift()()`);
    await wait(`window.__cameraTest.tracks.length===3 && window.__cameraTest.tracks.every(track=>track.readyState==='ended') && document.querySelector('#toggleVideo').getAttribute('aria-busy')==='false'`);
    const final = await run(`(()=>{const t=window.__cameraTest,b=document.querySelector('#toggleVideo');return {requests:t.requests.length,tracks:t.tracks.map(track=>track.readyState),pending:t.pending.length,pressed:b.getAttribute('aria-pressed'),label:b.getAttribute('aria-label'),voice:document.querySelector('#main').dataset.voiceState};})()`);
    assert.equal(final.requests, 3);
    assert.equal(final.pending, 0);
    assert.equal(final.pressed, 'false');
    assert.equal(final.label, '打开摄像头');
    assert.equal(final.voice, 'joined');
    await run(`document.querySelector('[data-device-type="camera"][data-device-id="camera-a"]').click();document.querySelector('#toggleVideo').click()`);
    await wait(`window.__cameraTest.pending.length===1`);
    await run(`window.__cameraTest.pending.shift()()`);
    await wait(`document.querySelector('#toggleVideo').getAttribute('aria-pressed')==='true'`);
    await run(`document.querySelector('[data-device-type="camera"][data-device-id="camera-b"]').click()`);
    await wait(`window.__cameraTest.requests.length===5 && window.__cameraTest.pending.length===1`);
    await run(`document.querySelector('#destroyPeer').click()`);
    await wait(`document.querySelector('#main').dataset.voiceState==='not-joined' && window.__cameraTest.tracks[3].readyState==='ended'`);
    assert.equal(await run(`document.querySelector('[data-device-type="camera"][data-device-id="camera-a"]').getAttribute('aria-pressed')`), 'true');
    await run(`(()=>{
        navigator.mediaDevices.enumerateDevices=async()=>[{deviceId:'camera-c',kind:'videoinput',groupId:'synthetic',label:'Synthetic camera-c'}];
        document.querySelector('#destroyPeer').click();
    })()`);
    await wait(`document.querySelector('#main').dataset.voiceState==='joined'`);
    // Opening the real device menu requests a fresh enumeration. A disappeared
    // adopted device becomes the default preference without a new selection.
    await run(`(()=>{const menu=document.querySelector('[data-control-menu="camera"]');if(menu.getAttribute('aria-expanded')==='true')menu.click();menu.click();})()`);
    await wait(`document.querySelector('[data-device-type="camera"][data-device-id="camera-c"]') && document.querySelector('[data-device-type="camera"][data-device-id="default"]').getAttribute('aria-pressed')==='true'`);
    await run(`document.querySelector('#toggleVideo').click()`);
    await wait(`window.__cameraTest.requests.length===6 && window.__cameraTest.pending.length===2`);
    assert.equal(await run(`window.__cameraTest.requests[5].video`), true);
    await run(`window.__cameraTest.pending.pop()()`);
    await wait(`document.querySelector('#toggleVideo').getAttribute('aria-pressed')==='true' && window.__cameraTest.tracks[4].readyState==='live'`);
    await run(`window.__cameraTest.pending.shift()()`);
    await wait(`window.__cameraTest.tracks.length===6 && window.__cameraTest.tracks[5].readyState==='ended'`);
    const rejoined = await run(`({selected:document.querySelector('[data-device-type="camera"][aria-pressed="true"]').dataset.deviceId,track:window.__cameraTest.tracks[4].readyState,voice:document.querySelector('#main').dataset.voiceState,pending:window.__cameraTest.pending.length})`);
    assert.deepEqual(rejoined, { selected: 'default', track: 'live', voice: 'joined', pending: 0 });
    await run(`(()=>{
        navigator.mediaDevices.enumerateDevices=async()=>['camera-c','camera-d'].map(deviceId=>({deviceId,kind:'videoinput',groupId:'synthetic',label:'Synthetic '+deviceId}));
        const menu=document.querySelector('[data-control-menu="camera"]');if(menu.getAttribute('aria-expanded')==='true')menu.click();menu.click();
    })()`);
    await wait(`document.querySelector('[data-device-type="camera"][data-device-id="camera-d"]')`);
    await run(`document.querySelector('[data-device-type="camera"][data-device-id="camera-c"]').click()`);
    await wait(`window.__cameraTest.requests.length===7 && window.__cameraTest.pending.length===1`);
    await run(`window.__cameraTest.pending.shift()()`);
    await wait(`window.__cameraTest.tracks.length===7 && document.querySelector('#toggleVideo').getAttribute('aria-busy')==='false'`);
    await run(`document.querySelector('[data-device-type="camera"][data-device-id="camera-d"]').click()`);
    await wait(`window.__cameraTest.requests.length===8 && window.__cameraTest.pending.length===1`);
    // Drive the actual debounced devicechange listener with a synthetic list.
    await run(`(()=>{
        navigator.mediaDevices.enumerateDevices=async()=>[{deviceId:'camera-c',kind:'videoinput',groupId:'synthetic',label:'Synthetic camera-c'}];
        navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
    })()`);
    await wait(`window.__cameraTest.requests.length===9 && window.__cameraTest.pending.length===2`);
    assert.equal(await run(`window.__cameraTest.requests[8].video`), true);
    assert.equal(await run(`window.__cameraTest.tracks[6].readyState`), 'live');
    await run(`window.__cameraTest.pending.pop()()`);
    await wait(`window.__cameraTest.tracks.length===8 && window.__cameraTest.tracks[7].readyState==='live' && window.__cameraTest.tracks[6].readyState==='ended'`);
    await run(`window.__cameraTest.pending.shift()()`);
    await wait(`window.__cameraTest.tracks.length===9 && window.__cameraTest.tracks[8].readyState==='ended'`);
    const hotplug = await run(`({requests:window.__cameraTest.requests.length,selected:document.querySelector('[data-device-type="camera"][aria-pressed="true"]').dataset.deviceId,track:window.__cameraTest.tracks[7].readyState,voice:document.querySelector('#main').dataset.voiceState,pending:window.__cameraTest.pending.length})`);
    assert.deepEqual(hotplug, { requests: 9, selected: 'default', track: 'live', voice: 'joined', pending: 0 });
    await run(`document.querySelector('#toggleVideo').click()`);
    await wait(`window.__cameraTest.tracks.every(track=>track.readyState==='ended')`);
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify({ passed: true, hidden: !win.isVisible(), muted: win.webContents.isAudioMuted(), switching, opening, final, rejoined, hotplug, allTracksEnded: true, realMediaCapture: false, physicalDeviceVerified: false, work }, null, 2));
    await cleanup();
    process.stdout.write('PASS hidden camera cancel: close, cancel, leave/rejoin and devicechange fallback preserve the current selection and stop obsolete synthetic tracks. No real media capture.\n');
    app.quit();
}).catch(fail);
