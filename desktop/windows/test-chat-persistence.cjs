/* eslint-disable no-await-in-loop -- Bounded polling of one isolated browser and server. */
// Full page, hidden and muted. This test never joins voice or captures media.
const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createServer } = require('node:net');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');
const work=mkdtempSync(join(tmpdir(),'voice-chat-browser-'));
const artifacts=resolve(__dirname,'../../integrations/piik/artifacts/chat-persistence');
mkdirSync(artifacts,{recursive:true});
app.setPath('userData',join(work,'profile'));
app.commandLine.appendSwitch('mute-audio');app.disableHardwareAcceleration();
app.on('window-all-closed',()=>{});
let win, server, output='', failed=false;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const cleanup=async()=>{
    win?.destroy();
    if(server && server.exitCode===null){const exited=once(server,'exit');server.kill();await exited;}
};
const fail=async error=>{
    if(failed)return;failed=true;
    writeFileSync(join(artifacts,'result.json'),JSON.stringify({passed:false,error:error.stack,output,work}));
    await cleanup();app.exit(1);
};
process.on('uncaughtException',fail);process.on('unhandledRejection',fail);
app.whenReady().then(async()=>{
    const blocker=join(work,'storage'),filePath=join(blocker,'history.json');
    writeFileSync(blocker,'simulate unavailable disk path');
    const reservation=createServer().listen(0,'127.0.0.1');await once(reservation,'listening');
    const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
    const origin=`http://127.0.0.1:${port}`;
    server=spawn(process.execPath,[resolve(__dirname,'../../src/server.js')],{
        cwd:work,windowsHide:true,stdio:'pipe',
        env:{...process.env,ELECTRON_RUN_AS_NODE:'1',HOST:'127.0.0.1',PORT:String(port),USE_HTTPS:'false',ENV:'production',
            SFU_ENABLED:'false',PIIK_ENABLED:'false',CHAT_HISTORY_FILE:filePath},
    });
    server.stdout.on('data',value=>{output+=value;});server.stderr.on('data',value=>{output+=value;});
    let ready=false;
    for(let n=0;n<100;n++){
        if(server.exitCode!==null)throw Error(output);
        try{ready=(await fetch(origin+'/room/lobby')).ok;}catch{ /* Startup is still binding. */ }
        if(ready)break;await delay(40);
    }
    assert.ok(ready,output);
    win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
    win.webContents.setAudioMuted(true);
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    const wait=condition=>win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const until=Date.now()+10000;const poll=()=>{if(${condition})resolve();else if(Date.now()>until)reject(Error('chat browser condition timeout'));else setTimeout(poll,30)};poll()})`);
    await win.loadURL(origin+'/room/lobby');
    await wait(`document.documentElement.dataset.roomBoot==='ready' && document.querySelector('#chat-panel').dataset.chatConnectionState==='connected'`);
    await win.webContents.executeJavaScript(`(()=>{window.__chatStoreMarker='same-room';const input=document.querySelector('#chatInput');input.value='保存失败测试消息';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#chatForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));})()`);
    await wait(`document.querySelector('.chat-panel-status')?.dataset.statusKind==='warning' && document.querySelectorAll('#chatMessages .chat-message').length===1`);
    const failure=await win.webContents.executeJavaScript(`({draft:document.querySelector('#chatInput').value,status:document.querySelector('.chat-panel-status').textContent,voice:document.querySelector('#main').dataset.voiceState})`);
    assert.equal(failure.draft,'');assert.match(failure.status,/无需重发/);assert.equal(failure.voice,'not-joined');
    await delay(100);writeFileSync(join(artifacts,'failure.png'),(await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript(`document.querySelector('#chatInput').value='未发送草稿'`);
    unlinkSync(blocker);mkdirSync(blocker);
    await wait(`document.querySelector('.chat-panel-status').hidden===true`);
    const recovered=await win.webContents.executeJavaScript(`({marker:window.__chatStoreMarker,draft:document.querySelector('#chatInput').value,count:document.querySelectorAll('#chatMessages .chat-message').length})`);
    assert.equal(recovered.marker,'same-room');assert.equal(recovered.draft,'未发送草稿');assert.equal(recovered.count,1);
    assert.equal(JSON.parse(readFileSync(filePath)).lobby.length,1);
    await win.loadURL(origin+'/room/lobby');
    await wait(`document.querySelectorAll('#chatMessages .chat-message').length===1 && document.querySelector('.chat-panel-status').hidden===true`);
    await delay(100);writeFileSync(join(artifacts,'recovered.png'),(await win.webContents.capturePage()).toPNG());
    writeFileSync(join(artifacts,'result.json'),JSON.stringify({passed:true,failure,recovered,historyReload:true,hidden:true,muted:win.webContents.isAudioMuted(),work},null,2));
    await cleanup();
    process.stdout.write('PASS hidden chat browser: real failed-save warning, accepted draft cleared once, automatic recovery preserves new draft, history reload has one message. '+artifacts+'\n');
    app.quit();
}).catch(fail);
