/* eslint-disable no-await-in-loop -- Bounded polls observe one isolated local server and hidden page. */
const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createServer } = require('node:net');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');
const work = mkdtempSync(join(tmpdir(), 'voice-chat-retention-'));
const artifacts = resolve(__dirname, '../../integrations/piik/artifacts/chat-retention');
mkdirSync(artifacts, { recursive: true });
app.setPath('userData', join(work, 'profile'));
app.commandLine.appendSwitch('mute-audio'); app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
let win, server, output = '', failed = false;
const browserErrors = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const cleanup = async () => {
    win?.destroy();
    if (server && server.exitCode === null) { const exited = once(server, 'exit'); server.kill(); await exited; }
};
const fail = async error => {
    if (failed) return; failed = true;
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify({ passed: false, error: error.stack, output, browserErrors, work }, null, 2));
    await cleanup(); app.exit(1);
};
process.on('uncaughtException', fail); process.on('unhandledRejection', fail);
app.whenReady().then(async () => {
    const reservation = createServer().listen(0, '127.0.0.1'); await once(reservation, 'listening');
    const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
    const origin = `http://127.0.0.1:${port}`, historyFile = join(work, 'history.json');
    writeFileSync(historyFile, JSON.stringify({ lobby: Array.from({ length: 50 }, (_, n) => ({
        id: `refresh-seed-${n}`, roomId: 'lobby', senderName: 'fixture', createdAt: new Date().toISOString(),
        content: `刷新记录 ${n}：用于验证同频道重新加载时的阅读位置` + (n % 3 === 0 ? '\n第二行内容' : ''),
    })) }));
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(TURN_|SFU_|PIIK_|TLS_)/.test(key)));
    server = spawn(process.execPath, [resolve(__dirname, '../../src/server.js')], {
        cwd: work, windowsHide: true, stdio: 'pipe',
        env: { ...env, ELECTRON_RUN_AS_NODE: '1', HOST: '127.0.0.1', PORT: String(port), USE_HTTPS: 'false', ENV: 'production',
            SFU_ENABLED: 'false', PIIK_ENABLED: 'false', CHAT_HISTORY_FILE: historyFile },
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
    win.webContents.on('console-message', event => browserErrors.push(event.message));
    win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
        const url = new URL(details.url);
        callback({ cancel: /^(https?|wss?):$/.test(url.protocol) && (url.hostname !== '127.0.0.1' || url.port !== String(port)) });
    });
    const run = code => win.webContents.executeJavaScript(code);
    const wait = condition => run(`new Promise((resolve,reject)=>{const until=Date.now()+10000;const poll=()=>{if(${condition})resolve();else if(Date.now()>until)reject(Error('Chat retention condition timeout'));else setTimeout(poll,30)};poll()})`);
    await win.loadURL(origin + '/room/lobby');
    await wait(`document.documentElement.dataset.roomBoot==='ready' && document.querySelector('#chat-panel').dataset.chatConnectionState==='connected' && document.querySelector('#chat-panel').getAttribute('aria-busy')==='false'`);
    await run(`(()=>{
        window.__retention={next:0};
        const t=window.__retention;
        const emit=io.Socket.prototype.emit;
        io.Socket.prototype.emit=function(event,...args){if(event==='chat:send')t.socket=this;return emit.call(this,event,...args);};
        const input=document.querySelector('#chatInput');input.value='测试连接确认';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#chatForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    })()`);
    await wait(`window.__retention.socket && document.querySelector('#chatInput').value===''`);
    await run(`(()=>{
        const t=window.__retention,c=document.querySelector('#chatMessages');
        c.scrollTop=c.scrollHeight/2;
        const anchor=Array.from(c.querySelectorAll('.chat-message')).find(row=>row.getBoundingClientRect().bottom>c.getBoundingClientRect().top);
        t.refreshAnchorText=anchor.querySelector('.chat-message-content').textContent;
        t.refreshAnchorOffset=anchor.getBoundingClientRect().top-c.getBoundingClientRect().top;
        t.rowsBeforeRefresh=c.querySelectorAll('.chat-message').length;
        const input=document.querySelector('#chatInput');input.value='刷新期间保留草稿';input.dispatchEvent(new Event('input',{bubbles:true}));
        t.socket.disconnect();t.socket.connect();
    })()`);
    await wait(`document.querySelector('#chat-panel').getAttribute('aria-busy')==='false' && document.querySelector('#chat-panel').dataset.chatConnectionState==='connected' && document.querySelectorAll('#chatMessages .chat-message').length===50`);
    await delay(80);
    const historyRefresh = await run(`(()=>{
        const t=window.__retention,c=document.querySelector('#chatMessages');
        const anchor=Array.from(c.querySelectorAll('.chat-message')).find(row=>row.querySelector('.chat-message-content').textContent===t.refreshAnchorText);
        return {beforeRows:t.rowsBeforeRefresh,rows:c.querySelectorAll('.chat-message').length,anchorSurvived:!!anchor,
            shift:anchor?Math.abs(anchor.getBoundingClientRect().top-c.getBoundingClientRect().top-t.refreshAnchorOffset):null,
            distanceFromBottom:c.scrollHeight-c.scrollTop-c.clientHeight,draft:document.querySelector('#chatInput').value};
    })()`);
    assert.equal(historyRefresh.beforeRows, 51); assert.equal(historyRefresh.rows, 50);
    assert.equal(historyRefresh.anchorSurvived, true); assert.ok(historyRefresh.shift <= 1, JSON.stringify(historyRefresh));
    assert.ok(historyRefresh.distanceFromBottom > 48); assert.equal(historyRefresh.draft, '刷新期间保留草稿');
    const missingHistoryAnchor = await run(`(()=>{
        const t=window.__retention,c=document.querySelector('#chatMessages');
        t.socket.emitEvent(['chat:history',Array.from({length:50},(_,n)=>({id:'replacement-'+n,roomId:'lobby',content:'不再包含原阅读消息的记录 '+n})),{roomId:'lobby'}]);
        return {scrollTop:c.scrollTop,distanceFromBottom:c.scrollHeight-c.scrollTop-c.clientHeight,rows:c.querySelectorAll('.chat-message').length};
    })()`);
    assert.equal(missingHistoryAnchor.scrollTop, 0); assert.equal(missingHistoryAnchor.rows, 50);
    assert.ok(missingHistoryAnchor.distanceFromBottom > 48);
    await run(`(()=>{
        const t=window.__retention;
        t.socket.emitEvent(['chat:history',[],{roomId:'lobby'}]);
        t.append=()=>{const n=t.next++;return t.socket.emitEvent(['chat:message',{id:'synthetic-'+n,roomId:'lobby',senderName:'合成消息',createdAt:new Date().toISOString(),content:'消息 '+n+'：不同长度的换行文本用于验证阅读位置'+(n%3===0?'\\n第二行内容':'')}]);};
        for(let n=0;n<500;n++)t.append();
    })()`);
    const reading = await run(`(()=>{
        const c=document.querySelector('#chatMessages'),t=window.__retention;
        c.scrollTop=c.scrollHeight/2;
        t.anchor=Array.from(c.querySelectorAll('.chat-message')).find(el=>el.getBoundingClientRect().bottom>c.getBoundingClientRect().top);
        t.anchorTop=t.anchor.getBoundingClientRect().top-c.getBoundingClientRect().top;
        t.append();
        return {rows:c.querySelectorAll('.chat-message').length,survived:t.anchor.isConnected,shift:Math.abs(t.anchor.getBoundingClientRect().top-c.getBoundingClientRect().top-t.anchorTop),notes:c.querySelectorAll('.chat-retention-note').length};
    })()`);
    assert.equal(reading.rows, 500); assert.equal(reading.survived, true);
    assert.ok(reading.shift <= 1, JSON.stringify(reading)); assert.equal(reading.notes, 1);
    await delay(80);
    assert.ok(await run(`Math.abs(window.__retention.anchor.getBoundingClientRect().top-document.querySelector('#chatMessages').getBoundingClientRect().top-window.__retention.anchorTop)<=1`), 'reading anchor must remain stable after the render cycle');
    const repeatedReadingShift = await run(`(()=>{
        const t=window.__retention,c=document.querySelector('#chatMessages');
        for(let n=0;n<20;n++)t.append();
        return Math.abs(t.anchor.getBoundingClientRect().top-c.getBoundingClientRect().top-t.anchorTop);
    })()`);
    assert.ok(repeatedReadingShift <= 1, `repeated trimming must preserve the same surviving reading row: ${repeatedReadingShift}`);
    const hiddenReading = await run(`(()=>{
        const t=window.__retention,c=document.querySelector('#chatMessages');
        t.hiddenAnchorText=t.anchor.querySelector('.chat-message-content').textContent;
        t.hiddenAnchorTop=t.anchor.getBoundingClientRect().top-c.getBoundingClientRect().top;
        document.querySelector('#stageChatToggle').click();
        for(let n=0;n<20;n++)t.append();
        const hidden=document.querySelector('#chat-panel').inert;
        document.querySelector('#stageChatToggle').click();
        return {hidden,survived:t.anchor.isConnected,rows:c.querySelectorAll('.chat-message').length,
            shift:Math.abs(t.anchor.getBoundingClientRect().top-c.getBoundingClientRect().top-t.hiddenAnchorTop),
            distance:c.scrollHeight-c.scrollTop-c.clientHeight};
    })()`);
    assert.equal(hiddenReading.hidden, true); assert.equal(hiddenReading.survived, true);
    assert.equal(hiddenReading.rows, 500); assert.ok(hiddenReading.distance > 48);
    assert.ok(hiddenReading.shift <= 1, 'reopening after hidden trimming keeps the reading message: '+JSON.stringify(hiddenReading));
    const hiddenHistoryRefresh = await run(`(()=>{
        const t=window.__retention,c=document.querySelector('#chatMessages');
        const messages=Array.from(c.querySelectorAll('.chat-message'),(row,index)=>({
            id:'synthetic-'+(t.next-500+index),roomId:'lobby',senderName:'合成消息',createdAt:new Date().toISOString(),
            content:row.querySelector('.chat-message-content').textContent,
        }));
        document.querySelector('#stageChatToggle').click();
        t.socket.emitEvent(['chat:history',messages,{roomId:'lobby'}]);
        document.querySelector('#stageChatToggle').click();
        const anchor=Array.from(c.querySelectorAll('.chat-message')).find(row=>row.querySelector('.chat-message-content').textContent===t.hiddenAnchorText);
        return {oldNodeRemoved:!t.anchor.isConnected,anchorSurvived:!!anchor,rows:c.querySelectorAll('.chat-message').length,
            shift:anchor?Math.abs(anchor.getBoundingClientRect().top-c.getBoundingClientRect().top-t.hiddenAnchorTop):null,
            distance:c.scrollHeight-c.scrollTop-c.clientHeight};
    })()`);
    assert.equal(hiddenHistoryRefresh.oldNodeRemoved, true); assert.equal(hiddenHistoryRefresh.anchorSurvived, true);
    assert.equal(hiddenHistoryRefresh.rows, 500); assert.ok(hiddenHistoryRefresh.distance > 48);
    assert.ok(hiddenHistoryRefresh.shift <= 1, 'hidden history refresh restores the replacement message: '+JSON.stringify(hiddenHistoryRefresh));
    const bottom = await run(`(()=>{
        const c=document.querySelector('#chatMessages');c.scrollTop=c.scrollHeight;
        for(let n=0;n<1500;n++)window.__retention.append();
        return {rows:c.querySelectorAll('.chat-message').length,notes:c.querySelectorAll('.chat-retention-note').length,distance:c.scrollHeight-c.scrollTop-c.clientHeight};
    })()`);
    assert.equal(bottom.rows, 500); assert.equal(bottom.notes, 1); assert.ok(bottom.distance <= 2);
    const syntheticMessages = await run('window.__retention.next');
    await run(`document.querySelector('#chatMessages').scrollTop=0`);
    await delay(80);
    writeFileSync(join(artifacts, 'retention.png'), (await win.webContents.capturePage()).toPNG());
    const bounded = await run(`(()=>{
        const t=window.__retention;
        t.socket.emitEvent(['chat:message',{id:'synthetic-2000',roomId:'lobby',content:'recent duplicate'}]);
        const recentIgnored=!document.querySelector('#chatMessages').textContent.includes('recent duplicate');
        t.socket.emitEvent(['chat:message',{id:'synthetic-0',roomId:'lobby',content:'expired duplicate'}]);
        return {recentDuplicateIgnored:recentIgnored,expiredIdReleased:document.querySelector('#chatMessages').textContent.includes('expired duplicate'),rows:document.querySelectorAll('#chatMessages .chat-message').length};
    })()`);
    assert.equal(bounded.recentDuplicateIgnored, true); assert.equal(bounded.expiredIdReleased, true); assert.equal(bounded.rows, 500);
    await win.setContentSize(390, 844);
    await run(`document.querySelector('#stageChatToggle').click()`);
    await delay(100);
    const mobile = await run(`(()=>{const c=document.querySelector('#chatMessages');c.scrollTop=0;return {visible:c.getBoundingClientRect().height>0,rows:c.querySelectorAll('.chat-message').length,notes:c.querySelectorAll('.chat-retention-note').length,overflow:document.documentElement.scrollWidth>innerWidth};})()`);
    assert.equal(mobile.visible, true); assert.equal(mobile.rows, 500); assert.equal(mobile.notes, 1); assert.equal(mobile.overflow, false);
    writeFileSync(join(artifacts, 'mobile.png'), (await win.webContents.capturePage()).toPNG());
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify({
        passed: true, hidden: true, muted: win.webContents.isAudioMuted(), historyRefresh, missingHistoryAnchor, reading, hiddenReading, hiddenHistoryRefresh, bottom, bounded, mobile,
        syntheticMessages, repeatedReadingShift, realMediaCapture: false, physicalMobileVerified: false, work,
    }, null, 2));
    await cleanup();
    process.stdout.write('PASS hidden chat retention: real reconnect keeps reading position, missing history anchor returns to top; 500 bounded rows, stable trimming, bottom following and narrow viewport. No media capture.\n');
    app.quit();
}).catch(fail);
