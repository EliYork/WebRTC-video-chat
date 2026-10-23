/* eslint-disable no-await-in-loop -- Ordered ownership and cancellation scenarios. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { nativeAudioSelection, parseAudioTarget, encoderSummary, nativeFailureText } from '../integrations/piik/share-audio.ts';

const client = {health:{nativeMedia:{video:true, independentAudio:true, processAudio:true, processAudioExclusion:true, systemAudio:true}}};
test('independent audio modes keep picture A separate from process B and disable native microphone mixing', () => {
    const source = {kind:'display',sourceId:'screen-A'};
    const app = nativeAudioSelection({nativeAudioMode:'application',nativeAudioTargetKey:'234:123456'},client,source);
    assert.deepEqual(app,{audioMode:'application',audioTarget:{pid:234,creationTime:'123456'},audio:true,microphoneMixing:false});
    assert.equal(nativeAudioSelection({nativeAudioMode:'none'},client,source).audio,false);
    assert.equal(nativeAudioSelection({nativeAudioMode:'system'},client,{kind:'window'}).audioMode,'system');
});
test('invalid identities and old clients cannot silently select system audio', () => {
    for (const key of ['', '234:0', '0:123', '234:123x','4294967296:1','1:18446744073709551616']) assert.equal(parseAudioTarget(key),null);
    assert.throws(()=>nativeAudioSelection({nativeAudioMode:'application',nativeAudioTargetKey:'4:0'},client,{}),/有效/);
    const old = {health:{nativeMedia:{processAudio:true,systemAudio:true}}};
    assert.throws(()=>nativeAudioSelection({nativeAudioMode:'application',nativeAudioTargetKey:'4:10'},old,{}),/新版/);
    assert.equal(nativeAudioSelection({nativeAudioMode:'none'},old,{}).audio,false);
    assert.equal(nativeAudioSelection({nativeAudioMode:'source',shareAudio:true},old,{kind:'window'}).audio,true);
});
test('hardware UI requires active H264 evidence and keeps unknown and failures explicit', () => {
    for (const value of [null,{}, {state:'starting',codec:'h264',hardware:true,encoder:'GPU'}, {state:'active',codec:'vp8',hardware:true}]) assert.equal(encoderSummary(value).method,'未确认');
    const active=encoderSummary({state:'active',codec:'h264',hardware:true,encoder:'Actual MFT',adapter:'Actual GPU'});
    assert.equal(active.encoder,'Actual MFT'); assert.equal(active.adapter,'Actual GPU'); assert.equal(active.method,'GPU 硬件编码');
    for (const reason of ['hardware-unavailable','encoder-failed','media-capture-failed','audio-target-invalid','audio-capture-failed','system-exclusion-unavailable','capture-unconfirmed']) assert.notEqual(nativeFailureText({cause:{reason}}),'原生共享失败，原因未确认');
});

const bundle = await build({entryPoints:['integrations/piik/native.ts'],bundle:true,write:false,format:'iife',globalName:'Capture',platform:'browser',tsconfigRaw:{},plugins:[{
    name:'controlled-native',setup(builder) {
        builder.onResolve({filter:/\.deps\/upstream/},args=>({path:args.path,namespace:'mock'}));
        builder.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`
            export const NativeClient = globalThis.FakeClient;
            export const discoverNativeConnect = async()=>null;
            export const NativeMediaBridge = globalThis.FakeBridge;
            export const defaultNativeCapturePath = ()=>({adapterIndex:0,encoderIndex:0});
            export const nativeCaptureTargetKey = source=>source.sourceId;
        `}));
    }
}]});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture() {
    const clients=[], bridges=[], timers=new Map(), failures=[];
    const delay={};
    class FakeClient {
        health=client.health; inputs=[]; closed=0; stopped=0; sourceCalls=0;
        static async connect() {const result=new FakeClient();clients.push(result); if(delay.connect) await delay.connect; return result;}
        async captureOptions(){const pending=delay.options;delay.options=null;if(pending)await pending;return [];}
        async sources(){this.sourceCalls++;const pending=delay.sources;delay.sources=null;if(pending)await pending;return [{kind:'display',sourceId:'A',title:'A'}];}
        onClose(fn){this.onclose=fn;return ()=>{this.onclose=null;};}
        onEvent(fn){this.onevent=fn;return ()=>{this.onevent=null;};}
        async startShare(input){this.inputs.push(input); if(delay.start) await delay.start; if(delay.fail) throw {cause:{reason:'audio-target-invalid'}}; return {codec:'h264',audio:input.audio};}
        async shareStatus(){return {state:'active',codec:'h264',hardware:true,encoder:'Fixture MFT',adapter:'Fixture GPU',audio:delay.audioFailed?'failed':'active'};}
        async stopShare(){this.stopped++;}
        close(){this.closed++;}
        async updateShare(){}
    }
    class FakeBridge {
        disposed=0;
        constructor(){bridges.push(this);}
        async start(){if(delay.bridge) await delay.bridge; return {fixture:true};}
        dispose(){this.disposed++;}
    }
    const document={querySelector:()=>null,addEventListener(){}};
    const context=vm.createContext({FakeClient,FakeBridge,document,AbortController,crypto,Event,
        setTimeout:fn=>{const id=Symbol();timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)});
    vm.runInContext(bundle.outputFiles[0].text,context);
    let authorize=async()=>{};
    const capture=context.Capture.createNativeCapture(()=>authorize(),message=>failures.push(message));
    const options={resolutionPreset:'1080p',frameRate:60,nativeSourceKey:'A',nativeAudioMode:'application',nativeAudioTargetKey:'234:123456',shareAudio:true};
    return {capture,options,clients,bridges,delay,timers,failures,setAuthorize:fn=>{authorize=fn;}};
}
test('stop, restart, channel departure and disconnection retire exactly one native owner', async () => {
    const f=fixture();
    for (const ending of ['stop','restart','channel','disconnect']) {
        await f.capture.capture(f.options,new AbortController().signal); await flush();
        const owner=f.clients.at(-1);
        assert.equal(owner.inputs.length,1); assert.equal(owner.inputs[0].source.sourceId,'A');assert.equal(owner.inputs[0].audioTarget.pid,234);
        if(ending==='disconnect') owner.onclose(); else f.capture.stop();
        await flush(); assert.equal(owner.closed,1);assert.equal(owner.stopped,1);assert.equal(f.bridges.at(-1).disposed,1);assert.equal(f.timers.size,0);
    }
});
test('silence stays active, failed application capture stops with a visible reason and no fallback', async () => {
    const f=fixture(); await f.capture.capture(f.options,new AbortController().signal);await flush();
    assert.equal(f.capture.isActive(),true); // No level/no-packet timeout is used.
    f.delay.audioFailed=true;const run=[...f.timers.values()][0];f.timers.clear();await run();await flush();
    assert.equal(f.capture.isActive(),false);assert.match(f.failures[0],/未切换/);assert.equal(f.clients[0].inputs.length,1);
});
test('stop while authorization or connect is pending cannot resurrect capture or leak control', async () => {
    for (const stage of ['authorize','connect']) {
        const f=fixture();let release;const gate=new Promise(resolve=>{release=resolve;});
        if(stage==='authorize')f.setAuthorize(()=>gate);else f.delay.connect=gate;
        const controller=new AbortController();const task=f.capture.capture(f.options,controller.signal);const rejected=assert.rejects(task,/取消/);
        await flush();controller.abort();release();await rejected;await flush();
        assert.equal(f.capture.isActive(),false);assert.equal(f.bridges.length,0);assert.ok(f.clients.every(c=>c.closed===1));
    }
});
test('late start and bridge completion release resources after cancellation; audio failure does not retry', async () => {
    for(const stage of ['start','bridge','fail']) {
        const f=fixture();let release;const gate=new Promise(resolve=>{release=resolve;});
        if(stage==='fail') f.delay.fail=true;else f.delay[stage]=gate;
        const controller=new AbortController();const task=f.capture.capture(f.options,controller.signal);const rejected=assert.rejects(task);
        await flush();if(stage!=='fail')controller.abort();release();await rejected;await flush();
        assert.equal(f.capture.isActive(),false);assert.equal(f.clients[0].inputs.length,1);assert.equal(f.clients[0].closed,1);assert.equal(f.bridges[0].disposed,1);assert.equal(f.timers.size,0);
    }
});
test('late preparation cannot overwrite or retire a newer native capture owner', async () => {
    for(const stage of ['options','sources']) {
        const f=fixture();let release;f.delay[stage]=new Promise(resolve=>{release=resolve;});
        const controller=new AbortController();const old=f.capture.capture(f.options,controller.signal);const rejected=assert.rejects(old,/取消/);
        await flush();controller.abort();await flush();
        const stream=await f.capture.capture(f.options,new AbortController().signal);
        release();await rejected;await flush();
        assert.equal(f.clients[0].closed,1);assert.equal(f.clients[0].inputs.length,0);
        if(stage==='options')assert.equal(f.clients[0].sourceCalls,0);
        assert.equal(f.clients[1].closed,0);assert.equal(f.capture.get(stream).client,f.clients[1]);
        f.capture.stop();await flush();assert.equal(f.clients[1].closed,1);
    }
});
test('concurrent starts and in-place audio-source changes are rejected without extra tracks', async () => {
    const f=fixture();const stream=await f.capture.capture(f.options,new AbortController().signal);
    await assert.rejects(f.capture.capture(f.options,new AbortController().signal),/已有/);
    await assert.rejects(f.capture.update(stream,{...f.options,nativeAudioTargetKey:'235:123456'},false),/重新开始/);
    await assert.rejects(f.capture.update(stream,f.options,true),/重新开始/);
    assert.equal(f.bridges.length,1);f.capture.stop();await flush();
});
