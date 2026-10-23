/* eslint-disable no-await-in-loop -- Sequential screenshots and dialog ownership. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import ejs from 'ejs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const directory=resolve('integrations/piik/artifacts/independent-audio');mkdirSync(directory,{recursive:true});
const {outputFiles}=await build({stdin:{contents:'export * from "./integrations/piik/native.ts"; export {createAudioSourcePicker} from "./integrations/piik/share-audio.ts";',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'Capture',platform:'browser',tsconfigRaw:{},plugins:[{
    name:'metadata-fixture',setup(builder){builder.onResolve({filter:/\.deps\/upstream/},args=>({path:args.path,namespace:'mock'}));
        builder.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`
            export const NativeClient=window.FakeClient;
            export const NativeMediaBridge=window.FakeBridge;
            export const discoverNativeConnect=async()=>null;
            export const defaultNativeCapturePath=()=>({adapterIndex:0,encoderIndex:0});
            export const nativeCaptureTargetKey=target=>target.sourceId;
        `}));}
}]});
const markup=ejs.render(readFileSync('src/views/room/share-dialog.ejs','utf8'),{piikPrototype:true});
const css=readFileSync('src/views/styles/share-dialog.css','utf8');
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
try {
    const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.setContent(`<style>:root{--panel:#fff;--page:#fff8fb;--text:#3c3038;--muted:#806f79;--line:#e3cbd7;--line-soft:#f0e1e9;--accent:#c95887;--accent-soft:#fde6f0}body{font:14px system-ui;background:#faf1f6}.media-select-row{display:grid;grid-template-columns:110px minmax(0,1fr);align-items:center;gap:16px}.media-device-hint{font-size:12px;color:var(--muted);line-height:1.6}${css}</style>${markup}`);
    await page.evaluate(()=>{
        crypto.randomUUID=()=> 'synthetic_share_123456';
        window.FakeClient=class {
            health={nativeMedia:{video:true,independentAudio:true,processAudio:true,processAudioExclusion:true,systemAudio:true}};
            static async connect(){return new this();}
            async sources(){return [{kind:'display',sourceId:'screen-A',title:'DISPLAY1'},{kind:'window',sourceId:'window-C',pid:8,creationTime:'80',title:'应用 C · 测试画面'}];}
            async sourcePreview(){const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const context=canvas.getContext('2d');context.fillStyle='#fce3ee';context.fillRect(0,0,320,180);context.fillStyle='#9c4568';context.font='22px system-ui';context.fillText('模拟来源预览',80,90);return canvas.toDataURL();}
            async audioSources(){return {systemSafe:true,sources:[{pid:42,creationTime:'420',name:'应用 B（无窗口）.exe',active:true,hasSession:true,icon:''},{pid:43,creationTime:'430',name:'无声应用.exe',active:false,hasSession:false,icon:''}]};}
            async captureOptions(){return [];}
            onEvent(){return ()=>{};}onClose(){return ()=>{};}
            async startShare(input){window.startInput=input;return {codec:'h264',audio:input.audio};}
            async shareStatus(){return {state:'active',codec:'h264',hardware:true,encoder:'Fixture H.264 Encoder MFT',adapter:'Fixture GPU',audio:'active'};}
            async stopShare(){}close(){}
        };
        window.FakeBridge=class {async start(){return {fixture:true};}dispose(){}};
    });
    await page.addScriptTag({content:outputFiles[0].text});
    await page.evaluate(()=>{
        window.capture=window.Capture.createNativeCapture(async()=>{},()=>{});
        document.querySelector('[data-screen-share-provider]').value='native';
        document.querySelector('dialog').classList.add('is-open');document.querySelector('dialog').showModal();
        document.dispatchEvent(new CustomEvent('voice-share-dialog-open',{detail:{mode:'source'}}));
    });
    await page.waitForSelector('[data-native-audio-target] option[value="42:420"]',{state:'attached'});
    await page.locator('[data-native-source-key="screen-A"]').click();
    assert.equal(await page.locator('[data-native-audio-mode]').inputValue(),'none');
    await page.locator('[data-native-audio-mode]').selectOption('application');
    await page.locator('[data-native-audio-target]').selectOption('42:420');
    assert.equal(await page.locator('[data-piik-native-source]').inputValue(),'screen-A');
    assert.ok(await page.locator('[data-native-audio-application]').isVisible());
    await page.evaluate(()=>{document.querySelector('.share-advanced').open=true;});
    await page.evaluate(()=>window.capture.capture({nativeSourceKey:'screen-A',nativeAudioMode:'application',nativeAudioTargetKey:'42:420',shareAudio:true,resolutionPreset:'1080p',frameRate:60},new AbortController().signal));
    await page.waitForFunction(()=>document.querySelector('[data-native-encoder-method]').textContent==='GPU 硬件编码');
    const input=await page.evaluate(()=>window.startInput);assert.equal(input.source.sourceId,'screen-A');assert.equal(input.audioTarget.pid,42);assert.equal(input.microphoneMixing,false);
    const viewports=[[1920,1080],[2560,1440],[3840,2160],[900,650],[480,640]];
    const layouts=[];
    for(const [width,height] of viewports){
        await page.setViewportSize({width,height});
        const layout=await page.evaluate(()=>{const dialog=document.querySelector('dialog');const rect=dialog.getBoundingClientRect();return {x:rect.x,y:rect.y,width:rect.width,height:rect.height,horizontalOverflow:dialog.scrollWidth>dialog.clientWidth,bodyOverflow:document.querySelector('.share-dialog-body').scrollWidth>document.querySelector('.share-dialog-body').clientWidth};});
        assert.ok(layout.x>=0 && layout.y>=0 && layout.width<=width && layout.height<=height);assert.equal(layout.horizontalOverflow,false);assert.equal(layout.bodyOverflow,false);
        await page.screenshot({path:resolve(directory,`dialog-${width}x${height}.png`)});layouts.push({viewport:[width,height],...layout});
    }
    await page.locator('[data-screen-share-provider]').selectOption('web');
    assert.equal(await page.locator('[data-native-audio-section]').isVisible(),false);assert.equal(await page.locator('[data-web-audio-section]').isVisible(),true);
    await page.evaluate(()=>{window.capture.stop();document.dispatchEvent(new Event('voice-share-dialog-close'));});
    const cancellation=await page.evaluate(async()=>{
        const picker=window.Capture.createAudioSourcePicker();
        let release;
        const pending=new Promise(resolve=>{release=resolve;});
        const loading=picker.load({health:{nativeMedia:{independentAudio:true,processAudio:true}},audioSources:()=>pending});
        const before=document.querySelector('[data-native-audio-target]').innerHTML;
        picker.close();
        release({systemSafe:true,sources:[{pid:99,creationTime:'990',name:'late.exe',active:false,hasSession:false,icon:''}]});
        await loading;
        const cancelled=document.querySelector('[data-native-audio-target]').innerHTML===before;
        let finishOld;
        const old=new Promise(resolve=>{finishOld=resolve;});
        const slow=picker.load({health:{nativeMedia:{independentAudio:true}},audioSources:()=>old});
        await picker.load({health:{nativeMedia:{independentAudio:true}},audioSources:async()=>({systemSafe:false,sources:[]})});
        finishOld({systemSafe:true,sources:[{pid:99,creationTime:'990',name:'old.exe',active:false,hasSession:false,icon:''}]});
        await slow;
        return {cancelled,newestOwnsList:!document.querySelector('[data-native-audio-target] option[value="99:990"]')};
    });
    assert.deepEqual(cancellation,{cancelled:true,newestOwnsList:true});
    assert.deepEqual(errors,[]);
    writeFileSync(resolve(directory,'ui-result.json'),JSON.stringify({passed:true,syntheticOnly:true,layouts,cancellation,errors},null,2));
    process.stdout.write(`Share dialog: ${viewports.length} viewport sizes, independent audio and web capability checks passed.\n`);
} finally {await browser.close();}
