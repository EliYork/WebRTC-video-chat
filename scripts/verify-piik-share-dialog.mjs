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
            export const defaultNativeCapturePath=()=>({adapterIndex:0,encoderIndex:0});
            export const nativeCaptureTargetKey=target=>target.sourceId;
        `}));}
}]});
const markup = await ejs.renderFile('src/views/room/index.ejs', {
    piikEnabled: true, roomId: 'lobby', channelName: '大厅',
    channels: [{ slug: 'lobby', name: '大厅' }], cspNonce: '',
    roomBootstrap: '{}', roomAssetVersions: {},
});
const css = readFileSync('src/views/styles/startup.min.css', 'utf8');
const dockRuntime = readFileSync('src/views/js/media/media-dock-runtime.js', 'utf8');
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
try {
    const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.setContent(`<style>${css}</style>`);
    await page.evaluate((roomMarkup) => {
        const room = new DOMParser().parseFromString(roomMarkup, 'text/html');
        const main = room.querySelector('#main');
        main.inert = false;
        document.body.append(main);
        crypto.randomUUID=()=> 'synthetic_share_123456';
        window.FakeClient=class {
            health={nativeMedia:{video:true,independentAudio:true,processAudio:true,processAudioExclusion:true,systemAudio:true}};
            static async connect(){return new this();}
            async sources() {
                return [
                    { kind: 'display', sourceId: 'screen-A', title: 'DISPLAY1' },
                    ...Array.from({ length: 9 }, (_, index) => ({
                        kind: 'window', sourceId: `window-${index + 1}`,
                        pid: 8 + index, creationTime: String(80 + index), title: `应用 ${index + 1}`,
                    })),
                ];
            }
            async sourcePreview(){const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const context=canvas.getContext('2d');context.fillStyle='#fce3ee';context.fillRect(0,0,320,180);context.fillStyle='#9c4568';context.font='22px system-ui';context.fillText('模拟来源预览',80,90);return canvas.toDataURL();}
            async audioSources(){return {systemSafe:true,sources:[{pid:42,creationTime:'420',name:'应用 B（无窗口）.exe',active:true,hasSession:true,icon:''},{pid:43,creationTime:'430',name:'无声应用.exe',active:false,hasSession:false,icon:''}]};}
            async captureOptions(){return [];}
            onEvent(){return ()=>{};}onClose(){return ()=>{};}
            async startShare(input){window.startInput=input;return {codec:'h264',audio:input.audio};}
            async shareStatus(){return {state:'active',codec:'h264',hardware:true,encoder:'Fixture H.264 Encoder MFT',adapter:'Fixture GPU',audio:'active'};}
            async stopShare(){}close(){}
        };
        window.FakeBridge=class {async start(){return {fixture:true};}dispose(){}};
    }, markup);
    await page.addScriptTag({content:outputFiles[0].text});
    await page.addScriptTag({ content: readFileSync('src/views/js/media/audio-processing-view.js', 'utf8') });
    await page.addScriptTag({content:dockRuntime});
    await page.evaluate(() => {
        window.capture = window.Capture.createNativeCapture(async () => {}, () => {});
        document.querySelector('[data-screen-share-provider]').value = 'native';
        const snapshot = { actualVoiceJoined: true, mediaControlsAvailable: true };
        const noop = () => {};
        const adapter = {
            getSnapshot: () => snapshot,
            subscribe(listener) { listener(snapshot); return noop; },
            hangUp: noop, joinVoice: noop, leaveVoice: noop, selectCamera: noop,
            selectMicrophone: noop, selectOutput: noop, setOutputMuted: noop,
            setOutputVolume: noop, startScreenShare: noop, stopScreenShare: noop,
            toggleCamera: noop, toggleMicrophone: noop,
        };
        window.VoiceMediaDockRuntime.createMediaDockRuntime({
            root: document.querySelector('#buttons'), adapter,
            initialScreenShareOptions: { resolutionPreset: 'original' },
        }).init();
    });
    await page.locator('#shareScreen').click();
    await page.waitForSelector('[data-native-audio-target] option[value="42:420"]',{state:'attached'});
    await page.locator('[data-native-source-key="window-1"]').click();
    const dialog = page.locator('dialog.screen-share-settings-popover');
    const pager = page.locator('[data-source-group="window"]').getByRole('button', { name: /下一页/ });
    await pager.click();
    assert.equal(await dialog.isVisible(), true);
    assert.equal(await pager.textContent(), '2 / 3 · 下一页');
    assert.equal(await page.locator('[data-native-source-key="window-4"]').count(), 1);
    assert.equal(await page.locator('[data-piik-native-source]').inputValue(), 'window-1');
    assert.equal(await pager.evaluate(button => button === document.activeElement), true);
    await page.keyboard.press('Enter');
    assert.equal(await dialog.isVisible(), true);
    assert.equal(await pager.textContent(), '3 / 3 · 下一页');
    await page.keyboard.press('Enter');
    assert.equal(await pager.textContent(), '1 / 3 · 下一页');
    assert.equal(await page.locator('[data-native-source-key="window-1"]').getAttribute('aria-pressed'), 'true');
    await page.locator('[data-native-source-key="screen-A"]').click();
    assert.equal(await page.locator('[data-screen-share-resolution] option[value="original"]').count(), 0);
    assert.equal(await page.locator('[data-screen-share-resolution]').inputValue(), '1080p');
    assert.equal(await page.locator('[data-screen-share-bitrate]').isVisible(), true);
    assert.equal(await dialog.getByText(/高级设置|编码方式|实际编码器|GPU 适配器|等待开始共享/).count(), 0);
    assert.equal(await page.locator('[data-share-web-only]').isVisible(), false);
    assert.equal(await page.locator('[data-native-audio-mode]').inputValue(),'system');
    assert.equal(await page.locator('[data-native-audio-mode] option:checked').textContent(),'系统声音');
    assert.equal(await page.locator('[data-screen-share-provider]').isVisible(),false);
    assert.equal(await page.getByText(/授权/).count(),0);
    await page.locator('[data-native-audio-mode]').selectOption('application');
    await page.locator('[data-native-audio-target]').selectOption('42:420');
    assert.equal(await page.locator('[data-piik-native-source]').inputValue(),'screen-A');
    assert.ok(await page.locator('[data-native-audio-application]').isVisible());
    await page.evaluate(async () => {
        window.shareStream = await window.capture.capture({nativeSourceKey:'screen-A',nativeAudioMode:'application',nativeAudioTargetKey:'42:420',shareAudio:true,resolutionPreset:'1080p',frameRate:60},new AbortController().signal);
    });
    await page.waitForFunction(() => window.capture.get(window.shareStream)?.encoderStatus?.hardware === true);
    const input=await page.evaluate(()=>window.startInput);assert.equal(input.source.sourceId,'screen-A');assert.equal(input.audioTarget.pid,42);assert.equal(input.microphoneMixing,false);
    const viewports=[[1920,1080],[2560,1440],[3840,2160],[1280,720],[900,650],[480,640],[375,812]];
    const layouts=[];
    for(const [width,height] of viewports){
        await page.setViewportSize({width,height});
        const layout=await page.evaluate(()=>{const dialog=document.querySelector('dialog');const rect=dialog.getBoundingClientRect();return {x:rect.x,y:rect.y,width:rect.width,height:rect.height,horizontalOverflow:dialog.scrollWidth>dialog.clientWidth,bodyOverflow:document.querySelector('.share-dialog-body').scrollWidth>document.querySelector('.share-dialog-body').clientWidth};});
        assert.ok(layout.x>=0 && layout.y>=0 && layout.width<=width && layout.height<=height);assert.equal(layout.horizontalOverflow,false);assert.equal(layout.bodyOverflow,false);
        if (width >= 640) {
            const fields = await page.locator('[data-screen-share-resolution], [data-screen-share-frame-rate], [data-native-audio-mode]')
                .evaluateAll(selects => selects.map(select => {
                    const { top, height } = select.getBoundingClientRect();
                    return { top, height };
                }));
            assert.deepEqual(fields, [fields[0], fields[0], fields[0]], `shared dropdown alignment at ${width}×${height}`);
        }
        await page.screenshot({path:resolve(directory,`dialog-${width}x${height}.png`)});layouts.push({viewport:[width,height],...layout});
    }
    await page.keyboard.press('Escape');
    assert.equal(await dialog.isVisible(), false);
    await page.evaluate(() => {
        document.querySelector('[data-screen-share-provider]').value = 'web';
        document.querySelector('#shareScreen').click();
    });
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
        return {cancelled,newestOwnsList:!document.querySelector('[data-native-audio-target] option[value="99:990"]'), unsafeSystemDisabled:document.querySelector('[data-native-audio-mode] option[value="system"]').disabled};
    });
    assert.deepEqual(cancellation,{cancelled:true,newestOwnsList:true,unsafeSystemDisabled:true});
    assert.deepEqual(errors,[]);
    writeFileSync(resolve(directory,'ui-result.json'),JSON.stringify({passed:true,syntheticOnly:true,layouts,cancellation,errors},null,2));
    process.stdout.write(`Share dialog: click and keyboard pagination, aligned dropdowns at ${viewports.length} viewport sizes, independent audio and web capability checks passed.\n`);
} finally {await browser.close();}
