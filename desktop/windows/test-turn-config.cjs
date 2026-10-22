/* eslint-disable no-await-in-loop -- One isolated hidden browser lifecycle. */
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createServer } = require('node:net');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const work = mkdtempSync(join(tmpdir(), 'voice-turn-browser-'));
const artifacts = resolve(__dirname, '../../integrations/piik/artifacts/turn-config');
mkdirSync(artifacts, { recursive: true });
app.setPath('userData', join(work, 'profile'));
app.commandLine.appendSwitch('mute-audio'); app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
let win, server, output = '', failed = false;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const cleanup = async () => {
    win?.destroy();
    if (server && server.exitCode === null) { const exited = once(server, 'exit'); server.kill(); await exited; }
};
const fail = async error => {
    if (failed) return; failed = true;
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify({ passed: false, error: error.stack, output, work }));
    await cleanup(); app.exit(1);
};
process.on('uncaughtException', fail); process.on('unhandledRejection', fail);
app.whenReady().then(async () => {
    const reservation = createServer().listen(0, '127.0.0.1'); await once(reservation, 'listening');
    const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
    const origin = `http://127.0.0.1:${port}`;
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(TURN_|SFU_|PIIK_|TLS_)/.test(key)));
    server = spawn(process.execPath, [resolve(__dirname, '../../src/server.js')], {
        cwd: work, windowsHide: true, stdio: 'pipe',
        env: { ...env, ELECTRON_RUN_AS_NODE: '1', HOST: '127.0.0.1', PORT: String(port), USE_HTTPS: 'false', ENV: 'production',
            SFU_ENABLED: 'false', PIIK_ENABLED: 'false', CHAT_HISTORY_FILE: join(work, 'history.json'),
            TURN_URLS: 'turn:127.0.0.1:9?transport=udp', TURN_SHARED_SECRET: 'test-only-browser-turn-shared-secret-1234567890', TURN_TTL_SECONDS: '600' },
    });
    server.stdout.on('data', value => { output += value; }); server.stderr.on('data', value => { output += value; });
    let ready = false;
    for (let n = 0; n < 100; n++) {
        if (server.exitCode !== null) throw Error(output);
        try { ready = (await fetch(origin + '/readyz')).ok; } catch { /* Still binding. */ }
        if (ready) break; await delay(40);
    }
    assert.ok(ready, output);
    win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: {
        sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true,
    } });
    win.webContents.setAudioMuted(true); win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    const run = code => win.webContents.executeJavaScript(code);
    const wait = condition => run(`new Promise((resolve,reject)=>{const until=Date.now()+10000;const poll=()=>{if(${condition})resolve();else if(Date.now()>until)reject(Error('TURN browser condition timeout: '+${JSON.stringify(condition)}));else setTimeout(poll,30)};poll()})`);
    await win.loadURL(origin + '/room/lobby');
    await wait(`document.documentElement.dataset.roomBoot==='ready' && document.querySelector('#chat-panel').dataset.chatConnectionState==='connected'`);
    await run(`(() => {
        window.__turnTest={requests:0,peers:[],pending:[],refresh:undefined};
        const test=window.__turnTest, OriginalPeer=window.Peer, emit=io.Socket.prototype.emit, timer=window.setTimeout;
        window.Peer=class extends OriginalPeer { constructor(...args) { super(...args); test.peers.push(this); } };
        window.setTimeout=function(callback,ms,...args){if(ms>=400000 && ms<=600000)test.refresh=callback;return timer(callback,ms,...args);};
        io.Socket.prototype.emit=function(event,...args){
            if(event==='rtc:ice'){
                test.requests++;test.socket=this;
                const ack=args.at(-1);
                if(test.delay){test.pending.push(ack);return this;}
                if(test.fail){queueMicrotask(()=>ack({ok:false,reason:'test-unavailable'}));return this;}
            }
            return emit.call(this,event,...args);
        };
        document.querySelector('#destroyPeer').click();
    })()`);
    await wait(`document.querySelector('#main').dataset.voiceState==='joined' && window.__turnTest.peers.length===1`);
    const accepted = await run(`(() => {
        const t=window.__turnTest,p=t.peers[0],turn=p.options.config.iceServers.find(x=>Array.isArray(x.urls));
        t.originalPeer=p;t.originalUsername=turn.username;
        // Empty synthetic stream: create a real PeerJS RTCPeerConnection, then
        // close before any SDP is applied. No media capture or STUN gathering.
        const call=p.call('isolated-test-no-remote',new MediaStream());
        const actual=call.peerConnection.getConfiguration().iceServers.find(x=>x.urls.some(u=>u.startsWith('turn:')));
        const result={requests:t.requests,turnConfigured:!!turn,rtcAccepted:actual.username===turn.username&&actual.credential===turn.credential,refreshScheduled:typeof t.refresh==='function'};
        call.close();return result;
    })()`);
    assert.equal(accepted.turnConfigured, true); assert.equal(accepted.rtcAccepted, true); assert.equal(accepted.refreshScheduled, true);
    await run(`window.__turnTest.socket.disconnect(); void window.__turnTest.socket.connect();`);
    await wait(`document.querySelector('#main').dataset.voiceState==='joined' && window.__turnTest.originalPeer.options.config.iceServers.at(-1).username!==window.__turnTest.originalUsername`);
    assert.equal(await run(`window.__turnTest.originalPeer===window.__turnTest.peers[0] && window.__turnTest.peers.length===1 && !window.__turnTest.originalPeer.destroyed`), true);
    await run(`window.__turnTest.fail=true;window.__turnTest.failedRefreshCount=window.__turnTest.requests;window.__turnTest.refresh();`);
    await wait(`window.__turnTest.requests>window.__turnTest.failedRefreshCount`);
    assert.equal(await run(`document.querySelector('#main').dataset.voiceState==='joined' && !window.__turnTest.originalPeer.destroyed`), true);
    await run(`document.querySelector('#destroyPeer').click();`);
    await wait(`document.querySelector('#main').dataset.voiceState==='not-joined'`);
    await run(`window.__turnTest.fail=false;window.__turnTest.delay=true;document.querySelector('#destroyPeer').click();`);
    await wait(`window.__turnTest.pending.length===1`);
    await run(`document.querySelector('#destroyPeer').click();window.__turnTest.pending.shift()({ok:true,turnEnabled:true,ttlSeconds:600,iceServers:[{urls:'turn:127.0.0.1:9',username:'late-test',credential:'late-test'}]});`);
    await delay(150);
    const cancelled = await run(`({left:document.querySelector('#main').dataset.voiceState==='not-joined',peers:window.__turnTest.peers.length})`);
    assert.equal(cancelled.left, true); assert.equal(cancelled.peers, 1);
    // Reconnect during the credential wait advances the voice epoch. The new
    // attempt must complete even though the initial attempt has become stale.
    await run(`document.querySelector('#destroyPeer').click();`);
    await wait(`window.__turnTest.pending.length===1`);
    await run(`window.__turnTest.socket.disconnect();void window.__turnTest.socket.connect();`);
    await wait(`window.__turnTest.socket.connected`);
    await run(`window.__turnTest.delay=false;window.__turnTest.pending.shift()({ok:true,turnEnabled:true,ttlSeconds:600,iceServers:[{urls:'turn:127.0.0.1:9',username:'reconnect-test',credential:'reconnect-test'}]});`);
    await wait(`document.querySelector('#main').dataset.voiceState==='joined' && window.__turnTest.peers.length===2`);
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify({ passed: true, hidden: true, muted: win.webContents.isAudioMuted(),
        accepted, reconnectUpdatesCredentialsWithoutReplacingPeer: true, refreshFailureKeepsJoined: true, cancelled,
        reconnectDuringPreparation: true, mediaCapture: false, relayVerified: false, work }, null, 2));
    await cleanup(); process.stdout.write('PASS hidden TURN configuration browser: actual PeerJS RTC config, socket reconnect renewal, failed refresh, cancelled join. No media capture or relay service verification.\n'); app.quit();
}).catch(fail);
