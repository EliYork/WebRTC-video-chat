/* eslint-disable no-await-in-loop -- One isolated hidden browser and bounded media polls. */
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createServer } = require('node:net');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const work = mkdtempSync(join(tmpdir(), 'voice-turn-expiry-'));
const artifacts = resolve(__dirname, '../../integrations/piik/artifacts/turn-expiry');
mkdirSync(artifacts, { recursive: true }); app.setPath('userData', join(work, 'profile'));
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
    let browser;
    try { browser = await win?.webContents.executeJavaScript(`(() => {const t=window.__expiry;return t&&{requests:t.requests,before:t.before,fail:t.fail,remoteClosed:t.lastRemoteClosed,turnConnections:t.rtcs.filter(pc=>pc.testHadTurn).map(pc=>pc.connectionState),peers:t.peers.length,remoteCalls:t.remoteCalls.length,voice:document.querySelector('#main').dataset.voiceState};})()`); } catch { /* Renderer might already be gone. */ }
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify({ passed: false, error: error.stack, output, browser, work }));
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
            TURN_URLS: 'turn:127.0.0.1:9?transport=udp', TURN_SHARED_SECRET: 'test-only-turn-expiry-secret-1234567890', TURN_TTL_SECONDS: '600' },
    });
    server.stdout.on('data', value => { output += value; }); server.stderr.on('data', value => { output += value; });
    let ready = false;
    for (let n = 0; n < 100; n++) {
        if (server.exitCode !== null) throw Error(output);
        try { ready = (await fetch(origin + '/readyz')).ok; } catch { /* Still binding. */ }
        if (ready) break; await delay(40);
    }
    assert.ok(ready, output);
    win = new BrowserWindow({ show: false, width: 1280, height: 900,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
    win.webContents.setAudioMuted(true); win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    const run = code => win.webContents.executeJavaScript(code);
    const wait = condition => run(`new Promise((resolve,reject)=>{const until=Date.now()+15000;const poll=()=>{if(${condition})resolve();else if(Date.now()>until)reject(Error('TURN expiry condition timeout: '+${JSON.stringify(condition)}));else setTimeout(poll,30)};poll()})`);
    await win.loadURL(origin + '/room/lobby');
    await wait(`document.documentElement.dataset.roomBoot==='ready' && document.querySelector('#chat-panel').dataset.chatConnectionState==='connected'`);
    await run(`(() => {
        const t=window.__expiry={offset:0,requests:0,fail:false,peers:[],rtcs:[],remoteCalls:[]};
        const now=performance.now.bind(performance), OriginalPeer=Peer, OriginalRTC=RTCPeerConnection, emit=io.Socket.prototype.emit, timer=window.setTimeout;
        Object.defineProperty(performance,'now',{value:()=>now()+t.offset,configurable:true});
        window.Peer=class extends OriginalPeer { constructor(...args){super(...args);t.peers.push(this);} };
        window.RTCPeerConnection=class extends OriginalRTC {
            constructor(config={},...args){
                // Record what the real app/PeerJS supplied, then omit public
                // STUN for this loopback-only test. The fake TURN is local too.
                super({...config,iceServers:(config.iceServers||[]).filter(x=>[x.urls].flat().every(u=>u.startsWith('turn:127.0.0.1:9')))},...args);
                this.testHadTurn=(config.iceServers||[]).some(x=>[x.urls].flat().some(u=>u.startsWith('turn:')));t.rtcs.push(this);
            }
        };
        window.setTimeout=function(callback,ms,...args){if(ms===30000)t.retry=callback;return timer(callback,ms,...args);};
        io.Socket.prototype.emit=function(event,...args){if(event==='rtc:ice'){t.requests++;if(t.fail){queueMicrotask(()=>args.at(-1)({ok:false,reason:'test-unavailable'}));return this;}}return emit.call(this,event,...args);};
        t.canvas=document.createElement('canvas');t.canvas.width=64;t.canvas.height=64;
        const context=t.canvas.getContext('2d');context.fillStyle='green';context.fillRect(0,0,64,64);
        t.stream=t.canvas.captureStream(5);
        t.frameTimer=setInterval(()=>{context.fillStyle=(Date.now()%2?'green':'blue');context.fillRect(0,0,64,64);},100);
        t.makeRemote=()=>new OriginalPeer(undefined,{host:location.hostname,port:location.port,path:'/peerjs',secure:false,config:{iceServers:[]}});
        t.offer=generation=>{const call=t.remote.call(t.peers[0].id,t.stream,{metadata:{voiceMediaDirection:'send',voiceMediaGeneration:generation,voiceMediaKinds:['video']}});call.on('close',()=>{t.lastRemoteClosed=true;});t.lastRemoteClosed=false;return call;};
        document.querySelector('#destroyPeer').click();
    })()`);
    await wait(`document.querySelector('#main').dataset.voiceState==='joined'`);
    await run(`(async()=>{
        const t=window.__expiry;t.remote=t.makeRemote();await new Promise((resolve,reject)=>{t.remote.on('open',resolve);t.remote.on('error',reject);});
        t.remote.on('call',call=>{t.remoteCalls.push(call);call.answer();});
        t.socket=io({forceNew:true,transports:['websocket'],query:{roomId:'lobby'}});await new Promise(resolve=>t.socket.on('connect',resolve));
        const joined=await new Promise(resolve=>t.socket.emit('voice:join',{roomId:'lobby',peerId:t.remote.id,clientSessionEpoch:1},resolve));if(!joined.ok)throw Error('remote join failed');
        t.socket.emit('presence:joinVoice',{senderName:'Synthetic test',hasMic:false,muted:true,cameraOn:true});
        await new Promise(resolve=>setTimeout(resolve,80));
        t.offset+=601000;t.fail=true;t.before=t.requests;t.first=t.offer(1);
    })()`);
    await wait(`window.__expiry.requests>window.__expiry.before`);
    await delay(100);
    const blockedIncoming = await run(`({turnConnections:window.__expiry.rtcs.filter(pc=>pc.testHadTurn).length,joined:document.querySelector('#main').dataset.voiceState==='joined'})`);
    assert.equal(blockedIncoming.turnConnections, 0); assert.equal(blockedIncoming.joined, true);
    await run(`window.__expiry.first.close();window.__expiry.fail=false;window.__expiry.second=window.__expiry.offer(2);void 0;`);
    await wait(`window.__expiry.rtcs.some(pc=>pc.testHadTurn && pc.connectionState==='connected')`);
    const decoded = await run(`(async()=>{const pc=window.__expiry.rtcs.find(pc=>pc.testHadTurn);const until=Date.now()+10000;while(Date.now()<until){const rows=[...(await pc.getStats()).values()];if(rows.some(row=>row.type==='inbound-rtp'&&row.kind==='video'&&row.framesDecoded>0)){window.__expiry.receivePc=pc;return true;}await new Promise(resolve=>setTimeout(resolve,50));}return false;})()`);
    assert.equal(decoded, true);
    await run(`(() => {const t=window.__expiry;t.offset+=601000;t.fail=true;t.before=t.requests;
        navigator.mediaDevices.getUserMedia=async constraints=>{if(constraints.audio)throw Error('Test forbids microphone capture');return new MediaStream([t.stream.getVideoTracks()[0].clone()]);};
        document.querySelector('#toggleVideo').click();})()`);
    await wait(`window.__expiry.requests>window.__expiry.before && document.querySelector('#toggleVideo').getAttribute('aria-pressed')==='true'`);
    const blockedOutgoing = await run(`({turnConnections:window.__expiry.rtcs.filter(pc=>pc.testHadTurn).length,reverseConnected:window.__expiry.receivePc.connectionState==='connected',remoteCalls:window.__expiry.remoteCalls.length})`);
    assert.equal(blockedOutgoing.turnConnections, 1); assert.equal(blockedOutgoing.reverseConnected, true); assert.equal(blockedOutgoing.remoteCalls, 0);
    await run(`window.__expiry.fail=false;window.__expiry.retry();`);
    await wait(`window.__expiry.remoteCalls.length===1 && window.__expiry.remoteCalls[0].peerConnection.connectionState==='connected'`);
    assert.equal(await run(`window.__expiry.receivePc.connectionState==='connected' && window.__expiry.peers.length===1 && document.querySelector('#main').dataset.voiceState==='joined'`), true);
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify({ passed: true, hidden: true, muted: win.webContents.isAudioMuted(),
        blockedIncoming, inboundSyntheticFramesDecoded: decoded, blockedOutgoing, outgoingAutomaticallyRecovered: true,
        samePeerAndReverseConnection: true, syntheticCanvasOnly: true, publicStunOmittedInTest: true, relayVerified: false, work }, null, 2));
    await cleanup(); process.stdout.write('PASS hidden TURN expiry browser: expired incoming/outgoing RTC creation blocked, synthetic video receives, refresh restores outgoing while preserving Peer and reverse RTC.\n'); app.quit();
}).catch(fail);
