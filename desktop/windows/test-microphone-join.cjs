/* eslint-disable no-await-in-loop -- Observe one isolated local server and synthetic tracks. */
const {app,BrowserWindow}=require('electron');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {createServer}=require('node:net');
const {mkdtempSync,mkdirSync,writeFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');
const assert=require('node:assert/strict');
const work=mkdtempSync(join(tmpdir(),'voice-microphone-join-'));
const artifacts=resolve(__dirname,'../../integrations/piik/artifacts/microphone-join');mkdirSync(artifacts,{recursive:true});
app.setPath('userData',join(work,'profile'));app.disableHardwareAcceleration();
app.commandLine.appendSwitch('mute-audio');app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
app.on('window-all-closed',()=>{});
let win,server,deadline,output='',failed=false,permissionRequests=0;
const cleanup=async()=>{clearTimeout(deadline);win?.destroy();if(server&&server.exitCode===null){const exited=once(server,'exit');server.kill();await exited;}};
const fail=async error=>{if(failed)return;failed=true;process.stderr.write(error.stack+'\n');
    let page;
    try{page=await win?.webContents.executeJavaScript(`({snapshot:window.__micJoin?.snapshot(),errors:window.__micJoin?.errors,tracks:window.__micJoin?.tracks.map(t=>({state:t.readyState,enabled:t.enabled})),micTitle:document.querySelector('#toggleAudio')?.getAttribute('aria-label')})`);}catch{/* Page may already be closed. */}
    process.stderr.write(JSON.stringify(page)+'\n');writeFileSync(join(artifacts,'result.json'),JSON.stringify({passed:false,error:error.stack,page,output,work},null,2));await cleanup();app.exit(1);};
process.on('uncaughtException',fail);process.on('unhandledRejection',fail);
app.whenReady().then(async()=>{
    deadline=setTimeout(()=>{void fail(Error('Microphone join check exceeded 40 seconds'));},40000);
    const reservation=createServer().listen(0,'127.0.0.1');await once(reservation,'listening');
    const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
    const origin=`http://127.0.0.1:${port}`;
    const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^(TURN_|SFU_|PIIK_|TLS_)/.test(key)));
    server=spawn(process.execPath,[resolve(__dirname,'../../src/server.js')],{cwd:work,windowsHide:true,stdio:'pipe',
        env:{...env,ELECTRON_RUN_AS_NODE:'1',HOST:'127.0.0.1',PORT:String(port),USE_HTTPS:'false',ENV:'production',SFU_ENABLED:'false',PIIK_ENABLED:'false',CHAT_HISTORY_FILE:join(work,'history.json')}});
    server.stdout.on('data',v=>{output+=v;});server.stderr.on('data',v=>{output+=v;});
    let ready=false;
    for(let n=0;n<100;n++){
        if(server.exitCode!==null)throw Error(output);
        try{ready=(await fetch(origin+'/readyz')).ok;}catch{/* Listener is binding. */}
        if(ready)break;await new Promise(resolve=>setTimeout(resolve,40));
    }
    assert.ok(ready,output);
    win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
    win.webContents.setAudioMuted(true);win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    win.webContents.on('console-message',event=>{if(event.level>=2)output+='\nBROWSER '+event.message;});
    win.webContents.session.setPermissionCheckHandler(()=>false);
    win.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>{permissionRequests++;callback(false);});
    win.webContents.session.webRequest.onBeforeRequest((details,callback)=>{
        const url=new URL(details.url);callback({cancel:/^(https?|wss?):$/.test(url.protocol)&&(url.hostname!=='127.0.0.1'||url.port!==String(port))});
    });
    const run=code=>win.webContents.executeJavaScript(code);
    const wait=condition=>run(`new Promise((resolve,reject)=>{const end=Date.now()+10000;const poll=()=>{if(${condition})resolve();else if(Date.now()>end)reject(Error('Microphone condition timeout: '+${JSON.stringify(condition)}));else setTimeout(poll,20)};poll()})`);
    await win.loadURL(origin+'/room/lobby');
    await wait(`document.documentElement.dataset.roomBoot==='ready' && document.querySelector('#chat-panel').dataset.chatConnectionState==='connected'`);
    await run(`(()=>{
        const t=window.__micJoin={requests:0,cameraRequests:0,mode:'allow',tracks:[],pending:[],errors:[],contexts:[]};
        addEventListener('error',e=>t.errors.push(e.message));addEventListener('unhandledrejection',e=>t.errors.push(String(e.reason)));
        t.make=()=>{
            const context=new AudioContext();t.contexts.push(context);
            const destination=context.createMediaStreamDestination(),track=destination.stream.getAudioTracks()[0];t.tracks.push(track);
            // A generated Web Audio track has no physical microphone AEC/NS
            // controls. Accept the page's constraints only in this test fixture.
            track.applyConstraints=async()=>{};
            return destination.stream;
        };
        navigator.mediaDevices.getUserMedia=constraints=>{
            if(!constraints.audio){t.cameraRequests++;return Promise.reject(new DOMException('Camera disabled by synthetic check','NotAllowedError'));}
            t.requests++;
            if(t.mode==='deny')return Promise.reject(new DOMException('Synthetic microphone rejection','NotAllowedError'));
            if(t.mode==='hold')return new Promise(resolve=>t.pending.push(()=>resolve(t.make())));
            return Promise.resolve(t.make());
        };
        navigator.mediaDevices.getDisplayMedia=()=>Promise.reject(new DOMException('No capture in this check','NotAllowedError'));
        navigator.mediaDevices.enumerateDevices=async()=>[{deviceId:'default',kind:'audioinput',groupId:'synthetic',label:'Synthetic microphone'}];
        t.snapshot=()=>({requests:t.requests,pressed:document.querySelector('#toggleAudio').getAttribute('aria-pressed'),
            busy:document.querySelector('#toggleAudio').getAttribute('aria-busy'),disabled:document.querySelector('#toggleAudio').disabled,
            state:document.querySelector('#main').dataset.voiceState,live:t.tracks.filter(track=>track.readyState==='live').length});
        t.session=()=>document.querySelector('#destroyPeer').click();t.mic=()=>document.querySelector('#toggleAudio').click();
    })()`);
    const outside=await run('__micJoin.snapshot()');assert.equal(outside.requests,0);assert.equal(outside.pressed,'true');assert.equal(outside.disabled,false);
    await run('__micJoin.session()');
    await wait(`__micJoin.requests===1 && __micJoin.snapshot().state==='joined' && __micJoin.snapshot().pressed==='true'`);
    const defaultJoin=await run('__micJoin.snapshot()');
    await run('__micJoin.session()');await wait(`__micJoin.snapshot().state==='not-joined'`);
    assert.equal((await run('__micJoin.snapshot()')).live,0);
    await run('__micJoin.mic()');await wait(`__micJoin.snapshot().pressed==='false'`);
    assert.equal(await run('__micJoin.requests'),1);
    await run('__micJoin.session()');await wait(`__micJoin.snapshot().state==='joined'`);
    const preMutedJoin=await run('__micJoin.snapshot()');assert.equal(preMutedJoin.requests,1);assert.equal(preMutedJoin.pressed,'false');
    await run('__micJoin.mic()');await wait(`__micJoin.requests===2 && __micJoin.snapshot().pressed==='true'`);
    await run('__micJoin.mic()');await wait(`__micJoin.snapshot().pressed==='false'`);
    await run('__micJoin.session()');await wait(`__micJoin.snapshot().state==='not-joined'`);
    const mutedOutside=await run('__micJoin.snapshot()');assert.equal(mutedOutside.pressed,'false');assert.equal(mutedOutside.live,0);
    await run(`__micJoin.mic();__micJoin.mode='hold';__micJoin.session()`);
    await wait(`__micJoin.requests===3 && __micJoin.pending.length===1 && __micJoin.snapshot().state==='joined'`);
    assert.equal((await run('__micJoin.snapshot()')).disabled,false);
    await run('__micJoin.mic()');await wait(`__micJoin.snapshot().busy==='false'`);
    await run('__micJoin.pending.shift()();');await wait(`__micJoin.tracks.length===3 && __micJoin.tracks.at(-1).readyState==='ended'`);
    const cancelled=await run('__micJoin.snapshot()');assert.equal(cancelled.pressed,'false');assert.equal(cancelled.live,0);
    await run(`__micJoin.mode='allow';__micJoin.mic()`);await wait(`__micJoin.requests===4 && __micJoin.snapshot().pressed==='true'`);
    await run('__micJoin.session()');await wait(`__micJoin.snapshot().state==='not-joined'`);
    assert.equal((await run('__micJoin.snapshot()')).pressed,'true');
    await run(`__micJoin.mode='deny';__micJoin.session()`);await wait(`__micJoin.requests===5 && __micJoin.snapshot().state==='joined' && __micJoin.snapshot().busy==='false'`);
    const denied=await run('__micJoin.snapshot()');assert.equal(denied.pressed,'false');assert.equal(denied.live,0);
    await run(`__micJoin.mode='allow';__micJoin.mic()`);await wait(`__micJoin.requests===6 && __micJoin.snapshot().pressed==='true'`);
    await run('__micJoin.session()');await wait(`__micJoin.snapshot().state==='not-joined' && __micJoin.snapshot().live===0`);
    const final=await run(`({...__micJoin.snapshot(),cameraRequests:__micJoin.cameraRequests,errors:__micJoin.errors})`);
    assert.equal(final.cameraRequests,0);assert.deepEqual(final.errors,[]);assert.equal(permissionRequests,0);
    await run('Promise.all(__micJoin.contexts.map(context=>context.close()))');
    writeFileSync(join(artifacts,'result.json'),JSON.stringify({passed:true,hidden:!win.isVisible(),muted:win.webContents.isAudioMuted(),outside,defaultJoin,preMutedJoin,mutedOutside,cancelled,denied,final,permissionRequests,realMediaCapture:false,work},null,2));
    await cleanup();process.stdout.write('PASS hidden full page: join defaults to microphone, outside/in-channel mute retained, pending capture cancelled, denied join remains connected, synthetic tracks released. No real capture.\n');app.quit();
}).catch(fail);
