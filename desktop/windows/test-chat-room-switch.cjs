/* eslint-disable no-await-in-loop -- Bounded polling observes an isolated local server and hidden page. */
const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createServer } = require('node:net');
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');

const work = mkdtempSync(join(tmpdir(), 'voice-chat-room-switch-'));
const artifacts = resolve(__dirname, '../../integrations/piik/artifacts/chat-room-switch');
mkdirSync(artifacts, { recursive: true });
app.setPath('userData', join(work, 'profile'));
app.commandLine.appendSwitch('mute-audio'); app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
let win, server, deadline, output = '', failed = false;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const cleanup = async () => {
    clearTimeout(deadline);
    win?.destroy();
    if (server && server.exitCode === null) {
        const exited = once(server, 'exit'); server.kill(); await exited;
    }
};
const fail = async error => {
    if (failed) return; failed = true;
    process.stderr.write(String(error.stack || error) + '\n');
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify({ passed: false, error: error.stack, output, work }, null, 2));
    await cleanup(); app.exit(1);
};
process.on('uncaughtException', fail); process.on('unhandledRejection', fail);

app.whenReady().then(async () => {
    deadline = setTimeout(() => { void fail(new Error('Hidden chat room switch exceeded 45 seconds')); }, 45000);
    const reservation = createServer().listen(0, '127.0.0.1'); await once(reservation, 'listening');
    const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
    // Engine.IO keeps localhost sockets alive on browser offline events. This
    // lets the real page exercise that supported path without transport mocks.
    const origin = `http://localhost:${port}`, history = join(work, 'history.json');
    const seed = roomId => ({ id: roomId + '-seed', roomId, senderName: 'fixture', content: roomId + ' history seed', createdAt: new Date().toISOString() });
    writeFileSync(history, JSON.stringify({ lobby: [seed('lobby')], game: [seed('game')], project: [seed('project')] }));
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(TURN_|SFU_|PIIK_|TLS_)/.test(key)));
    server = spawn(process.execPath, [resolve(__dirname, '../../src/server.js')], {
        cwd: work, windowsHide: true, stdio: 'pipe',
        env: { ...env, ELECTRON_RUN_AS_NODE: '1', HOST: '127.0.0.1', PORT: String(port), USE_HTTPS: 'false', ENV: 'production',
            SFU_ENABLED: 'false', PIIK_ENABLED: 'false', CHAT_HISTORY_FILE: history },
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
        callback({ cancel: /^(https?|wss?):$/.test(url.protocol) && (url.hostname !== 'localhost' || url.port !== String(port)) });
    });
    const run = code => win.webContents.executeJavaScript(code);
    const wait = condition => run(`new Promise((resolve,reject)=>{const until=Date.now()+15000;const poll=()=>{if(${condition})resolve();else if(Date.now()>until)reject(Error('Chat room condition timeout: '+${JSON.stringify(condition)}));else setTimeout(poll,20)};poll()})`);
    await win.loadURL(origin + '/room/lobby');
    await wait(`document.documentElement.dataset.roomBoot==='ready' && document.querySelector('#chat-panel').getAttribute('aria-busy')==='false' && document.querySelector('#chatMessages').textContent.includes('lobby history seed')`);
    await run(`(()=>{
        const t=window.__chatRoomSwitch={held:[],joins:[],sends:0};
        const emit=io.Socket.prototype.emit,emitEvent=io.Socket.prototype.emitEvent;
        io.Socket.prototype.emit=function(event,...args){
            if(event==='chat:join'&&!t.socket)t.socket=this;
            if(this===t.socket&&event==='chat:join')t.joins.push(args[0].roomId);
            if(this===t.socket&&event==='chat:send'){
                t.sends++;
                if(t.rejectRoom)args[0]={...args[0],roomId:'project'};
            }
            return emit.call(this,event,...args);
        };
        io.Socket.prototype.emitEvent=function(args){
            if(this===t.socket&&args[0]==='chat:history'){
                t.held.push(()=>emitEvent.call(this,args));return;
            }
            return emitEvent.call(this,args);
        };
        t.select=room=>document.querySelector('[data-channel-room="'+room+'"] .tree-channel-link').click();
        t.submit=()=>document.querySelector('#chatForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
        t.snapshot=()=>({room:document.querySelector('#chat-panel').dataset.chatRoomId,
            busy:document.querySelector('#chat-panel').getAttribute('aria-busy'),
            status:document.querySelector('.chat-panel-status').textContent,
            statusKind:document.querySelector('.chat-panel-status').dataset.statusKind,
            disabled:document.querySelector('#chatForm button[type=submit]').disabled,
            draft:document.querySelector('#chatInput').value,
            text:document.querySelector('#chatMessages').textContent,sends:t.sends,joins:[...t.joins]});
        t.select('game');t.select('project');t.select('game');
        const input=document.querySelector('#chatInput');input.value='draft for current game';input.dispatchEvent(new Event('input',{bubbles:true}));
        t.submit();input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    })()`);
    await wait(`window.__chatRoomSwitch.held.length===1`);
    const pending = await run(`window.__chatRoomSwitch.snapshot()`);
    assert.equal(pending.room, 'game'); assert.equal(pending.busy, 'true'); assert.equal(pending.disabled, true);
    assert.equal(pending.sends, 0); assert.equal(pending.draft, 'draft for current game');

    // A second real socket broadcasts after the first history was generated.
    await run(`(()=>{
        const t=window.__chatRoomSwitch;t.publisher=io(location.origin,{transports:['websocket']});
        t.publisher.on('connect',()=>t.publisher.emit('chat:join',{roomId:'game'}));
        t.publisher.once('chat:history',()=>t.publisher.timeout(4000).emit('chat:send',
            {roomId:'game',senderName:'fixture',content:'live while switching'},(error,result)=>{t.published=!error&&result?.ok===true;}));
    })()`);
    await wait(`window.__chatRoomSwitch.published && document.querySelector('#chatMessages').textContent.includes('live while switching')`);
    await run(`void window.__chatRoomSwitch.held.shift()();`);
    await wait(`window.__chatRoomSwitch.held.length===1 && window.__chatRoomSwitch.joins.length===2`);
    const stale = await run(`window.__chatRoomSwitch.snapshot()`);
    assert.deepEqual(stale.joins, ['game', 'game']);
    assert.equal(stale.busy, 'true'); assert.equal(stale.disabled, true); assert.equal(stale.sends, 0);
    assert.match(stale.text, /live while switching/); assert.doesNotMatch(stale.text, /game history seed/);
    assert.equal(stale.draft, 'draft for current game');
    await run(`void window.__chatRoomSwitch.held.shift()();`);
    await wait(`document.querySelector('#chat-panel').getAttribute('aria-busy')==='false' && !document.querySelector('#chatForm button[type=submit]').disabled`);
    const current = await run(`window.__chatRoomSwitch.snapshot()`);
    assert.match(current.text, /game history seed/); assert.match(current.text, /live while switching/);
    assert.equal(current.draft, 'draft for current game');
    assert.equal(await run(`document.querySelectorAll('#chatMessages .chat-message').length`), 2);
    await run(`window.__chatRoomSwitch.submit();`);
    await wait(`document.querySelector('#chatInput').value==='' && window.__chatRoomSwitch.sends===1 && document.querySelectorAll('#chatMessages .chat-message').length===3`);
    let saved;
    for (let n = 0; n < 100; n++) {
        try { saved = JSON.parse(readFileSync(history, 'utf8')); } catch { /* Await atomic save. */ }
        if (saved?.game?.length === 3) break; await delay(20);
    }
    assert.equal(saved.game.length, 3); assert.equal(new Set(saved.game.map(message => message.id)).size, 3);
    assert.equal(saved.lobby.length, 1); assert.equal(saved.project.length, 1);

    // Browser network events can fire without Socket.IO disconnecting. Keep the
    // real connection and hold the newly requested history until checks finish.
    await run(`(()=>{
        const t=window.__chatRoomSwitch;
        t.socketId=t.socket.id;t.connects=0;t.disconnects=0;
        t.socket.on('connect',()=>t.connects++);t.socket.on('disconnect',()=>t.disconnects++);
        const input=document.querySelector('#chatInput');input.value='draft after brief offline';input.dispatchEvent(new Event('input',{bubbles:true}));
        window.dispatchEvent(new Event('offline'));
    })()`);
    const offline = await run(`window.__chatRoomSwitch.snapshot()`);
    assert.equal(offline.busy, 'true'); assert.equal(offline.disabled, true);
    assert.equal(offline.draft, 'draft after brief offline');
    assert.match(offline.text, /draft for current game/);
    await run(`window.dispatchEvent(new Event('online'));`);
    await wait(`window.__chatRoomSwitch.held.length===1 && window.__chatRoomSwitch.joins.length===3`);
    await run(`window.__chatRoomSwitch.submit();document.querySelector('#chatInput').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));`);
    const onlinePending = await run(`window.__chatRoomSwitch.snapshot()`);
    assert.equal(onlinePending.busy, 'true'); assert.equal(onlinePending.disabled, true);
    assert.equal(onlinePending.sends, 1); assert.equal(onlinePending.draft, 'draft after brief offline');
    await run(`void window.__chatRoomSwitch.held.shift()();`);
    await wait(`document.querySelector('#chat-panel').getAttribute('aria-busy')==='false' && !document.querySelector('#chatForm button[type=submit]').disabled`);
    const onlineReady = await run(`({...window.__chatRoomSwitch.snapshot(),
        sameSocket:window.__chatRoomSwitch.socket.id===window.__chatRoomSwitch.socketId,
        connected:window.__chatRoomSwitch.socket.connected,connects:window.__chatRoomSwitch.connects,disconnects:window.__chatRoomSwitch.disconnects})`);
    assert.equal(onlineReady.sameSocket, true); assert.equal(onlineReady.connected, true);
    assert.equal(onlineReady.connects, 0); assert.equal(onlineReady.disconnects, 0);
    assert.equal(onlineReady.draft, 'draft after brief offline');
    assert.equal(await run(`document.querySelectorAll('#chatMessages .chat-message').length`), 3);
    await run(`window.__chatRoomSwitch.submit();`);
    await wait(`document.querySelector('#chatInput').value==='' && window.__chatRoomSwitch.sends===2 && document.querySelectorAll('#chatMessages .chat-message').length===4`);
    for (let n = 0; n < 100; n++) {
        saved = JSON.parse(readFileSync(history, 'utf8'));
        if (saved.game.length === 4) break; await delay(20);
    }
    assert.equal(saved.game.length, 4); assert.equal(new Set(saved.game.map(message => message.id)).size, 4);
    assert.equal(saved.lobby.length, 1); assert.equal(saved.project.length, 1);

    // Force one real wrong-room rejection; the server and ACK are unchanged.
    // Its retained error must yield to offline and return after online/history.
    await run(`(()=>{
        const t=window.__chatRoomSwitch;t.rejectRoom=true;
        t.status=()=>({text:document.querySelector('.chat-panel-status').textContent,
            kind:document.querySelector('.chat-panel-status').dataset.statusKind,
            draft:document.querySelector('#chatInput').value,sends:t.sends});
        const input=document.querySelector('#chatInput');input.value='draft explicitly rejected';input.dispatchEvent(new Event('input',{bubbles:true}));t.submit();
    })()`);
    await wait(`document.querySelector('.chat-panel-status').dataset.statusKind==='error'`);
    const rejected = await run(`window.__chatRoomSwitch.status()`);
    assert.match(rejected.text, /发送失败/); assert.equal(rejected.sends, 3);
    assert.equal(rejected.draft, 'draft explicitly rejected');
    assert.equal(await run(`document.querySelectorAll('#chatMessages .chat-message').length`), 4);
    await run(`window.dispatchEvent(new Event('offline'));`);
    const rejectionOffline = await run(`window.__chatRoomSwitch.status()`);
    assert.equal(rejectionOffline.kind, 'connection'); assert.match(rejectionOffline.text, /当前离线/);
    assert.equal(rejectionOffline.draft, rejected.draft); assert.equal(rejectionOffline.sends, 3);
    await run(`window.dispatchEvent(new Event('online'));`);
    await wait(`window.__chatRoomSwitch.held.length===1 && window.__chatRoomSwitch.joins.length===4`);
    await run(`void window.__chatRoomSwitch.held.shift()();`);
    await wait(`document.querySelector('#chat-panel').getAttribute('aria-busy')==='false' && !document.querySelector('#chatForm button[type=submit]').disabled`);
    const rejectionRestored = await run(`window.__chatRoomSwitch.status()`);
    assert.equal(rejectionRestored.kind, 'error'); assert.match(rejectionRestored.text, /发送失败/);
    assert.equal(rejectionRestored.draft, rejected.draft); assert.equal(rejectionRestored.sends, 3);
    await run(`(()=>{
        const t=window.__chatRoomSwitch;t.rejectRoom=false;
        const input=document.querySelector('#chatInput');input.value='edited after rejection';input.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    assert.equal(await run(`document.querySelector('.chat-panel-status').hidden`), true);
    await run(`window.__chatRoomSwitch.submit();`);
    await wait(`window.__chatRoomSwitch.sends===4 && document.querySelector('#chatInput').value==='' && document.querySelectorAll('#chatMessages .chat-message').length===5`);
    for (let n = 0; n < 100; n++) {
        saved = JSON.parse(readFileSync(history, 'utf8'));
        if (saved.game.length === 5) break; await delay(20);
    }
    assert.equal(saved.game.length, 5); assert.equal(new Set(saved.game.map(message => message.id)).size, 5);
    assert.equal(saved.game.some(message => message.content === rejected.draft), false);
    assert.equal(saved.game.at(-1).content, 'edited after rejection');
    assert.equal(saved.lobby.length, 1); assert.equal(saved.project.length, 1);
    const voice = await run(`document.querySelector('#main').dataset.voiceState`);
    assert.equal(voice, 'not-joined');
    win.setContentSize(390, 844);
    await wait(`document.querySelector('#main').dataset.viewportMode==='compact'`);
    const compositionEscape = await run(`(()=>{
        const root=document.querySelector('#main'),input=document.querySelector('#chatInput');
        if(root.dataset.mobilePanel!=='chat')document.querySelector('#stageChatToggle').click();
        input.value='输入中的草稿';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();
        input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'输入'}));
        const escape=new KeyboardEvent('keydown',{key:'Escape',isComposing:true,bubbles:true,cancelable:true});
        input.dispatchEvent(escape);
        return {panel:root.dataset.mobilePanel,focused:document.activeElement===input,draft:input.value,
            prevented:escape.defaultPrevented,isComposing:escape.isComposing,sends:window.__chatRoomSwitch.sends};
    })()`);
    assert.equal(compositionEscape.isComposing, true);
    assert.equal(compositionEscape.panel, 'chat'); assert.equal(compositionEscape.focused, true);
    assert.equal(compositionEscape.draft, '输入中的草稿'); assert.equal(compositionEscape.prevented, false);
    assert.equal(compositionEscape.sends, 4);
    const normalEscape = await run(`(()=>{
        const input=document.querySelector('#chatInput');
        input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'输入'}));
        input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
        return {panel:document.querySelector('#main').dataset.mobilePanel,draft:input.value,
            focused:document.activeElement===document.querySelector('#stageStageToggle'),sends:window.__chatRoomSwitch.sends};
    })()`);
    assert.equal(normalEscape.panel, 'stage'); assert.equal(normalEscape.focused, true);
    assert.equal(normalEscape.draft, '输入中的草稿'); assert.equal(normalEscape.sends, 4);
    await run(`void window.__chatRoomSwitch.publisher.disconnect();`);
    const reloaded = once(win.webContents, 'did-finish-load');
    win.webContents.reload(); await reloaded;
    await wait(`document.documentElement.dataset.roomBoot==='ready' && document.querySelector('#chat-panel').getAttribute('aria-busy')==='false' && document.querySelector('#main').dataset.viewportMode==='compact'`);
    const initialMobileScroll = await run(`(()=>{
        const messages=document.querySelector('#chatMessages');
        const spacer=document.createElement('li');spacer.style.cssText='height:2400px;flex-shrink:0';
        spacer.textContent='Controlled scroll fixture';messages.prepend(spacer);
        document.querySelector('#stageChatToggle').click();
        return {panel:document.querySelector('#main').dataset.mobilePanel,top:messages.scrollTop,
            max:messages.scrollHeight-messages.clientHeight};
    })()`);
    assert.equal(initialMobileScroll.panel, 'chat'); assert.ok(initialMobileScroll.max > 1000);
    assert.ok(Math.abs(initialMobileScroll.top-initialMobileScroll.max) <= 1, 'first mobile opening follows latest');
    win.setContentSize(1280, 900);
    await wait(`document.querySelector('#main').dataset.viewportMode==='wide'`);
    await run(`(()=>{
        const toggle=document.querySelector('#stageChatToggle'),messages=document.querySelector('#chatMessages');
        if(document.querySelector('#chat-panel').inert)toggle.click();
        messages.scrollTop=120;toggle.click();toggle.click();messages.scrollTop=610;
    })()`);
    win.setContentSize(390, 844);
    await wait(`document.querySelector('#main').dataset.viewportMode==='compact' && document.querySelector('#main').dataset.mobilePanel==='stage'`);
    const compactReadingScroll = await run(`(()=>{
        document.querySelector('#stageChatToggle').click();
        return {panel:document.querySelector('#main').dataset.mobilePanel,top:document.querySelector('#chatMessages').scrollTop};
    })()`);
    assert.equal(compactReadingScroll.panel, 'chat'); assert.equal(compactReadingScroll.top, 610);
    await run(`(()=>{
        document.querySelector('#stageChatToggle').click();
        document.querySelector('#stageChannelsToggle').click();
        document.querySelector('[data-channel-room="lobby"] .tree-channel-link').click();
    })()`);
    await wait(`document.querySelector('#chat-panel').dataset.chatRoomId==='lobby' && document.querySelector('#chat-panel').getAttribute('aria-busy')==='false'`);
    const changedRoomScroll = await run(`(()=>{
        const messages=document.querySelector('#chatMessages');
        for(const item of messages.querySelectorAll('.chat-message'))item.style.minHeight='3000px';
        document.querySelector('#stageChatToggle').click();
        return {room:document.querySelector('#chat-panel').dataset.chatRoomId,
            panel:document.querySelector('#main').dataset.mobilePanel,top:messages.scrollTop,
            max:messages.scrollHeight-messages.clientHeight,count:messages.querySelectorAll('.chat-message').length};
    })()`);
    assert.equal(changedRoomScroll.room, 'lobby'); assert.equal(changedRoomScroll.panel, 'chat');
    assert.equal(changedRoomScroll.count, 1); assert.ok(changedRoomScroll.max > 1000);
    assert.ok(Math.abs(changedRoomScroll.top-changedRoomScroll.max) <= 1,
        'new channel must not restore the previous channel scroll offset: '+JSON.stringify(changedRoomScroll));
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify({
        passed: true, hidden: !win.isVisible(), muted: win.webContents.isAudioMuted(), pending, stale, current,
        sentAfterReady: 1, roomSwitchPersistedGameMessages: 3, networkRecoveryPersistedGameMessages: 4, persistedGameMessages: 5,
        networkRecovery: { offline, pending: onlinePending, ready: onlineReady, sentAfterReady: 1 },
        rejectionRecovery: { rejected, offline: rejectionOffline, restored: rejectionRestored, editedDraftSentOnce: true, rejectedDraftSaved: false },
        compositionEscape, normalEscape, initialMobileScroll, compactReadingScroll, changedRoomScroll,
        mediaCapture: false, voice, work,
    }, null, 2));
    await cleanup();
    process.stdout.write('PASS hidden chat room switch, online and rejection recovery: stale history ignored, drafts preserved, offline outranks rejection, edited draft sends once, five distinct messages saved. No media capture.\n');
    app.quit();
}).catch(fail);
