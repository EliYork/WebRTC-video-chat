/* eslint-disable no-await-in-loop -- Bounded polling and sequential fixture clients preserve server message order. */
const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createServer } = require('node:net');
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');

const work = mkdtempSync(join(tmpdir(), 'voice-chat-history-order-'));
const artifacts = resolve(__dirname, '../../integrations/piik/artifacts/chat-history-order');
mkdirSync(artifacts, { recursive: true });
app.setPath('userData', join(work, 'profile'));
app.commandLine.appendSwitch('mute-audio'); app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
let win, server, deadline, output = '', failed = false;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
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
    deadline = setTimeout(() => { void fail(new Error('Chat history order test exceeded 45 seconds')); }, 45000);
    const reservation = createServer().listen(0, '127.0.0.1'); await once(reservation, 'listening');
    const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
    const origin = `http://127.0.0.1:${port}`, historyFile = join(work, 'history.json');
    const seed = roomId => ({ id: `${roomId}-seed`, roomId, senderName: 'fixture', content: `${roomId} seed`, createdAt: new Date().toISOString() });
    writeFileSync(historyFile, JSON.stringify({ lobby: [seed('lobby')], game: [seed('game')], project: [seed('project')] }));
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(TURN_|SFU_|PIIK_|TLS_)/.test(key)));
    server = spawn(process.execPath, [resolve(__dirname, '../../src/server.js')], {
        cwd: work, windowsHide: true, stdio: 'pipe',
        env: { ...env, ELECTRON_RUN_AS_NODE: '1', HOST: '127.0.0.1', PORT: String(port), USE_HTTPS: 'false', ENV: 'production',
            SFU_ENABLED: 'false', PIIK_ENABLED: 'false', CHAT_HISTORY_FILE: historyFile },
    });
    server.stdout.on('data', value => { output += value; }); server.stderr.on('data', value => { output += value; });
    let ready = false;
    for (let n = 0; n < 100; n++) {
        if (server.exitCode !== null) throw new Error(output);
        try { ready = (await fetch(origin + '/readyz')).ok; } catch { /* Listener is binding. */ }
        if (ready) break; await delay(40);
    }
    assert.ok(ready, output);
    win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: {
        sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true,
    } });
    win.webContents.setAudioMuted(true); win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.session.setPermissionCheckHandler(() => false);
    win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
        const url = new URL(details.url);
        callback({ cancel: /^(https?|wss?):$/.test(url.protocol) && (url.hostname !== '127.0.0.1' || url.port !== String(port)) });
    });
    const run = code => win.webContents.executeJavaScript(code);
    const wait = condition => run(`new Promise((resolve,reject)=>{const until=Date.now()+10000;const poll=()=>{if(${condition})resolve();else if(Date.now()>until)reject(Error('History order condition timeout: '+${JSON.stringify(condition)}));else setTimeout(poll,20)};poll()})`);
    await win.loadURL(origin + '/room/lobby');
    await wait(`document.documentElement.dataset.roomBoot==='ready' && document.querySelector('#chat-panel').getAttribute('aria-busy')==='false'`);
    await run(`(()=>{
        const t=window.__historyOrder={held:[],joins:[],publishers:[],sends:0};
        const emit=io.Socket.prototype.emit,emitEvent=io.Socket.prototype.emitEvent;
        io.Socket.prototype.emit=function(event,...args){
            if(event==='chat:join'&&!t.main)t.main=this;
            if(this===t.main&&event==='chat:join')t.joins.push(args[0].roomId);
            if(this===t.main&&event==='chat:send')t.sends++;
            return emit.call(this,event,...args);
        };
        io.Socket.prototype.emitEvent=function(args){
            if(this===t.main&&args[0]==='chat:history'){
                t.held.push({deliver:()=>emitEvent.call(this,args),contents:args[1].map(message=>message.content)});return;
            }
            return emitEvent.call(this,args);
        };
        t.rows=()=>Array.from(document.querySelectorAll('#chatMessages .chat-message-content'),row=>row.textContent);
        t.send=(client,n)=>new Promise((resolve,reject)=>client.timeout(4000).emit('chat:send',
            {roomId:'game',senderName:'fixture',content:'ordered '+n},(error,result)=>error||!result?.ok?reject(error||Error(result?.error)):resolve()));
        const select=room=>document.querySelector('[data-channel-room="'+room+'"] .tree-channel-link').click();
        select('game');select('project');select('game');
        const input=document.querySelector('#chatInput');input.value='draft after ordered history';input.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    await wait(`window.__historyOrder.held.length===1`);
    // Each real publisher sends at most five messages, preserving the unchanged
    // server rate limit while moving its 50-message snapshot past the first live rows.
    await run(`(async()=>{
        const t=window.__historyOrder;let next=1;
        for(let group=0;group<11;group++){
            const client=io(location.origin,{transports:['websocket'],forceNew:true});t.publishers.push(client);
            await new Promise((resolve,reject)=>{
                const timer=setTimeout(()=>reject(Error('Fixture publisher join timeout')),4000);
                client.once('chat:history',()=>{clearTimeout(timer);resolve();});
                client.once('connect',()=>client.emit('chat:join',{roomId:'game'}));
            });
            for(let n=0;n<5&&next<=54;n++)await t.send(client,next++);
        }
    })()`);
    await wait(`window.__historyOrder.rows().length===54`);
    await run(`void window.__historyOrder.held.shift().deliver();`);
    await wait(`window.__historyOrder.held.length===1 && window.__historyOrder.joins.length===2`);
    const snapshot = await run(`window.__historyOrder.held[0].contents`);
    assert.deepEqual(snapshot, Array.from({ length: 50 }, (_, n) => `ordered ${n + 5}`));
    await run(`window.__historyOrder.send(window.__historyOrder.publishers.at(-1),55)`);
    await wait(`window.__historyOrder.rows().length===55`);
    assert.equal(await run(`document.querySelector('#chat-panel').getAttribute('aria-busy')`), 'true');
    await run(`document.querySelector('#chatForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));`);
    assert.equal(await run(`window.__historyOrder.sends`), 0);
    await run(`void window.__historyOrder.held.shift().deliver();`);
    await wait(`document.querySelector('#chat-panel').getAttribute('aria-busy')==='false' && !document.querySelector('#chatForm button[type=submit]').disabled`);
    const merged = await run(`window.__historyOrder.rows()`);
    assert.deepEqual(merged, Array.from({ length: 55 }, (_, n) => `ordered ${n + 1}`));
    assert.equal(await run(`document.querySelector('#chatInput').value`), 'draft after ordered history');
    assert.deepEqual(await run(`window.__historyOrder.joins`), ['game', 'game']);
    await run(`document.querySelector('#chatForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));`);
    await wait(`window.__historyOrder.sends===1 && document.querySelector('#chatInput').value==='' && window.__historyOrder.rows().length===56`);
    let saved;
    for (let n = 0; n < 100; n++) {
        saved = JSON.parse(readFileSync(historyFile, 'utf8'));
        if (saved.game.at(-1).content === 'draft after ordered history') break; await delay(20);
    }
    assert.deepEqual(saved.game.map(message => message.content), [...Array.from({ length: 49 }, (_, n) => `ordered ${n + 7}`), 'draft after ordered history']);
    assert.equal(new Set(saved.game.map(message => message.id)).size, 50);
    assert.equal(saved.lobby.length, 1); assert.equal(saved.project.length, 1);
    const voice = await run(`document.querySelector('#main').dataset.voiceState`);
    assert.equal(voice, 'not-joined');
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify({
        passed: true, hidden: !win.isVisible(), muted: win.webContents.isAudioMuted(),
        realPublishers: 11, receivedLiveMessages: 55, snapshot, merged, uniqueVisibleMessages: new Set(merged).size,
        sentAfterReady: 1, persistedMessages: saved.game.length, persistedFirst: saved.game[0].content,
        persistedLast: saved.game.at(-1).content, voice, mediaCapture: false, work,
    }, null, 2));
    await cleanup();
    process.stdout.write('PASS hidden chat history order: 55 real live messages merge with an overlapping 50-row server snapshot in order; draft sends once, server retention stays 50. No media capture.\n');
    app.quit();
}).catch(fail);
