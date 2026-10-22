/* eslint-disable no-await-in-loop -- Bounded polling observes one isolated loopback server and hidden full page. */
const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createServer } = require('node:net');
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');
const work = mkdtempSync(join(tmpdir(), 'chat-history-retry-'));
const artifacts = resolve(__dirname, '../../integrations/piik/artifacts/chat-history-retry');
mkdirSync(artifacts, { recursive: true });
app.setPath('userData', join(work, 'profile'));
app.commandLine.appendSwitch('mute-audio'); app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
let win, server, deadline, output = '', failed = false;
const cleanup = async () => {
    clearTimeout(deadline); win?.destroy();
    if (server && server.exitCode === null) { const exited = once(server, 'exit'); server.kill(); await exited; }
};
const fail = async error => {
    if (failed) return; failed = true;
    process.stderr.write(String(error.stack || error) + '\n');
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify({ passed: false, error: error.stack, output, work }, null, 2));
    await cleanup(); app.exit(1);
};
process.on('uncaughtException', fail); process.on('unhandledRejection', fail);

app.whenReady().then(async () => {
    deadline = setTimeout(() => { void fail(new Error('History retry test exceeded 30 seconds')); }, 30000);
    const reservation = createServer().listen(0, '127.0.0.1'); await once(reservation, 'listening');
    const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
    const origin = `http://localhost:${port}`, history = join(work, 'history.json');
    writeFileSync(history, JSON.stringify({ lobby: [{ id: 'seed', roomId: 'lobby', senderName: 'fixture',
        content: 'preserved history seed', createdAt: new Date().toISOString() }] }));
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(TURN_|SFU_|PIIK_|TLS_)/.test(key)));
    server = spawn(process.execPath, [resolve(__dirname, '../../src/server.js')], { cwd: work, windowsHide: true, stdio: 'pipe',
        env: { ...env, ELECTRON_RUN_AS_NODE: '1', HOST: '127.0.0.1', PORT: String(port), USE_HTTPS: 'false', ENV: 'production',
            SFU_ENABLED: 'false', PIIK_ENABLED: 'false', CHAT_HISTORY_FILE: history } });
    server.stdout.on('data', value => { output += value; }); server.stderr.on('data', value => { output += value; });
    let ready = false;
    for (let n = 0; n < 100; n++) {
        if (server.exitCode !== null) throw Error(output);
        try { ready = (await fetch(origin + '/readyz')).ok; } catch { /* Listener is binding. */ }
        if (ready) break; await new Promise(resolve => setTimeout(resolve, 40));
    }
    assert.ok(ready, output);
    win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: {
        sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true,
    } });
    win.webContents.setAudioMuted(true); win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    let permissionRequests = 0;
    win.webContents.session.setPermissionCheckHandler(() => false);
    win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => { permissionRequests++; callback(false); });
    win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
        const url = new URL(details.url);
        callback({ cancel: /^(https?|wss?):$/.test(url.protocol) && (url.hostname !== 'localhost' || url.port !== String(port)) });
    });
    const run = code => win.webContents.executeJavaScript(code);
    const wait = condition => run(`new Promise((resolve,reject)=>{const end=Date.now()+14000;const poll=()=>{if(${condition})resolve();else if(Date.now()>end)reject(Error('History condition timeout'));else setTimeout(poll,20)};poll()})`);
    await win.loadURL(origin + '/room/lobby');
    await wait(`document.documentElement.dataset.roomBoot==='ready' && document.querySelector('#chat-panel').getAttribute('aria-busy')==='false'`);
    await run(`(()=>{
        const t=window.__historyRetry={held:[],joins:[],publishers:[],sends:0,errors:[]};
        addEventListener('error',e=>t.errors.push(e.message));addEventListener('unhandledrejection',e=>t.errors.push(String(e.reason)));
        const emit=io.Socket.prototype.emit,emitEvent=io.Socket.prototype.emitEvent;
        io.Socket.prototype.emit=function(event,...args){
            if(event==='chat:join'&&(!t.socket||this===t.socket)){t.socket=this;t.joins.push({...args[0]});t.started ||= performance.now();}
            if(this===t.socket&&event==='chat:send')t.sends++;
            return emit.call(this,event,...args);
        };
        io.Socket.prototype.emitEvent=function(args){
            if(this===t.socket&&args[0]==='chat:history'){t.held.push({metadata:args[2],release:()=>emitEvent.call(this,args)});return;}
            return emitEvent.call(this,args);
        };
        t.snapshot=()=>({draft:document.querySelector('#chatInput').value,text:document.querySelector('#chatMessages').textContent,
            busy:document.querySelector('#chat-panel').getAttribute('aria-busy'),retry:!document.querySelector('.chat-history-retry').hidden,
            disabled:document.querySelector('#chatForm button[type=submit]').disabled,status:document.querySelector('.chat-panel-status').textContent,
            joins:t.joins.length,sends:t.sends});
        t.rows=()=>Array.from(document.querySelectorAll('#chatMessages .chat-message-content'),row=>row.textContent);
        t.publisher=async()=>{
            const client=io(location.origin,{transports:['websocket'],forceNew:true});t.publishers.push(client);
            await new Promise((resolve,reject)=>{
                const timer=setTimeout(()=>reject(Error('Retry fixture publisher join timeout')),4000);
                client.once('chat:history',()=>{clearTimeout(timer);resolve();});
                client.once('connect',()=>client.emit('chat:join',{roomId:'lobby'}));
            });
            return client;
        };
        t.send=(client,n)=>new Promise((resolve,reject)=>client.timeout(4000).emit('chat:send',
            {roomId:'lobby',senderName:'fixture',content:'retry ordered '+n},
            (error,result)=>error||!result?.ok?reject(error||Error(result?.error)):resolve()));
        t.submit=()=>document.querySelector('#chatForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
        const input=document.querySelector('#chatInput');input.value='draft preserved through retry';input.dispatchEvent(new Event('input',{bubbles:true}));
        dispatchEvent(new Event('offline'));dispatchEvent(new Event('online'));
    })()`);
    await wait(`window.__historyRetry.held.length===1`);
    const socketId = await run('window.__historyRetry.socket.id');
    // Each fixture client sends only five messages, retaining the server's
    // existing rate limit while advancing its real 50-row history snapshot.
    await run(`(async()=>{
        const t=window.__historyRetry;let next=1;
        for(let group=0;group<11;group++){
            const client=await t.publisher();
            for(let n=0;n<5;n++)await t.send(client,next++);
        }
    })()`);
    await wait(`window.__historyRetry.rows().length===56`);
    await wait(`!document.querySelector('.chat-history-retry').hidden`);
    const timedOut = await run('({...window.__historyRetry.snapshot(),elapsed:Math.round(performance.now()-window.__historyRetry.started)})');
    assert.ok(timedOut.elapsed >= 7500); assert.equal(timedOut.joins, 1); assert.equal(timedOut.sends, 0);
    assert.equal(timedOut.draft, 'draft preserved through retry'); assert.match(timedOut.text, /preserved history seed/);
    assert.match(timedOut.status, /同步超时/); assert.equal(timedOut.disabled, true);
    await run('window.__historyRetry.submit();document.querySelector(".chat-history-retry").click();');
    await wait(`window.__historyRetry.held.length===2`);
    const ids = await run('window.__historyRetry.held.map(row=>row.metadata.joinRequestId)');
    assert.equal(ids.every(Number.isSafeInteger), true); assert.notEqual(ids[0], ids[1]);
    await run(`(async()=>{const t=window.__historyRetry;await t.send(await t.publisher(),56);})()`);
    await wait(`window.__historyRetry.rows().length===57`);
    await run('window.__historyRetry.held[0].release();');
    const stale = await run('window.__historyRetry.snapshot()');
    assert.equal(stale.busy, 'true'); assert.equal(stale.disabled, true); assert.equal(stale.sends, 0);
    await run('window.__historyRetry.held[1].release();');
    await wait(`document.querySelector('#chat-panel').getAttribute('aria-busy')==='false'`);
    const recovered = await run('window.__historyRetry.snapshot()');
    assert.equal(recovered.disabled, false); assert.equal(recovered.retry, false);
    assert.equal(recovered.draft, 'draft preserved through retry'); assert.equal(recovered.sends, 0);
    const merged = await run('window.__historyRetry.rows()');
    assert.deepEqual(merged, Array.from({ length: 56 }, (_, n) => `retry ordered ${n + 1}`));
    assert.equal(await run('window.__historyRetry.socket.id'), socketId);
    await run('window.__historyRetry.submit();');
    await wait(`document.querySelector('#chatInput').value==='' && window.__historyRetry.rows().length===57`);
    let saved;
    for (let n = 0; n < 80; n++) {
        saved = JSON.parse(readFileSync(history, 'utf8'));
        if (saved.lobby.at(-1).content === 'draft preserved through retry') break; await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal(saved.lobby.length, 50); assert.equal(new Set(saved.lobby.map(row => row.id)).size, 50);
    assert.deepEqual(saved.lobby.map(row => row.content),
        [...Array.from({ length: 49 }, (_, n) => `retry ordered ${n + 8}`), 'draft preserved through retry']);
    const final = await run('({...window.__historyRetry.snapshot(),voice:document.querySelector("#main").dataset.voiceState,errors:window.__historyRetry.errors})');
    assert.equal(final.sends, 1); assert.equal(final.voice, 'not-joined'); assert.deepEqual(final.errors, []);
    assert.equal(permissionRequests, 0);
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify({ passed: true, hidden: !win.isVisible(), muted: win.webContents.isAudioMuted(),
        timedOut, stale, recovered, final, matchingRequestIds: true, sameSocket: true, savedMessages: saved.lobby.length,
        realPublishers: 12, receivedLiveMessages: 56, merged, uniqueMergedMessages: new Set(merged).size,
        historyDeliveryControlled: true, realTimeoutMs: 8000, permissionRequests, mediaCapture: false, work }, null, 2));
    await cleanup(); process.stdout.write('PASS hidden full-page history retry: 56 real live messages retained in order, stale history isolated, draft sent once and server history bounded to 50. No media capture.\n'); app.quit();
}).catch(fail);
