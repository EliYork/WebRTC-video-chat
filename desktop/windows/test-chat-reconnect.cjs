/* eslint-disable no-await-in-loop -- Bounded polling observes one isolated hidden page and its local storage fixture. */
const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createServer } = require('node:net');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');
const work = mkdtempSync(join(tmpdir(), 'voice-chat-reconnect-'));
const artifacts = resolve(__dirname, '../../integrations/piik/artifacts/chat-reconnect');
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
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify({ passed: false, error: error.stack, output, work }, null, 2));
    await cleanup(); app.exit(1);
};
process.on('uncaughtException', fail); process.on('unhandledRejection', fail);
app.whenReady().then(async () => {
    const reservation = createServer().listen(0, '127.0.0.1'); await once(reservation, 'listening');
    const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
    const origin = `http://127.0.0.1:${port}`, history = join(work, 'history.json');
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(TURN_|SFU_|PIIK_|TLS_)/.test(key)));
    server = spawn(process.execPath, [resolve(__dirname, '../../src/server.js')], {
        cwd: work, windowsHide: true, stdio: 'pipe',
        env: { ...env, ELECTRON_RUN_AS_NODE: '1', HOST: '127.0.0.1', PORT: String(port), USE_HTTPS: 'false', ENV: 'production',
            SFU_ENABLED: 'false', PIIK_ENABLED: 'false', CHAT_HISTORY_FILE: history },
    });
    server.stdout.on('data', value => { output += value; }); server.stderr.on('data', value => { output += value; });
    let ready = false;
    for (let n = 0; n < 100; n++) {
        if (server.exitCode !== null) throw Error(output);
        try { ready = (await fetch(origin + '/readyz')).ok; } catch { /* Listener is still binding. */ }
        if (ready) break; await delay(40);
    }
    assert.ok(ready, output);
    win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: {
        sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true,
    } });
    win.webContents.setAudioMuted(true); win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
        const url = new URL(details.url);
        callback({ cancel: /^(https?|wss?):$/.test(url.protocol) && (url.hostname !== '127.0.0.1' || url.port !== String(port)) });
    });
    const run = code => win.webContents.executeJavaScript(code);
    const wait = condition => run(`new Promise((resolve,reject)=>{const until=Date.now()+15000;const poll=()=>{if(${condition})resolve();else if(Date.now()>until)reject(Error('Chat reconnect condition timeout: '+${JSON.stringify(condition)}));else setTimeout(poll,30)};poll()})`);
    await win.loadURL(origin + '/room/lobby');
    await wait(`document.documentElement.dataset.roomBoot==='ready' && document.querySelector('#chat-panel').dataset.chatConnectionState==='connected' && document.querySelector('#chat-panel').getAttribute('aria-busy')==='false'`);
    await run(`(()=>{
        const t=window.__chatReconnect={mode:'hold',held:[],dropIds:new Set(),sends:0,dropped:0};
        const emit=io.Socket.prototype.emit,onack=io.Socket.prototype.onack;
        io.Socket.prototype.emit=function(event,...args){
            if(event==='chat:send'){
                t.socket=this;t.sends++;
                if(t.mode==='drop')t.dropIds.add(this.ids);
                if(t.mode==='hold'){
                    const acknowledge=args.pop();args.push((...values)=>t.held.push(()=>acknowledge(...values)));
                }
            }
            return emit.call(this,event,...args);
        };
        // Drop only a received chat ACK packet before Socket.IO handles it.
        // Its actual 8-second timeout remains active; no timer is shortened.
        io.Socket.prototype.onack=function(packet){if(t.dropIds.delete(packet.id)){t.dropped++;return;}return onack.call(this,packet);};
        t.send=text=>{const input=document.querySelector('#chatInput');input.value=text;input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#chatForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));};
        t.send('第一条已接收，确认延后');
    })()`);
    await wait(`window.__chatReconnect.held.length===1 && document.querySelectorAll('#chatMessages .chat-message').length===1`);
    assert.equal(await run(`document.querySelector('#chatForm button[type=submit]').getAttribute('aria-busy')`), 'true');
    await run(`window.__chatReconnect.socket.disconnect();void window.__chatReconnect.socket.connect();`);
    await wait(`document.querySelector('#chat-panel').dataset.chatConnectionState==='connected' && document.querySelector('#chat-panel').getAttribute('aria-busy')==='false' && !document.querySelector('#chatForm button[type=submit]').disabled`);
    assert.match(await run(`document.querySelector('.chat-panel-status').textContent`), /核对聊天记录/);
    await run(`window.__chatReconnect.send('第二条正常发送');`);
    await wait(`window.__chatReconnect.held.length===2`);
    await run(`window.__chatReconnect.held.shift()();`);
    const stale = await run(`({draft:document.querySelector('#chatInput').value,busy:document.querySelector('#chatForm button[type=submit]').getAttribute('aria-busy')})`);
    assert.equal(stale.draft, '第二条正常发送'); assert.equal(stale.busy, 'true');
    await run(`(()=>{
        const input=document.querySelector('#chatInput');input.value='临时编辑';input.dispatchEvent(new Event('input',{bubbles:true}));
        input.value='第二条正常发送';input.dispatchEvent(new Event('input',{bubbles:true}));
        document.querySelector('#stageChatToggle').focus();
    })()`);
    await run(`window.__chatReconnect.held.shift()();`);
    await wait(`document.querySelector('#chatForm button[type=submit]').getAttribute('aria-busy')==='false' && !document.querySelector('#chatForm button[type=submit]').disabled`);
    const editedDraft = await run(`({draft:document.querySelector('#chatInput').value,focused:document.activeElement?.id,sends:window.__chatReconnect.sends})`);
    assert.equal(editedDraft.draft, '第二条正常发送'); assert.equal(editedDraft.focused, 'stageChatToggle'); assert.equal(editedDraft.sends, 2);
    await run(`window.__chatReconnect.mode='drop';window.__chatReconnect.timeoutStarted=Date.now();window.__chatReconnect.send('第三条已接收，确认丢失');`);
    await wait(`window.__chatReconnect.dropped===1 && document.querySelectorAll('#chatMessages .chat-message').length===3`);
    await wait(`document.querySelector('.chat-panel-status').textContent.includes('发送结果未确认') && !document.querySelector('#chatForm button[type=submit]').disabled`);
    const uncertain = await run(`({elapsed:Date.now()-window.__chatReconnect.timeoutStarted,draft:document.querySelector('#chatInput').value,status:document.querySelector('.chat-panel-status').textContent,sends:window.__chatReconnect.sends,voice:document.querySelector('#main').dataset.voiceState})`);
    assert.ok(uncertain.elapsed >= 7500); assert.equal(uncertain.sends, 3);
    assert.equal(uncertain.draft, '第三条已接收，确认丢失'); assert.equal(uncertain.voice, 'not-joined');
    assert.doesNotMatch(uncertain.status, /发送失败/);
    writeFileSync(join(artifacts, 'uncertain.png'), (await win.webContents.capturePage()).toPNG());
    await run(`window.__chatReconnect.mode='hold';window.__chatReconnect.send('第四条恢复发送');`);
    await wait(`window.__chatReconnect.held.length===1 && document.querySelectorAll('#chatMessages .chat-message').length===4`);
    await run(`(()=>{
        const t=window.__chatReconnect,input=document.querySelector('#chatInput');
        document.querySelector('#stageChatToggle').focus();
        t.originalFocus=input.focus;t.focusCalls=0;
        input.focus=function(...args){t.focusCalls++;return t.originalFocus.apply(this,args);};
        t.held.shift()();
    })()`);
    await wait(`document.querySelector('#chatInput').value==='' && document.querySelectorAll('#chatMessages .chat-message').length===4 && document.querySelector('.chat-panel-status').hidden`);
    const focusPreserved = await run(`({draft:document.querySelector('#chatInput').value,focused:document.activeElement?.id,focusCalls:window.__chatReconnect.focusCalls,sends:window.__chatReconnect.sends,documentFocused:document.hasFocus()})`);
    assert.equal(focusPreserved.draft, ''); assert.equal(focusPreserved.focused, 'stageChatToggle');
    assert.equal(focusPreserved.focusCalls, 0); assert.equal(focusPreserved.sends, 4);
    await run(`void (document.querySelector('#chatInput').focus=window.__chatReconnect.originalFocus);`);
    await run(`window.__chatReconnect.mode='hold';window.__chatReconnect.send('第五条确认期间开始组合输入');`);
    await wait(`window.__chatReconnect.held.length===1 && document.querySelectorAll('#chatMessages .chat-message').length===5`);
    await run(`document.querySelector('#chatInput').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));window.__chatReconnect.held.shift()();`);
    await wait(`document.querySelector('#chatForm button[type=submit]').getAttribute('aria-busy')==='false'`);
    await run(`document.querySelector('#chatForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));document.querySelector('#chatInput').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));`);
    const composingDraft = await run(`({draft:document.querySelector('#chatInput').value,sends:window.__chatReconnect.sends,busy:document.querySelector('#chatForm button[type=submit]').getAttribute('aria-busy')})`);
    assert.equal(composingDraft.draft, '第五条确认期间开始组合输入'); assert.equal(composingDraft.sends, 5); assert.equal(composingDraft.busy, 'false');
    await run(`document.querySelector('#chatInput').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));`);
    let saved;
    for (let n = 0; n < 100; n++) {
        try { saved = JSON.parse(readFileSync(history, 'utf8')).lobby; } catch { /* Await first save. */ }
        if (saved?.length === 5) break; await delay(20);
    }
    assert.equal(saved.length, 5); assert.equal(new Set(saved.map(message => message.id)).size, 5);
    await win.reload();
    await wait(`document.querySelectorAll('#chatMessages .chat-message').length===5`);
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify({
        passed: true, hidden: true, muted: win.webContents.isAudioMuted(), reconnectReleasedSending: true,
        staleAckPreservedNewSend: true, editedDraft, composingDraft, focusPreserved, uncertain, realAckTimeout: true, automaticResends: 0,
        persistedMessages: saved.length, historyReload: true, mediaCapture: false, work,
    }, null, 2));
    await cleanup();
    process.stdout.write('PASS hidden chat reconnect: late ACK isolated, edited/composing drafts and newer focus preserved, real 8-second timeout is uncertain, five distinct messages saved once. No media capture.\n');
    app.quit();
}).catch(fail);
