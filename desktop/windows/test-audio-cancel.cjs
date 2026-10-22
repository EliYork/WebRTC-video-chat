const { app, BrowserWindow } = require('electron');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');

const work = mkdtempSync(join(tmpdir(), 'voice-audio-cancel-'));
const artifacts = resolve(__dirname, '../../integrations/piik/artifacts/audio-cancel');
mkdirSync(artifacts, { recursive: true });
app.setPath('userData', join(work, 'profile'));
app.commandLine.appendSwitch('mute-audio');
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
let server, win, deadline, failed = false;
const cleanup = async () => {
    clearTimeout(deadline);
    win?.destroy();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
};
const fail = async error => {
    if (failed) return;
    failed = true;
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify({ passed: false, error: error.stack, work }, null, 2));
    await cleanup();
    app.exit(1);
};
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);

/* eslint-disable no-await-in-loop -- Sequential isolated processing branches and native browser recovery deadlines. */
async function verifyProcessingRecovery() {
    const sourceContext = new AudioContext({ sampleRate: 48000 });
    const source = sourceContext.createMediaStreamDestination();
    const results = [];
    try {
        for (const completion of ['rejection', 'timeout', 'dispose']) {
            const contexts = [], captures = [], timers = new Map();
            let failures = 0, recovery, active;
            const processing = window.VoiceAudioProcessing.createRuntime({
                mediaDevices: { getSupportedConstraints: () => ({ echoCancellation: false }), getUserMedia: async () => {
                    const stream = source.stream.clone();
                    stream.getAudioTracks()[0].getSettings = () => ({ echoCancellation: 'all', noiseSuppression: false });
                    captures.push(stream); return stream;
                } },
                createContext: () => { const context = new AudioContext({ sampleRate: 48000 }); contexts.push(context); return context; },
            });
            try {
                active = processing.adopt(await processing.stage({ mode: 'browser' }));
                const pipeline = processing.pipelines.get(active), context = pipeline.context;
                const nativeResume = context.resume.bind(context);
                active.getAudioTracks()[0].enabled = false;
                await context.suspend();
                let reject;
                context.resume = () => new Promise((_, fail) => { reject = fail; });
                recovery = window.VoiceAudioRecovery.createRuntime({
                    getProcessingState: () => processing.pipelines.get(active),
                    onProcessingFailure: () => { failures++; processing.dispose(active, { preserveRaw: true }); },
                    setTimer: (callback, delay) => {
                        const id = setTimeout(() => { timers.delete(id); callback(); }, delay);
                        timers.set(id, delay); return id;
                    },
                    clearTimer: id => { clearTimeout(id); timers.delete(id); },
                });
                recovery.recover();
                const initialDeadline = [...timers.values()][0];
                if (completion === 'dispose') recovery.dispose();
                else await nativeResume(); // Independently recover the actual processing context.
                if (completion !== 'timeout') reject(new Error('controlled obsolete processing resume rejection'));
                else await new Promise(resolve => setTimeout(resolve, 1650));
                await new Promise(resolve => setTimeout(resolve, 0));
                context.resume = nativeResume;
                results.push({ completion, initialDeadline, failures, pendingTimers: timers.size,
                    contextState: context.state, branchPreserved: processing.pipelines.get(active) === pipeline,
                    outputState: active.getAudioTracks()[0].readyState, outputEnabled: active.getAudioTracks()[0].enabled,
                    rawState: captures[0].getAudioTracks()[0].readyState });
            } finally {
                recovery?.dispose();
                if (active) processing.dispose(active);
                captures.forEach(stream => stream.getTracks().forEach(track => track.stop()));
                await Promise.all(contexts.map(context => context.state === 'closed' ? undefined : context.close()));
            }
        }
        return results;
    } finally { source.stream.getTracks().forEach(track => track.stop()); await sourceContext.close(); }
}
/* eslint-enable no-await-in-loop */

app.whenReady().then(async () => {
    const source = readFileSync(resolve(__dirname, '../../src/views/js/voice/voice-audio-processing.js'));
    const recoverySource = readFileSync(resolve(__dirname, '../../src/views/js/voice/voice-audio-recovery.js'));
    server = createServer((request, response) => {
        response.setHeader('Cache-Control', 'no-store');
        if (request.url === '/runtime.js') {
            response.setHeader('Content-Type', 'application/javascript');
            response.end(source);
        } else if (request.url === '/recovery.js') {
            response.setHeader('Content-Type', 'application/javascript');
            response.end(recoverySource);
        } else {
            response.setHeader('Content-Type', 'text/html');
            response.end('<!doctype html><title>Isolated synthetic audio cancellation</title><script src="/runtime.js"></script><script src="/recovery.js"></script>');
        }
    }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = server.address().port;
    win = new BrowserWindow({ show: false, webPreferences: {
        sandbox: true, contextIsolation: true, nodeIntegration: false,
        backgroundThrottling: false, offscreen: true, autoplayPolicy: 'no-user-gesture-required',
    } });
    win.webContents.setAudioMuted(true);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.session.setPermissionCheckHandler(() => false);
    win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
        const url = new URL(details.url);
        callback({ cancel: /^(https?|wss?):$/.test(url.protocol) && (url.hostname !== '127.0.0.1' || url.port !== String(port)) });
    });
    await win.loadURL(`http://127.0.0.1:${port}/`);
    deadline = setTimeout(() => { void fail(new Error('Hidden synthetic audio test exceeded 30 seconds')); }, 30000);
    const results = await win.webContents.executeJavaScript(`(async()=>{
        const sourceContext=new AudioContext({sampleRate:48000});
        const source=sourceContext.createMediaStreamDestination();
        const results=[];
        try {
            for(const reuseActive of [false,true]) {
                const captures=[],outputs=[],contexts=[];
                let releaseLibrary,libraryStarted,worklets=0,libraryReleased=false;
                const loaded=new Promise(resolve=>{libraryStarted=resolve;});
                const gate=new Promise(resolve=>{releaseLibrary=()=>{libraryReleased=true;resolve();};});
                const withinDeadline=async promise=>{
                    let timer;
                    try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Cancellation waited for obsolete initialization')),1000);})]);}
                    finally{clearTimeout(timer);}
                };
                const runtime=VoiceAudioProcessing.createRuntime({
                    mediaDevices:{getSupportedConstraints:()=>({echoCancellation:false}),getUserMedia:async()=>{
                        const stream=source.stream.clone();
                        // Destination tracks carry synthetic samples and cannot
                        // satisfy physical microphone APM constraints. Only the
                        // settings report is stubbed; track lifetime is native.
                        stream.getAudioTracks()[0].getSettings=()=>({echoCancellation:'all',noiseSuppression:false});
                        captures.push(stream);return stream;
                    }},
                    createContext:()=>{
                        const context=new AudioContext({sampleRate:48000});contexts.push(context);
                        const make=context.createMediaStreamDestination.bind(context);
                        context.createMediaStreamDestination=()=>{const destination=make();outputs.push(destination.stream);return destination;};
                        return context;
                    },
                    supportsRnnoise:()=>true,
                    loadLibrary:async()=>{
                        libraryStarted();await gate;
                        return {loadRnnoise:async()=>new ArrayBuffer(8),RnnoiseWorkletNode:class{constructor(){worklets++;throw Error('Cancelled initialization constructed a worklet');}}};
                    },
                });
                let active;
                try {
                    if(reuseActive){active=runtime.adopt(await runtime.stage({mode:'browser'}));active.getAudioTracks()[0].enabled=false;}
                    const candidate=runtime.stage({mode:'rnnoise'});
                    const settled=candidate.then(()=>({status:'fulfilled'}),error=>({status:'rejected',name:error.name}));
                    await Promise.race([loaded,settled.then(result=>{throw Error('Candidate completed before model load: '+JSON.stringify(result));})]);
                    const replacement=reuseActive?runtime.stage({mode:'off'}):undefined;
                    if(!reuseActive)runtime.cancelPending();
                    const immediate={raw:captures.at(-1).getAudioTracks()[0].readyState,output:outputs.at(-1).getAudioTracks()[0].readyState,context:contexts[0].state,
                        active:active?.getAudioTracks()[0].readyState??null,activeEnabled:active?.getAudioTracks()[0].enabled??null,
                        activeRaw:reuseActive?captures[0].getAudioTracks()[0].readyState:null};
                    const completion=await withinDeadline(settled);
                    const replacementPreservedOutput=replacement?runtime.adopt(await withinDeadline(replacement))===active:null;
                    const completedBeforeModelRelease=!libraryReleased;
                    releaseLibrary();
                    await new Promise(resolve=>setTimeout(resolve,0));
                    results.push({reuseActive,immediate,completion,replacementPreservedOutput,completedBeforeModelRelease,worklets,captures:captures.length});
                } finally {
                    releaseLibrary();runtime.cancelPending();
                    if(active)runtime.dispose(active);
                    captures.forEach(stream=>stream.getTracks().forEach(track=>track.stop()));
                    await Promise.all(contexts.map(context=>context.state==='closed'?undefined:context.close()));
                }
            }
            return results;
        } finally {source.stream.getTracks().forEach(track=>track.stop());await sourceContext.close();}
    })()`);
    assert.equal(results.length, 2);
    for (const result of results) {
        assert.equal(result.immediate.raw, 'ended');
        assert.equal(result.immediate.output, 'ended');
        assert.equal(result.immediate.context, result.reuseActive ? 'running' : 'closed');
        assert.deepEqual(result.completion, { status: 'rejected', name: 'AbortError' });
        assert.equal(result.completedBeforeModelRelease, true);
        assert.equal(result.worklets, 0);
        assert.equal(result.captures, result.reuseActive ? 3 : 1);
        if (result.reuseActive) {
            assert.equal(result.replacementPreservedOutput, true);
            assert.equal(result.immediate.active, 'live');
            assert.equal(result.immediate.activeRaw, 'live');
            assert.equal(result.immediate.activeEnabled, false);
        }
    }
    const recoveryResults = await win.webContents.executeJavaScript(`(${verifyProcessingRecovery.toString()})()`);
    assert.equal(recoveryResults.length, 3);
    for (const result of recoveryResults) {
        assert.equal(result.initialDeadline, 1500);
        assert.equal(result.failures, 0);
        assert.equal(result.pendingTimers, 0);
        assert.equal(result.contextState, result.completion === 'dispose' ? 'suspended' : 'running');
        assert.equal(result.branchPreserved, true);
        assert.equal(result.outputState, 'live'); assert.equal(result.rawState, 'live');
        assert.equal(result.outputEnabled, false);
    }
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify({ passed: true, hidden: !win.isVisible(), muted: win.webContents.isAudioMuted(), results, recoveryResults, processingSettingsStubbed: true, realMediaCapture: false, physicalDeviceVerified: false, work }, null, 2));
    await cleanup();
    process.stdout.write('PASS hidden synthetic Web Audio cancellation and recovery: muted processing survives obsolete failures and real resume timeout; disposal clears deadlines. No real media capture.\n');
    app.quit();
}).catch(fail);
