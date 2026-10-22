/* eslint-disable no-await-in-loop -- Observe one isolated local server and synthetic tracks. */
const {app,BrowserWindow}=require('electron');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {createServer}=require('node:net');
const {mkdtempSync,mkdirSync,writeFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');
const assert=require('node:assert/strict');
const work=mkdtempSync(join(tmpdir(),'voice-deepfilter-'));
const artifacts=resolve(__dirname,'../../integrations/piik/artifacts/deepfilter');mkdirSync(artifacts,{recursive:true});
app.setPath('userData',join(work,'profile'));app.disableHardwareAcceleration();
app.commandLine.appendSwitch('mute-audio');app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
app.on('window-all-closed',()=>{});
let win,server,deadline,output='',failed=false,permissionRequests=0,blockModel=false;const assetRequests=[];
const cleanup=async()=>{clearTimeout(deadline);win?.destroy();if(server&&server.exitCode===null){const exited=once(server,'exit');server.kill();await exited;}};
const fail=async error=>{if(failed)return;failed=true;process.stderr.write(error.stack+'\n');
    let page;
    try{page=await win?.webContents.executeJavaScript(`({snapshot:window.__dfCheck?.snapshot(),errors:window.__dfCheck?.errors,tracks:window.__dfCheck?.tracks.map(t=>({state:t.readyState,enabled:t.enabled})),micTitle:document.querySelector('#toggleAudio')?.getAttribute('aria-label')})`);}catch{/* Page may already be closed. */}
    process.stderr.write(JSON.stringify(page)+'\n');writeFileSync(join(artifacts,'result.json'),JSON.stringify({passed:false,error:error.stack,page,output,work},null,2));await cleanup();app.exit(1);};
process.on('uncaughtException',fail);process.on('unhandledRejection',fail);
app.whenReady().then(async()=>{
    deadline=setTimeout(()=>{void fail(Error('DeepFilter check exceeded 90 seconds'));},90000);
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
        const url=new URL(details.url); if (details.url.includes('/deepfilter-0.2.0/')) assetRequests.push({url:url.pathname,blocked:blockModel}); callback({cancel:(blockModel && url.pathname.endsWith('.tar.gz')) || /^(https?|wss?):$/.test(url.protocol)&&(url.hostname!=='127.0.0.1'||url.port!==String(port))});
    });
    const run=code=>win.webContents.executeJavaScript(code);
    const wait=condition=>run(`new Promise((resolve,reject)=>{const end=Date.now()+10000;const poll=()=>{if(${condition})resolve();else if(Date.now()>end)reject(Error('DeepFilter condition timeout: '+${JSON.stringify(condition)}));else setTimeout(poll,20)};poll()})`);
    await win.loadURL(origin+'/room/lobby');
    await wait(`document.documentElement.dataset.roomBoot==='ready' && document.querySelector('#chat-panel').dataset.chatConnectionState==='connected'`);
    await run(`(()=>{
        const t=window.__dfCheck={tracks:[],contexts:[],generators:[],nodes:[],errors:[],messages:[],requests:0};
        addEventListener('error',e=>t.errors.push(e.message));addEventListener('unhandledrejection',e=>t.errors.push(String(e.reason)));
        const NativeContext=AudioContext,NativeNode=AudioWorkletNode;
        window.AudioContext=class extends NativeContext {
            constructor(options){super(options);this.destinations=[];t.contexts.push(this);}
            createMediaStreamDestination(){const dest=super.createMediaStreamDestination();this.destinations.push(dest);t.outputContext ||= this;return dest;}
        };
        window.AudioWorkletNode=class extends NativeNode {
            constructor(...args){super(...args);this.engineName=args[1];t.nodes.push(this);this.port.addEventListener('message',e=>t.messages.push({name:args[1],data:e.data}));this.port.start();}
        };
        navigator.mediaDevices.getUserMedia=async ({audio})=>{
            if(!audio)throw Error('No camera capture allowed');t.requests++;
            const context=new NativeContext({sampleRate:48000});t.generators.push(context);await context.resume();
            const source=context.createBufferSource(),buffer=context.createBuffer(1,96000,48000),data=buffer.getChannelData(0);
            for(let i=0;i<data.length;i++){const s=i/48000;data[i]=0.15*Math.sin(2*Math.PI*(180*s+60*s*s))+0.04*Math.sin(2*Math.PI*613*s);}
            source.buffer=buffer;source.loop=true;const destination=context.createMediaStreamDestination();source.connect(destination);source.start();
            const track=destination.stream.getAudioTracks()[0];t.tracks.push(track);
            const settings=Object.fromEntries(Object.entries(audio).map(([k,v])=>[k,v?.exact??v]));settings.sampleRate=48000;
            track.getSettings=()=>({...settings});track.getCapabilities=()=>({echoCancellation:[true,false,'all']});
            track.applyConstraints=async constraints=>{for(const[k,v]of Object.entries(constraints))settings[k]=v?.exact??v;};
            if(t.holdCapture)await new Promise(resolve=>{t.releaseCapture=()=>{t.holdCapture=false;t.releaseCapture=null;resolve();};});
            return destination.stream;
        };
        navigator.mediaDevices.getDisplayMedia=()=>Promise.reject(Error('No display capture allowed'));
        navigator.mediaDevices.enumerateDevices=async()=>[{deviceId:'default',kind:'audioinput',groupId:'synthetic',label:'Synthetic microphone'}];
        t.choose=mode=>{const select=document.querySelector('[data-audio-noise-mode]');select.value=mode;select.dispatchEvent(new Event('change',{bubbles:true}));};
        t.snapshot=()=>({mode:document.querySelector('[data-audio-noise-mode]').value,
            status:document.querySelector('[data-audio-processing-status]').textContent,
            mic:document.querySelector('#toggleAudio').getAttribute('aria-pressed'),
            voice:document.querySelector('#main').dataset.voiceState,
            contexts:t.contexts.map(context=>context.state),requests:t.requests,
            modelContexts:t.nodes.filter(node=>node.engineName==='workadventure-deepfilternet').map(node=>node.context.state),
            gateDisabled:document.querySelector('[data-rnnoise-speech-gate]').disabled,
            outputTrackId:t.outputContext?.destinations[0]?.stream.getAudioTracks()[0]?.id,
            outputEnabled:t.outputContext?.destinations[0]?.stream.getAudioTracks()[0]?.enabled});
    })()`);
    await run(`__dfCheck.choose('rnnoise')`);
    assert.equal(assetRequests.length,0);
    assert.equal(await run('__dfCheck.requests'),0);
    await run(`document.querySelector('#destroyPeer').click()`);
    await wait(`__dfCheck.snapshot().voice==='joined' && __dfCheck.snapshot().status.includes('实际：RNNoise')`);
    await run(`document.querySelector('#toggleAudio').click()`);await wait(`__dfCheck.snapshot().mic==='false'`);
    const baseline=await run('__dfCheck.snapshot()');
    blockModel=true;
    await run(`__dfCheck.choose('deepfilter')`);
    await wait(`__dfCheck.snapshot().status.includes('已保留原音频') && __dfCheck.snapshot().mode==='rnnoise'`);
    const failedLoad=await run('__dfCheck.snapshot()');
    assert.equal(failedLoad.outputTrackId,baseline.outputTrackId);assert.equal(failedLoad.outputEnabled,false);
    assert.equal(failedLoad.contexts.at(-1),'closed');
    blockModel=false;
    await run(`__dfCheck.choose('deepfilter')`);
    await wait(`__dfCheck.snapshot().status.includes('实际：增强降噪') && !__dfCheck.snapshot().status.includes('切换中')`);
    const enhanced=await run('__dfCheck.snapshot()');
    assert.equal(enhanced.gateDisabled,true);assert.equal(enhanced.outputTrackId,baseline.outputTrackId);assert.equal(enhanced.outputEnabled,false);
    await run(`document.querySelector('[data-control-menu="mic"]').click()`);
    await wait(`document.querySelector('[data-control-panel="mic"]').classList.contains('is-open')`);
    const layout=await run(`(()=>{const panel=document.querySelector('[data-control-panel="mic"]'),select=panel.querySelector('select'),rect=panel.getBoundingClientRect();return {width:panel.clientWidth,scrollWidth:panel.scrollWidth,selectWidth:select.getBoundingClientRect().width,rect:{x:Math.floor(rect.x),y:Math.floor(rect.y),width:Math.ceil(rect.width),height:Math.ceil(rect.height)}}})()`);
    assert.ok(layout.scrollWidth<=layout.width+1,'noise options must fit the settings panel');
    await run(`document.querySelector('[data-control-panel="mic"] [data-control-close]').click()`);
    for(let i=0;i<2;i++){
        await run(`__dfCheck.choose('rnnoise')`);
        await wait(`__dfCheck.snapshot().status.includes('实际：RNNoise') && !__dfCheck.snapshot().status.includes('切换中')`);
        await run(`__dfCheck.choose('deepfilter')`);
        await wait(`__dfCheck.snapshot().status.includes('实际：增强降噪') && !__dfCheck.snapshot().status.includes('切换中')`);
    }
    await wait(`__dfCheck.messages.some(e=>e.data.type==='load-report')`);
    const repeated=await run('__dfCheck.snapshot()');
    assert.equal(repeated.outputTrackId,baseline.outputTrackId);assert.equal(repeated.outputEnabled,false);
    assert.equal(repeated.modelContexts.filter(state=>state==='running').length,1);
    assert.equal(await run('__dfCheck.outputContext.state'),'running');
    const loads=await run(`__dfCheck.messages.filter(e=>e.data.type==='load-report')`);
    // A pending replacement must not leave the old branch broken. Inject only
    // the report event; this verifies recovery, not an actual slow CPU.
    await run(`__dfCheck.holdCapture=true;__dfCheck.choose('rnnoise')`);
    await wait(`typeof __dfCheck.releaseCapture==='function'`);
    await run(`__dfCheck.nodes.at(-1).port.onmessage({data:{type:'overload',load:0.9}})`);
    await wait(`__dfCheck.snapshot().status.includes('耗时过高') && __dfCheck.snapshot().status.includes('实际：关闭')`);
    const fallback=await run('__dfCheck.snapshot()');
    assert.equal(fallback.outputTrackId,baseline.outputTrackId);assert.equal(fallback.outputEnabled,false);
    assert.equal(fallback.modelContexts.filter(state=>state==='running').length,0);
    assert.equal(await run('__dfCheck.outputContext.state'),'running');
    await run(`__dfCheck.releaseCapture()`);
    await wait(`__dfCheck.snapshot().status.includes('实际：RNNoise') && !__dfCheck.snapshot().status.includes('切换中')`);
    await run(`__dfCheck.choose('deepfilter')`);
    await wait(`__dfCheck.snapshot().status.includes('实际：增强降噪') && !__dfCheck.snapshot().status.includes('切换中')`);
    await run(`document.querySelector('#toggleAudio').click()`);await wait(`__dfCheck.snapshot().mic==='true'`);
    const signal=await run(`(async()=>{
        const ctx=__dfCheck.outputContext,stream=ctx.destinations[0].stream;
        const source=ctx.createMediaStreamSource(stream),analyser=ctx.createAnalyser();source.connect(analyser);
        const samples=new Float32Array(analyser.fftSize);let energy=0;
        for(let i=0;i<20;i++){await new Promise(resolve=>setTimeout(resolve,25));analyser.getFloatTimeDomainData(samples);for(const v of samples){if(!Number.isFinite(v))throw Error('nonfinite signal');energy+=v*v;}}
        source.disconnect();return {energy,trackId:stream.getAudioTracks()[0].id};
    })()`);
    assert.ok(signal.energy>0,'enhanced output must not stay silent');
    assert.equal(signal.trackId,baseline.outputTrackId);
    await run(`document.querySelector('#destroyPeer').click()`);
    await wait(`__dfCheck.snapshot().voice==='not-joined' && __dfCheck.outputContext.state==='closed' && __dfCheck.snapshot().modelContexts.every(state=>state==='closed')`);
    const final=await run(`({...__dfCheck.snapshot(),errors:__dfCheck.errors,rawTracks:__dfCheck.tracks.map(track=>track.readyState)})`);
    assert.ok(final.rawTracks.every(state=>state==='ended'));assert.deepEqual(final.errors,[]);assert.equal(permissionRequests,0);
    const latency=await run(`(async()=>{
        const result=[];
        for(const kind of ['rnnoise','deepfilter']){
            const ctx=new OfflineAudioContext(1,96000,48000);
            let node,engine;
            if(kind==='rnnoise'){
                const api=await import('/js/voice/rnnoise-engine.js');
                const wasmBinary=await api.loadRnnoise({url:'/wasm/rnnoise.wasm',simdUrl:'/wasm/rnnoise_simd.wasm'});engine=wasmBinary.engine;
                await ctx.audioWorklet.addModule('/audio-worklet/rnnoise-processor.js');
                node=new api.RnnoiseWorkletNode(ctx,{wasmBinary,maxChannels:1});
            }else{
                const api=await import('/js/voice/deepfilter-engine.js');engine='deepfilternet3-0.2.0';
                const assets=await api.loadDeepfilter();await ctx.audioWorklet.addModule(api.DEEPFILTER_ASSETS.worklet);
                node=new api.DeepfilterWorkletNode(ctx,assets);
            }
            await new Promise((resolve,reject)=>{
                const timer=setTimeout(()=>reject(Error('offline init timeout')),10000);
                node.port.onmessage=({data})=>{if(data.type==='ready'){clearTimeout(timer);resolve();}if(data.type==='error'){clearTimeout(timer);reject(Error(data.message||data.detail));}};
            });
            if(kind==='rnnoise')node.port.postMessage({type:'speech-gate',enabled:false,revision:1});
            const buffer=ctx.createBuffer(1,96000,48000),input=buffer.getChannelData(0);
            for(let i=0;i<input.length;i++){const t=i/48000;input[i]=0.15*Math.sin(2*Math.PI*(180*t+60*t*t))+0.04*Math.sin(2*Math.PI*613*t);}
            const src=ctx.createBufferSource();src.buffer=buffer;src.connect(node);node.connect(ctx.destination);src.start();
            const start=performance.now(),rendered=await ctx.startRendering(),renderMs=performance.now()-start,output=rendered.getChannelData(0);node.destroy();
            let best={lag:0,correlation:-1};
            for(let lag=0;lag<4800;lag+=4){
                let xy=0,xx=0,yy=0;
                for(let i=12000;i<70000;i+=16){const x=input[i],y=output[i+lag];xy+=x*y;xx+=x*x;yy+=y*y;}
                const correlation=xy/Math.sqrt(xx*yy||1);if(correlation>best.correlation)best={lag,correlation};
            }
            result.push({kind,engine,renderMs,estimatedSignalLagMs:best.lag/48,correlation:best.correlation});
        }
        return {scope:'Offline synthetic chirp correlation; excludes cross-context bridge, capture, network and output-device latency. No speech quality measurement.',engines:result};
    })()`);
    assert.ok(latency.engines.every(engine=>Number.isFinite(engine.estimatedSignalLagMs)&&engine.correlation>0.1));
    await run(`Promise.all(__dfCheck.generators.map(context=>context.close()))`);
    await run(`Promise.all(__dfCheck.contexts.filter(context=>context.state!=='closed').map(context=>context.close()))`);
    writeFileSync(join(artifacts,'result.json'),JSON.stringify({passed:true,hidden:!win.isVisible(),muted:win.webContents.isAudioMuted(),realMediaCapture:false,
        overloadEventInjected:true,baseline,failedLoad,enhanced,layout,repeated,fallback,signal,loads,latency,final,permissionRequests,assetRequests,work},null,2));
    await cleanup();process.stdout.write('PASS hidden full page: real DeepFilterNet3 WASM, lazy loading, failed load rollback, muted stable track, repeated context release, synthetic overload fallback, audible synthetic output. No real capture.\n');app.quit();
}).catch(fail);
