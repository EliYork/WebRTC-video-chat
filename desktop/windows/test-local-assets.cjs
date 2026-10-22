/* eslint-disable no-await-in-loop -- Bounded polls observe one isolated server and hidden renderer. */
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createServer } = require('node:net');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const work = mkdtempSync(join(tmpdir(), 'voice-local-assets-'));
const artifacts = resolve(__dirname, '../../integrations/piik/artifacts/local-assets');
mkdirSync(artifacts, { recursive: true });
app.setPath('userData', join(work, 'profile'));
app.commandLine.appendSwitch('mute-audio');
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
let win, server, output = '', failed = false;
const localRequests = new Set(), externalAttempts = [];
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
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify({
        passed: false, error: error.stack, output, externalAttempts, work,
    }, null, 2));
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
        try { ready = (await fetch(origin + '/readyz')).ok; } catch { /* Still binding. */ }
        if (ready) break;
        await delay(40);
    }
    assert.ok(ready, output);
    win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: {
        sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true,
    } });
    win.webContents.setAudioMuted(true);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
        const url = new URL(details.url);
        const network = /^(https?|wss?):$/.test(url.protocol);
        const local = url.hostname === '127.0.0.1' && url.port === String(port);
        if (network && !local) externalAttempts.push(url.origin);
        if (network && local) localRequests.add(url.pathname);
        callback({ cancel: network && !local });
    });
    const run = code => win.webContents.executeJavaScript(code);
    const wait = condition => run(`new Promise((resolve,reject)=>{const until=Date.now()+10000;const poll=()=>{if(${condition})resolve();else if(Date.now()>until)reject(Error('Local assets condition timeout: '+${JSON.stringify(condition)}));else setTimeout(poll,30)};poll()})`);
    await win.loadURL(origin + '/room/lobby');
    await wait(`document.documentElement.dataset.roomBoot==='ready' && document.querySelector('#chat-panel').dataset.chatConnectionState==='connected'`);
    const fonts = await run(`(async()=>{
        const solid=await document.fonts.load('900 16px "Font Awesome 6 Free"');
        const regular=await document.fonts.load('400 16px "Font Awesome 6 Free"');
        return {solid:solid.some(f=>f.status==='loaded'),regular:regular.some(f=>f.status==='loaded')};
    })()`);
    assert.deepEqual(fonts, { solid: true, regular: true });
    await run(`(()=>{
        const state=window.__localAssets={peers:[],captures:0,violations:[]};
        const PeerBase=window.Peer,emit=io.Socket.prototype.emit;
        window.Peer=class extends PeerBase {constructor(...args){super(...args);state.peers.push(this);}};
        io.Socket.prototype.emit=function(event,...args){if(event==='voice:join')state.socket=this;return emit.call(this,event,...args);};
        for(const method of ['getUserMedia','getDisplayMedia']){
            if(navigator.mediaDevices?.[method]) navigator.mediaDevices[method]=()=>{state.captures++;return Promise.reject(Error('Real capture denied in local-assets test'));};
        }
        document.addEventListener('securitypolicyviolation',event=>state.violations.push({directive:event.effectiveDirective,uri:event.blockedURI}));
        document.querySelector('#destroyPeer').click();
    })()`);
    await wait(`document.querySelector('#main').dataset.voiceState==='joined' && window.__localAssets.peers[0]?.open && window.__localAssets.socket?.io.engine.transport.name==='websocket'`);
    assert.equal(externalAttempts.length, 0, 'normal page startup must need no external HTTP/WebSocket request');
    for (const path of ['/vendor/peerjs/peerjs.min.js', '/vendor/fontawesome/webfonts/fa-solid-900.woff2',
        '/vendor/fontawesome/webfonts/fa-regular-400.woff2', '/socket.io/', '/peerjs/peerjs']) {
        assert.ok(localRequests.has(path), `Expected actual local resource/transport: ${path}`);
    }
    const violations = await run(`(async()=>{
        const script=src=>new Promise(resolve=>{const el=document.createElement('script');el.src=src;el.onerror=()=>{el.remove();resolve();};el.onload=()=>{el.remove();resolve();};document.head.append(el);});
        await Promise.all([
            script('https://unpkg.com/voice-csp-test.js'),
            script('https://kit.fontawesome.com/voice-csp-test.js'),
            new FontFace('ExternalCspTest','url(https://ka-f.fontawesome.com/voice-csp-test.woff2)').load().catch(()=>{}),
            fetch('https://ka-f.fontawesome.com/voice-csp-test.json').catch(()=>{}),
        ]);
        await new Promise(resolve=>setTimeout(resolve,100));
        return window.__localAssets.violations;
    })()`);
    for (const [directive, uri] of [
        ['script-src-elem', 'https://unpkg.com/voice-csp-test.js'],
        ['script-src-elem', 'https://kit.fontawesome.com/voice-csp-test.js'],
        ['font-src', 'https://ka-f.fontawesome.com/voice-csp-test.woff2'],
        ['connect-src', 'https://ka-f.fontawesome.com/voice-csp-test.json'],
    ]) assert.ok(violations.some(item => item.directive === directive && item.uri === uri), `CSP must deny ${directive}: ${uri}`);
    assert.equal(externalAttempts.length, 0, 'CSP must reject the old CDN URLs before a network request is made');
    assert.equal(await run('window.__localAssets.captures'), 0);
    await run(`document.querySelector('#destroyPeer').click();`);
    await wait(`document.querySelector('#main').dataset.voiceState==='not-joined'`);
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify({
        passed: true, hidden: true, muted: win.webContents.isAudioMuted(), fonts,
        localPeerOpened: true, websocketConnected: true, externalRequests: externalAttempts.length,
        deniedCdnDirectives: violations.map(item => item.directive), captures: 0,
        publicMediaVerified: false, work,
    }, null, 2));
    await cleanup();
    process.stdout.write('PASS hidden local assets: local scripts/fonts, Socket.IO websocket and PeerJS, browser CSP denies old CDN URLs. No external requests or media capture.\n');
    app.quit();
}).catch(fail);
