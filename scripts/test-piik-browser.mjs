/* eslint-disable no-console, no-await-in-loop */
// Isolated headless Edge, synthetic motion + fake microphones. No desktop,
// user browser profile, input injection, window focus, or physical devices.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import {
    mkdtempSync,
    existsSync,
    readFileSync,
    rmSync,
    writeFileSync,
    mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import WebSocket from 'ws';
import { startPiikLocal } from './piik-local-service.mjs';
import { runNativeScenario } from './piik-native-scenario.mjs';
import { runNativePerformance } from './piik-performance-scenario.mjs';
const webCodec = process.argv.includes('--av1') ? 'AV1' : process.argv.includes('--h264') ? 'H264' : 'VP8';
const measureCodec = process.argv.includes('--measure');
const bitrateSweep = process.argv.includes('--bitrate-sweep');
const sweep1080p60 = bitrateSweep && process.argv.includes('--1080p60');
const sweepPreset = sweep1080p60
    ? { width: 1920, height: 1080, frameRate: 60 }
    : { width: 1280, height: 720, frameRate: 30 };
const rateArgument = process.argv.find((arg) => arg.startsWith('--rates='));
const sweepRates = rateArgument
    ? rateArgument.slice('--rates='.length).split(',').map(Number)
    : [0.5, 1, 2, 3, 6, 10, 15];
assert.ok(sweepRates.every(rate => Number.isFinite(rate) && rate > 0 && rate <= 15), 'invalid bitrate sweep rates');
const work = mkdtempSync(join(tmpdir(), 'piik-platform-'));
const artifacts = resolve('integrations/piik/artifacts');
mkdirSync(artifacts, { recursive: true });
const piik = await startPiikLocal();
const reservation = createServer();
reservation.listen(40000 + Math.floor(Math.random() * 10000), '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise((done) => reservation.close(done));
const app = spawn(process.execPath, [resolve('src/server.js')], {
    cwd: work,
    windowsHide: true,
    stdio: 'pipe',
    env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: String(port),
        USE_HTTPS: 'false',
        SFU_ENABLED: 'false',
        PIIK_ENABLED: 'true',
        PIIK_INTERNAL_URL: piik.baseURL,
        CHAT_HISTORY_FILE: join(work, 'history.json'),
        ENV: 'production',
    },
});
let log = '';
app.stdout.on('data', (b) => {
    log += b;
});
app.stderr.on('data', (b) => {
    log += b;
});
const errors = [],
    warnings = [];
let browser,
    ws,
    counter = 0;
const pending = new Map();
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const wait = async (check, label, timeout = 20000) => {
    for (let end = Date.now() + timeout; Date.now() < end; ) {
        if (await check()) return;
        await delay(100);
    }
    throw new Error(
        `Timeout ${label}\n${JSON.stringify(errors)}\n${warnings.slice(-8).join('\n')}\n${log.slice(-1600)}`
    );
};
const send = (method, params = {}, sessionId) =>
    new Promise((done, reject) => {
        const id = ++counter;
        const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`CDP timeout ${method}`));
        }, 15000);
        pending.set(id, { done, reject, timer });
        ws.send(
            JSON.stringify({
                id,
                method,
                params,
                ...(sessionId ? { sessionId } : {}),
            })
        );
    });
const evaluate = async (s, expression) => {
    const r = await send(
        'Runtime.evaluate',
        { expression, returnByValue: true, awaitPromise: true },
        s
    );
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
};
const click = (s, selector) =>
    evaluate(s, `document.querySelector(${JSON.stringify(selector)}).click()`);
const screenshot = async (s, name) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' }, s);
    writeFileSync(join(artifacts, name + '.png'), Buffer.from(data, 'base64'));
};
// Render the same numbered frame on both peers. The two marker rows are
// complements, so visibly damaged markers can be discarded before comparing frames.
function motionScene(Canvas, { width, height, frameRate }) {
    const texture = new Canvas(width, height);
    const background = texture.getContext('2d');
    const pixels = background.createImageData(width, height);
    let seed = 123456789;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            const i = (y * width + x) * 4;
            const tile = (Math.floor(x / 16) + Math.floor(y / 24)) % 2 ? 54 : 0;
            const shade = tile + ((seed >>> 25) & 63) + Math.round(26 * (1 + Math.sin(x / 11) * Math.cos(y / 8)));
            pixels.data[i] = shade + 12;
            pixels.data[i + 1] = shade + 38;
            pixels.data[i + 2] = shade + 25;
            pixels.data[i + 3] = 255;
        }
    }
    background.putImageData(pixels, 0, 0);
    return (ctx, frame) => {
        const angle = frame * Math.PI / 128;
        // At 1080p60 use integer blits for the moving background. A rotated,
        // resampled software canvas can bottleneck the fixture before WebRTC.
        if (height === 1080) {
            const x = Math.round(105 * (1 + Math.sin(angle)));
            const y = Math.round(75 * (1 + Math.cos(angle * 2)));
            ctx.drawImage(texture, -x, -y);
            ctx.drawImage(texture, width - x, -y);
            ctx.drawImage(texture, -x, height - y);
            ctx.drawImage(texture, width - x, height - y);
        }
        ctx.save();
        ctx.scale(width / 1280, height / 720);
        if (height !== 1080) {
            ctx.fillStyle = '#293346';
            ctx.fillRect(0, 0, 1280, 720);
            ctx.save();
            ctx.translate(640, 360);
            ctx.rotate(Math.sin(angle * 3) * 0.17);
            ctx.scale(1.36, 1.36);
            ctx.drawImage(texture, -640 + 65 * Math.sin(angle), -360 + 35 * Math.cos(angle), 1280, 720);
            ctx.restore();
        }
        for (let i = 0; i < 35; i++) {
            const x = 68 + (i * 211) % 1140 + 55 * Math.sin(angle * (1 + i % 3) + i);
            const y = 68 + (i * 137) % 570 + 50 * Math.cos(angle * (1 + i % 4) + i);
            ctx.fillStyle = 'hsl(' + ((i * 107) % 360) + ',75%,62%)';
            ctx.fillRect(x, y, 42, 25);
            ctx.strokeStyle = '#171923';
            ctx.strokeRect(x, y, 42, 25);
        }
        ctx.fillStyle = '#1a2332';
        ctx.fillRect(12, 635, 330, 68);
        ctx.fillStyle = '#f2f5f8';
        ctx.font = '20px monospace';
        ctx.fillText('FIELD TEST  ' + height + 'p  /  ' + frameRate + ' FPS', 29, 677);
        for (let bit = 0; bit < 8; bit++) {
            const on = (frame >> bit) & 1;
            ctx.fillStyle = on ? 'white' : 'black';
            ctx.fillRect(bit * 24, 0, 24, 18);
            ctx.fillStyle = on ? 'black' : 'white';
            ctx.fillRect(bit * 24, 18, 24, 18);
        }
        ctx.restore();
    };
}

function motionQuality(draw, Canvas, { width, height }) {
    const reference = new Canvas(width, height).getContext('2d', { willReadFrequently: true });
    const received = new Canvas(width, height).getContext('2d', { willReadFrequently: true });
    const xPosition = (x) => Math.round(x * width / 1280);
    const yPosition = (y) => Math.round(y * height / 720);
    return (video) => {
        if (video?.videoWidth !== width || video.videoHeight !== height) return null;
        received.drawImage(video, 0, 0);
        const rendered = received.getImageData(0, 0, width, height).data;
        let frame = 0;
        for (let bit = 0; bit < 8; bit++) {
            const x = xPosition(12 + bit * 24);
            const first = rendered[(yPosition(9) * width + x) * 4];
            const second = rendered[(yPosition(27) * width + x) * 4];
            if (Math.abs(first - second) < 130) return null;
            if (first > second) frame |= 1 << bit;
        }
        draw(reference, frame);
        const ideal = reference.getImageData(0, 0, width, height).data;
        let error = 0;
        let count = 0;
        for (let y = yPosition(40); y < height; y += 4) {
            for (let x = 0; x < width; x += 4) {
                const i = (y * width + x) * 4;
                const diff = 0.2126 * (rendered[i] - ideal[i]) + 0.7152 * (rendered[i + 1] - ideal[i + 1]) + 0.0722 * (rendered[i + 2] - ideal[i + 2]);
                error += diff * diff;
                count++;
            }
        }
        return 10 * Math.log10(255 ** 2 / Math.max(1e-9, error / count));
    };
}

const probe = `(() => {
    const preset = ${JSON.stringify(sweepPreset)};
    const drawMotion = ${bitrateSweep ? `(${motionScene})(OffscreenCanvas, preset)` : 'null'};
    if (drawMotion) window.__motionQuality = (${motionQuality})(drawMotion, OffscreenCanvas, preset);
    Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.__diagnosticsCopy=text;}}});
    window.__pcs=[]; const Original=RTCPeerConnection;
    window.RTCPeerConnection=new Proxy(Original,{construct(T,args){const pc=new T(...args);__pcs.push(pc);return pc;}});
    const replaceTrack=RTCRtpSender.prototype.replaceTrack;
    RTCRtpSender.prototype.replaceTrack=function(track){
        if(window.__rejectNextVideoReplacement && this.track?.kind==='video' && track?.kind==='video'){
            window.__rejectNextVideoReplacement=false;
            return Promise.reject(new DOMException('Synthetic video replacement failure','InvalidModificationError'));
        }
        return replaceTrack.call(this,track);
    };
    const createAnswer=Original.prototype.createAnswer;
    Original.prototype.createAnswer=function(options){
        if(window.__omitAv1){
            const codecs=RTCRtpReceiver.getCapabilities('video').codecs.filter(codec=>codec.mimeType.toLowerCase()!=='video/av1');
            this.getTransceivers().filter(transceiver=>transceiver.receiver.track.kind==='video')
                .forEach(transceiver=>transceiver.setCodecPreferences(codecs));
        }
        return createAnswer.call(this,options);
    };
    let factory; Object.defineProperty(window,'io',{configurable:true,get(){return factory;},set(value){factory=new Proxy(value,{apply(T,self,args){const socket=Reflect.apply(T,self,args);window.__socket=socket;socket.on('piik:message',({sessionId,message})=>{(window.__piikMessages??=[]).push({sessionId,type:message.type,phase:message.phase,revision:message.revision});});return socket;}});}});
    navigator.mediaDevices.getDisplayMedia=async(options)=>{
        window.__lastCaptureOptions=options;
        if(window.__cancelNextCapture){
            window.__cancelNextCapture=false;
            throw new DOMException('Synthetic picker cancelled','NotAllowedError');
        }
        const useDisplayTrack=window.__useDisplayTrack;
        window.__useDisplayTrack=false;
        const canvas=document.createElement('canvas');
        const [width,height]=window.__nextCaptureSize || [preset.width,preset.height];
        window.__nextCaptureSize=null;
        canvas.width=width;canvas.height=height;
        const context=canvas.getContext('2d');let frame=0;
        let captureTrack;
        const manualCadence=drawMotion && preset.frameRate===60;
        let nextFrameAt=performance.now();
        const timer=setInterval(()=>{
            if (drawMotion) {
                if (manualCadence) {
                    const now=performance.now();
                    if (now < nextFrameAt) return;
                    const interval=1000/preset.frameRate;
                    nextFrameAt=Math.max(nextFrameAt+interval,now);
                }
                drawMotion(context, frame++ & 255);
                window.__sweepDrawnFrames=frame;
                if (manualCadence) captureTrack?.requestFrame();
                return;
            }
            context.fillStyle='hsl('+(frame++%360)+',75%,45%)';
            context.fillRect(0,0,canvas.width,canvas.height);
            context.fillStyle='white';context.fillRect((frame*17)%1200,120,80,440);
        },manualCadence ? 4 : drawMotion ? 1000/preset.frameRate : 16);
        const stream=useDisplayTrack
            ? await navigator.mediaDevices.getUserMedia({video:{width:{exact:1920},height:{exact:1080},frameRate:30}})
            : canvas.captureStream(manualCadence ? 0 : preset.frameRate);
        let audioContext;
        if(options.audio){
            audioContext=new AudioContext();
            const oscillator=audioContext.createOscillator(), output=audioContext.createMediaStreamDestination();
            oscillator.connect(output);oscillator.start();
            stream.addTrack(output.stream.getAudioTracks()[0]);
        }
        const track=stream.getVideoTracks()[0], stop=track.stop.bind(track), apply=track.applyConstraints.bind(track);
        captureTrack=track;
        if(useDisplayTrack){
            // Use real Chromium capture constraints and exercise Piik's display-specific sender clone.
            const settings=track.getSettings.bind(track), clone=track.clone.bind(track);
            track.getSettings=()=>({...settings(),displaySurface:'monitor'});
            track.clone=()=>{
                const input=clone(), constrain=input.applyConstraints.bind(input);
                input.applyConstraints=async constraints=>{
                    await constrain(constraints);
                    window.__senderCaptureSettings=input.getSettings();
                };
                return input;
            };
        }
        track.stop=()=>{clearInterval(timer);void audioContext?.close();stop();};
        track.applyConstraints=async value=>{window.__lastCaptureConstraints=value;return apply(value);};
        window.__capture=stream;
        if(window.__holdNextCapture){
            window.__holdNextCapture=false;
            return new Promise(resolve=>{window.__releaseCapture=()=>resolve(stream);});
        }
        return stream;
    };
    window.__mediaStats=async()=>{const result=[];for(const pc of __pcs){if(pc.connectionState!=='connected')continue;const stats=await pc.getStats();for(const r of stats.values()){if(r.type==='inbound-rtp'||r.type==='outbound-rtp')result.push({id:r.id,timestamp:r.timestamp,type:r.type,kind:r.kind,framesDecoded:r.framesDecoded,framesEncoded:r.framesEncoded,frameWidth:r.frameWidth,frameHeight:r.frameHeight,totalEncodeTime:r.totalEncodeTime,sourceFps:stats.get(r.mediaSourceId)?.framesPerSecond,qualityLimitationReason:r.qualityLimitationReason,bytesReceived:r.bytesReceived,bytesSent:r.bytesSent,codec:stats.get(r.codecId)?.mimeType});}}return result;};
})()`;
async function open(room = 'lobby', { desktop = false } = {}) {
    const { targetId } = await send('Target.createTarget', {
        url: 'about:blank',
    });
    const { sessionId: s } = await send('Target.attachToTarget', {
        targetId,
        flatten: true,
    });
    await send('Page.enable', {}, s);
    await send('Runtime.enable', {}, s);
    await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }, s);
    await send('Page.addScriptToEvaluateOnNewDocument', {
        source: desktop ? 'window.EliYorkDesktop = {};\n' + probe : probe,
    }, s);
    await send(
        'Page.navigate',
        { url: `http://127.0.0.1:${port}/room/${room}` },
        s
    );
    await wait(
        () =>
            evaluate(s, `document.documentElement?.dataset.roomBoot==='ready'`),
        'room boot'
    );
    return s;
}
const mediaRequest = (s, input) =>
    evaluate(
        s,
        `new Promise(done=>__socket.emit('piik:request',${JSON.stringify(input)},done))`
    );
const share = async (s) => {
    await click(s, '#shareScreen');
    await evaluate(
        s,
        `(() => {
            const select = (name,value) => {
                const field=document.querySelector('[data-screen-share-'+name+']');
                field.value=value;
                field.dispatchEvent(new Event('change',{bubbles:true}));
            };
            select('codec','${webCodec.toLowerCase()}');
            if (${webCodec === 'AV1' || measureCodec || bitrateSweep}) select('frame-rate','30');
            if (${bitrateSweep}) {
                select('resolution','${sweepPreset.height}p');
                select('frame-rate','${sweepPreset.frameRate}');
                document.querySelector('[data-screen-share-audio]').checked=false;
            }
        })()`
    );
    await click(s, '[data-screen-share-start]');
    await wait(
        () =>
            evaluate(
                s,
                `document.querySelector('#main').dataset.stageMode==='sharing'`
            ),
        'publisher started'
    );
};
const receiving = (s) =>
    evaluate(
        s,
        `[...document.querySelectorAll('#video-grid video')].some(v=>v.videoWidth>0 && v.closest('.video-tile')?.id!=='local-video')`
    );
async function sampleCodec(sender, viewer, remoteVideo, maxMbps) {
    const codec = `video/${webCodec}`;
    await send('Page.bringToFront', {}, viewer);
    await wait(() => evaluate(viewer, `document.visibilityState==='visible' && ${remoteVideo}?.paused===false`), 'viewer is actively playing');
    const sample = async () => {
        const [outbound, inbound] = await Promise.all([
            evaluate(sender, `(async()=>({rtp:await __mediaStats(), drawn:window.__sweepDrawnFrames}))()`),
            evaluate(viewer, `(async()=>{
                const video=${remoteVideo};
                const quality=video.getVideoPlaybackQuality();
                return { rtp:await __mediaStats(), displayed:quality.totalVideoFrames-quality.droppedVideoFrames, dropped:quality.droppedVideoFrames };
            })()`),
        ]);
        return {
            send: outbound.rtp.find(row => row.type === 'outbound-rtp' && row.codec === codec && row.frameHeight === sweepPreset.height),
            receive: inbound.rtp.find(row => row.type === 'inbound-rtp' && row.codec === codec && row.frameHeight === sweepPreset.height),
            drawn: outbound.drawn,
            displayed: inbound.displayed,
            dropped: inbound.dropped,
        };
    };
    await wait(async () => { const row = await sample(); return row.send && row.receive; }, `${sweepPreset.height}p codec sample ready`);
    const warmupMs = maxMbps === undefined ? 1000 : sweep1080p60 && sweepRates.length === 1 ? 10000 : 2200;
    await delay(warmupMs);
    const before = await sample();
    const psnr = [];
    let midway, timedEnd;
    if (sweep1080p60) {
        await delay(5000);
        midway = await sample();
        await delay(5000);
        timedEnd = await sample();
    } else if (maxMbps === undefined) await delay(6000);
    if (maxMbps !== undefined) {
        for (let index = 0; index < 7; index++) {
            await delay(sweep1080p60 ? 225 : 700);
            const value = await evaluate(viewer, `__motionQuality(${remoteVideo})`);
            if (Number.isFinite(value)) psnr.push(value);
        }
        assert.ok(psnr.length >= 5, 'decoded frame markers must match the reference frames');
    }
    const after = timedEnd ?? await sample();
    assert.equal(before.send.id, after.send.id);
    assert.equal(before.receive.id, after.receive.id);
    const sendSeconds = (after.send.timestamp - before.send.timestamp) / 1000;
    const receiveSeconds = (after.receive.timestamp - before.receive.timestamp) / 1000;
    const encoded = after.send.framesEncoded - before.send.framesEncoded;
    assert.ok(encoded > 0 && sendSeconds > 0 && receiveSeconds > 0);
    return {
        codec, maxMbps, width: after.send.frameWidth, height: after.send.frameHeight,
        seconds: sendSeconds, warmupSeconds: warmupMs / 1000,
        videoMbps: (after.send.bytesSent - before.send.bytesSent) * 8 / sendSeconds / 1e6,
        encodedFps: encoded / sendSeconds,
        decodedFps: (after.receive.framesDecoded - before.receive.framesDecoded) / receiveSeconds,
        playbackFps: (after.displayed - before.displayed) / receiveSeconds,
        droppedPlaybackFps: (after.dropped - before.dropped) / receiveSeconds,
        playbackWindows: midway ? [
            (midway.displayed - before.displayed) * 1000 / (midway.receive.timestamp - before.receive.timestamp),
            (after.displayed - midway.displayed) * 1000 / (after.receive.timestamp - midway.receive.timestamp),
        ] : undefined,
        sourceFps: after.send.sourceFps ?? null,
        fixtureFps: Number.isFinite(after.drawn) ? (after.drawn - before.drawn) / sendSeconds : undefined,
        qualityLimitationReason: after.send.qualityLimitationReason ?? null,
        meanEncodeMs: (after.send.totalEncodeTime - before.send.totalEncodeTime) * 1000 / encoded,
        meanLumaPsnrDb: psnr.length ? psnr.reduce((total, value) => total + value, 0) / psnr.length : undefined,
    };
}
try {
    const base = `http://127.0.0.1:${port}`;
    await wait(async () => {
        try {
            return (await fetch(`${base}/room/lobby`)).ok;
        } catch {
            return false;
        }
    }, 'Node startup');
    const roomHTML = await (await fetch(`${base}/room/lobby`)).text();
    const piikVersion = roomHTML.match(/src="\/vendor\/piik-client\.js\?v=([0-9a-f]{64})"/)?.[1];
    assert.equal(piikVersion, createHash('sha256').update(readFileSync('integrations/piik/.build/client.js')).digest('hex'));
    const piikScript = `${base}/vendor/piik-client.js`;
    const versioned = await fetch(`${piikScript}?v=${piikVersion}`);
    assert.equal(versioned.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal(createHash('sha256').update(Buffer.from(await versioned.arrayBuffer())).digest('hex'), piikVersion);
    const stalePiikVersion = (piikVersion[0] === '0' ? '1' : '0') + piikVersion.slice(1);
    for (const query of ['', `?v=${stalePiikVersion}`, `?v=${piikVersion}&v=${piikVersion}`]) {
        const response = await fetch(piikScript + query);
        assert.equal(response.headers.get('cache-control'), 'no-cache');
        await response.arrayBuffer();
    }
    const executable =
        process.env.STAGE_TEST_BROWSER ||
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    browser = spawn(
        executable,
        [
            '--headless=new',
            '--mute-audio',
            ...(process.argv.includes('--gpu-receiver') ? [] : ['--disable-gpu']),
            '--disable-background-timer-throttling',
            '--disable-renderer-backgrounding',
            '--disable-backgrounding-occluded-windows',
            '--no-first-run',
            '--no-default-browser-check',
            '--remote-debugging-port=0',
            `--user-data-dir=${join(work, 'profile')}`,
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
            'about:blank',
        ],
        { windowsHide: true, stdio: 'pipe' }
    );
    await wait(
        () => existsSync(join(work, 'profile', 'DevToolsActivePort')),
        'headless Edge'
    );
    const [debugPort, path] = readFileSync(
        join(work, 'profile', 'DevToolsActivePort'),
        'utf8'
    )
        .trim()
        .split(/\r?\n/);
    ws = new WebSocket(`ws://127.0.0.1:${debugPort}${path}`);
    await once(ws, 'open');
    ws.on('message', (bytes) => {
        const m = JSON.parse(bytes);
        if (m.id) {
            const item = pending.get(m.id);
            if (!item) return;
            clearTimeout(item.timer);
            pending.delete(m.id);
            if (m.error) item.reject(new Error(JSON.stringify(m.error)));
            else item.done(m.result);
        } else if (m.method === 'Runtime.exceptionThrown')
            errors.push(m.params.exceptionDetails);
        else if (
            m.method === 'Runtime.consoleAPICalled' &&
            ['warning', 'error'].includes(m.params.type)
        )
            warnings.push(
                m.params.args.map((a) => a.value ?? a.description).join(' ')
            );
    });
    if (process.argv.some(a => a.startsWith('--performance='))) {
        const report = await runNativePerformance({ open, evaluate, click, wait, send, port, work });
        console.log(JSON.stringify({ tag: report.tag, preset: report.preset, appCpuCores: report.appCpuCores,
            retainedLogBytes: report.retainedLogBytes, intervals: report.intervals }, null, 2));
    } else if (process.argv.includes('--native')) {
        const report = await runNativeScenario({
            open,
            evaluate,
            click,
            wait,
            mediaRequest,
            port,
            work,
            screenshot,
        });
        writeFileSync(
            join(artifacts, 'native-browser-report.json'),
            JSON.stringify(report, null, 2)
        );
        console.log(JSON.stringify(report, null, 2));
    } else if (bitrateSweep) {
        const publisher = await open();
        const viewer = await open();
        for (const peer of [publisher, viewer]) {
            await click(peer, '#stageJoinVoice');
            await wait(() => evaluate(peer, `document.querySelector('#destroyPeer').dataset.sessionAction==='hangup'`), 'voice joined');
        }
        await share(publisher);
        await wait(() => receiving(viewer), `benchmark viewer receives ${sweepPreset.height}p motion`);
        const remoteVideo = `[...document.querySelectorAll('#video-grid video')].find(v=>v.videoWidth>0 && v.closest('.video-tile')?.id!=='local-video')`;
        const intervals = [];
        for (const maxMbps of sweepRates) {
            const applied = await evaluate(publisher, `(async()=>{
                const sender=__pcs.filter(pc=>pc.connectionState==='connected')
                    .flatMap(pc=>pc.getSenders()).find(sender=>sender.track?.kind==='video');
                const parameters=sender.getParameters();
                parameters.encodings[0].maxBitrate=${maxMbps * 1e6};
                await sender.setParameters(parameters);
                return sender.getParameters().encodings[0].maxBitrate;
            })()`);
            assert.equal(applied, maxMbps * 1e6);
            const interval = await sampleCodec(publisher, viewer, remoteVideo, maxMbps);
            intervals.push(interval);
            console.log(JSON.stringify(interval));
        }
        assert.deepEqual(errors, []);
        const data = { browser: (await send('Browser.getVersion')).product, syntheticMediaOnly: true, target: sweepPreset, intervals };
        const suffix = (sweep1080p60 ? '-1080p60' : '') +
            (process.argv.includes('--gpu-receiver') ? '-gpu' : '') +
            (rateArgument ? '-' + sweepRates.join('-') + 'mbps' : '');
        writeFileSync(join(artifacts, `bitrate-sweep-${webCodec.toLowerCase()}${suffix}.json`), JSON.stringify(data, null, 2));
    } else {
        const a = await open(),
            b = await open(),
            c = await open('game');
        assert.equal(
            (await mediaRequest(c, { action: 'list' })).ok,
            false,
            'unjoined socket denied'
        );
        for (const s of [a, b, c]) {
            await click(s, '#stageJoinVoice');
            await wait(
                () =>
                    evaluate(
                        s,
                        `document.querySelector('#destroyPeer').dataset.sessionAction==='hangup'`
                    ),
                'voice joined'
            );
        }
        for (const s of [a, b]) {
            // Joining can still be initializing the default microphone. Clicking
            // during that operation cancels it instead of enabling audio.
            await wait(() => evaluate(s, `document.querySelector('#toggleAudio').getAttribute('aria-busy') === 'false'`), 'default microphone initialization completes');
            if (await evaluate(s, `document.querySelector('#toggleAudio').getAttribute('aria-pressed') !== 'true'`)) await click(s, '#toggleAudio');
            await wait(
                () =>
                    evaluate(
                        s,
                        `document.querySelector('#toggleAudio').title.includes('关闭')`
                    ),
                'fake microphone enabled'
            );
        }
        await evaluate(a, 'window.__useDisplayTrack=true');
        await share(a);
        await wait(() => receiving(b), 'Piik video in original stage');
        await wait(() => evaluate(a, `!document.querySelector('dialog').open`), 'sharing dialog closes on success');
        assert.notEqual(await evaluate(a, '__lastCaptureOptions.audio'), false, 'capture follows the existing checked source-audio preference; test output remains muted');
        const shareAudioSender = `__pcs.flatMap(pc=>pc.getSenders()).find(sender=>sender.track === __capture.getAudioTracks()[0])`;
        await wait(() => evaluate(a, `${shareAudioSender}?.getParameters().encodings.some(encoding => encoding.maxBitrate === 256000)`), 'Piik browser sender accepts the 256 kbps screen audio ceiling');
        const publicationId = (await mediaRequest(b, { action: 'list' })).shares[0].id;
        const originalTrackId = await evaluate(a, '__capture.getVideoTracks()[0].id');
        const remoteVideo = `[...document.querySelectorAll('#video-grid video')].find(v=>v.videoWidth>0 && v.closest('.video-tile')?.id!=='local-video')`;
        await wait(() => evaluate(b, `${remoteVideo}?.videoWidth === 1920`), 'original 1080p reaches the viewer');
        const remoteTrackId = await evaluate(b, `${remoteVideo}.srcObject.getVideoTracks()[0].id`);
        await click(a, '[data-local-share-controls] [data-share-action="quality"]');
        await evaluate(a, `(()=>{const select=(key,value)=>{const field=document.querySelector('[data-screen-share-'+key+']');field.value=value;field.dispatchEvent(new Event('change',{bubbles:true}));};select('resolution','720p');select('frame-rate','30');select('bitrate','6000000');})()`);
        await click(a, '[data-screen-share-start]');
        await wait(() => evaluate(a, `!document.querySelector('dialog').open`), 'browser live quality ack');
        assert.equal((await mediaRequest(b, { action: 'list' })).shares[0].id, publicationId);
        assert.equal(await evaluate(a, '__capture.getVideoTracks()[0].id'), originalTrackId, 'live quality preserves capture');
        assert.equal(await evaluate(a, '__senderCaptureSettings.width'), 1280, 'active display sender capture changes to 720p');
        assert.equal(await evaluate(a, `__pcs.flatMap(pc=>pc.getSenders()).some(s=>s.track?.kind==='video' && s.getParameters().encodings.some(e=>e.maxFramerate===30 && e.maxBitrate===6000000))`), true, 'quality is actually applied to sender');
        await wait(() => evaluate(b, `${remoteVideo}?.videoWidth === 1280 && ${remoteVideo}?.videoHeight === 720`), '720p reaches the viewer');
        assert.equal(await evaluate(b, `${remoteVideo}.srcObject.getVideoTracks()[0].id`), remoteTrackId, 'live quality preserves the received track');
        const codecSample = measureCodec ? await sampleCodec(a, b, remoteVideo) : undefined;
        await click(a, '[data-local-share-controls] [data-share-action="source"]');
        await evaluate(a, '__cancelNextCapture=true');
        await click(a, '[data-screen-share-start]');
        await wait(() => evaluate(a, `!document.querySelector('[data-screen-share-start]').disabled`), 'cancelled picker recovers');
        assert.equal((await mediaRequest(b, { action: 'list' })).shares[0].id, publicationId, 'cancel keeps old publication');
        assert.equal(await evaluate(a, '__capture.getVideoTracks()[0].readyState'), 'live');
        await evaluate(a, 'window.__oldCapture=__capture; window.__rejectNextVideoReplacement=true');
        await click(a, '[data-screen-share-start]');
        await wait(() => evaluate(a, `document.querySelector('[data-share-dialog-feedback]').textContent.includes('新画面未能发送')`), 'source replacement error shown');
        assert.equal((await mediaRequest(b, { action: 'list' })).shares[0].id, publicationId, 'replacement failure keeps the old publication');
        assert.equal(await evaluate(a, '__oldCapture.getVideoTracks()[0].readyState'), 'live');
        assert.equal(await evaluate(a, '__capture.getVideoTracks()[0].readyState'), 'ended', 'the failed new source is released');
        await evaluate(b, `window.__beforeReplacement=${remoteVideo}.getVideoPlaybackQuality().totalVideoFrames`);
        await wait(() => evaluate(b, `${remoteVideo}.getVideoPlaybackQuality().totalVideoFrames > __beforeReplacement+5`), 'old source remains live to the viewer');
        await evaluate(a, `window.__nextCaptureSize=[960,540];document.querySelector('[data-screen-share-audio]').checked=false`);
        await click(a, '[data-screen-share-start]');
        await wait(() => evaluate(a, `!document.querySelector('dialog').open`), 'controlled browser source replacement');
        const replaced = await mediaRequest(b, { action: 'list' });
        assert.equal(replaced.shares.length, 1);
        assert.equal(replaced.shares[0].id, publicationId);
        assert.equal(await evaluate(a, '__oldCapture.getVideoTracks()[0].readyState'), 'ended');
        assert.equal(await evaluate(a, '__lastCaptureOptions.audio'), false, 'explicit audio opt-out reaches the capture API');
        await wait(() => evaluate(b, `${remoteVideo}?.videoWidth===960 && ${remoteVideo}?.videoHeight===540`), 'viewer receives the new source');
        assert.equal(await evaluate(b, `${remoteVideo}.srcObject.getVideoTracks()[0].id`), remoteTrackId, 'source replacement keeps the received video track');
        const list = await mediaRequest(b, { action: 'list' });
        assert.equal(list.shares.length, 1);
        const viewerSession = `__piikMessages.filter(event=>event.type==='authenticated').at(-1)?.sessionId`;
        const closedViewerSession = await evaluate(b, viewerSession);
        assert.ok(closedViewerSession);
        assert.equal((await mediaRequest(b, { action: 'close', sessionId: closedViewerSession })).ok, true);
        await wait(() => evaluate(b, `${viewerSession}!==${JSON.stringify(closedViewerSession)} && ${remoteVideo}?.videoWidth===960`), 'viewer automatically resumes the existing publication');
        assert.equal((await mediaRequest(b, { action: 'list' })).shares[0].id, publicationId);
        const liveVideoTrack = `${remoteVideo}?.srcObject?.getVideoTracks().find(track=>track.readyState==='live')`;
        const previousViewerTrack = await evaluate(b, `(()=> {
            const track=${liveVideoTrack};
            track.stop();
            // A local stop does not dispatch ended; model a remote video track ending.
            track.dispatchEvent(new Event('ended'));
            return track.id;
        })()`);
        await wait(() => evaluate(b, `(()=> {
            const track=${liveVideoTrack};
            return track && track.id!==${JSON.stringify(previousViewerTrack)} && ${remoteVideo}?.videoWidth===960;
        })()`), 'viewer recovers an ended video track');
        assert.equal(await evaluate(b, '__socket.connected'), true);
        assert.equal((await mediaRequest(b, { action: 'list' })).shares[0].id, publicationId);
        assert.equal(
            (
                await mediaRequest(c, {
                    action: 'watch',
                    shareId: list.shares[0].id,
                })
            ).ok,
            false,
            'cross-channel denied'
        );
        await evaluate(
            a,
            `document.querySelector('#chatInput').value='Piik unified chat';document.querySelector('#chatForm').requestSubmit()`
        );
        await wait(
            () =>
                evaluate(
                    b,
                    `document.querySelector('#chatMessages').textContent.includes('Piik unified chat')`
                ),
            'existing chat during Piik sharing'
        );
        await delay(2500);
        await click(b, '.workspace-call-tools-toggle');
        assert.equal(await evaluate(b, `document.querySelector('#call-tools').matches(':popover-open')`), true);
        await click(b, '[data-copy-call-diagnostics]');
        assert.equal(await evaluate(b, `document.querySelector('#call-tools').matches(':popover-open')`), false);
        await wait(() => evaluate(b, '!!window.__diagnosticsCopy'), 'paired diagnostic export');
        await wait(() => evaluate(b, `document.querySelector('#callDiagnosticsFeedback').textContent==='诊断已复制'`), 'copy feedback remains visible with the menu closed');
        const diagnostics = (await evaluate(b, 'JSON.parse(window.__diagnosticsCopy)')).本机;
        assert.equal(diagnostics.网页版本, JSON.parse(readFileSync('package.json', 'utf8')).version);
        assert.equal(diagnostics.客户端类型, '浏览器');
        assert.ok(diagnostics.当前状态.共享.some(s => s.连接.some(c =>
            c.统计来源 === 'Piik WebRTC stats' && c.视频流.some(v => v.编码 === `video/${webCodec}` && v.实际帧率 > 0))),
            'real Piik receive statistics reach the original call diagnostic export');
        const first = await evaluate(b, '__mediaStats()');
        assert.ok(
            first.some(
                (r) =>
                    r.kind === 'video' &&
                    r.framesDecoded > 0 &&
                    r.codec === `video/${webCodec}`
            ),
            JSON.stringify({
                first,
                pcs: await evaluate(
                    b,
                    `__pcs.map(pc=>({state:pc.connectionState,receivers:pc.getReceivers().map(r=>r.track.kind)}))`
                ),
                messages: await evaluate(b, '__piikMessages'),
            })
        );
        for (const s of [a, b])
            assert.ok(
                (await evaluate(s, '__mediaStats()')).some(
                    (r) =>
                        r.type === 'inbound-rtp' &&
                        r.kind === 'audio' &&
                        r.bytesReceived > 0
                ),
                JSON.stringify(
                    await evaluate(
                        s,
                        `({pcs:__pcs.map(pc=>({state:pc.connectionState,s:pc.getSenders().map(r=>r.track?.kind),r:pc.getReceivers().map(r=>r.track?.kind)})),buttons:[...document.querySelectorAll('#buttons button')].map(b=>({id:b.id,title:b.title,text:b.textContent}))})`
                    )
                )
            );
        // Piik owns screen video: existing PeerJS metadata identifies connections;
        // their screen video must be absent, avoiding a duplicate browser encoder.
        const senderVideoTracks = await evaluate(
            a,
            `__pcs.filter(pc=>pc.connectionState==='connected').flatMap(pc=>pc.getSenders()).filter(sender=>sender.track?.kind==='video').length`
        );
        assert.equal(
            senderVideoTracks,
            1,
            'one Piik screen sender and no duplicate PeerJS video sender'
        );
        if (webCodec === 'AV1') {
            const compatible = await open();
            await evaluate(compatible, 'window.__omitAv1=true');
            await click(compatible, '#stageJoinVoice');
            await wait(() => receiving(compatible), 'viewer without AV1 can still watch');
            await wait(async () => (await evaluate(compatible, '__mediaStats()')).some(row =>
                row.framesDecoded > 0 && ['video/H264', 'video/VP8'].includes(row.codec)
            ), 'viewer without AV1 decodes a compatible codec');
            assert.ok((await evaluate(b, '__mediaStats()')).some(row => row.framesDecoded > 0 && row.codec === 'video/AV1'));
            await click(compatible, '#destroyPeer');
        }
        await share(b);
        await wait(() => receiving(a), 'second independent publisher');
        assert.equal(
            (await mediaRequest(a, { action: 'list' })).shares.length,
            2
        );
        await click(b, '#shareScreen');
        await wait(
            async () =>
                (await mediaRequest(a, { action: 'list' })).shares.length === 1,
            'stop only own share'
        );
        assert.equal(
            await receiving(b),
            true,
            'stopping publication retains viewing'
        );
        await click(a, '#shareScreen');
        await wait(
            async () =>
                (await mediaRequest(b, { action: 'list' })).shares.length === 0,
            'stop cleanup'
        );
        await click(a, '#shareScreen');
        await evaluate(a, '__holdNextCapture=true');
        await click(a, '[data-screen-share-start]');
        await wait(() => evaluate(a, `!!window.__releaseCapture`), 'pending synthetic picker');
        await click(a, 'dialog [data-share-action="stop"]');
        await evaluate(a, '__releaseCapture()');
        await wait(() => evaluate(a, `__capture.getVideoTracks()[0].readyState==='ended'`), 'late cancelled capture is released');
        assert.equal((await mediaRequest(b, { action: 'list' })).shares.length, 0);
        assert.equal(await evaluate(a, `document.querySelector('#destroyPeer').dataset.sessionAction`), 'hangup', 'pending cancel preserves voice');
        await share(a);
        await wait(() => receiving(b), 'restart sharing');
        const oldId = (await mediaRequest(b, { action: 'list' })).shares[0].id;
        await evaluate(a, `void __socket.io.engine.close()`);
        await wait(async () => {
            const list = await mediaRequest(b, { action: 'list' });
            return list.shares.length === 1 && list.shares[0].id !== oldId;
        }, 'publisher signaling reconnect');
        await wait(() => receiving(b), 'reconnected publication in stage');
        assert.equal(
            await evaluate(a, `__capture.getVideoTracks()[0].readyState`),
            'live',
            'reconnect retains capture'
        );
        await send('Page.reload', {}, b);
        await wait(
            () =>
                evaluate(
                    b,
                    `document.documentElement.dataset.roomBoot==='ready'`
                ),
            'refresh'
        );
        assert.equal(
            (await mediaRequest(b, { action: 'list' })).ok,
            false,
            'refresh removes membership'
        );
        await click(b, '#stageJoinVoice');
        await wait(() => receiving(b), 'rejoin receives existing Piik share');
        await click(a, '#destroyPeer');
        await wait(
            async () =>
                (await mediaRequest(b, { action: 'list' })).shares.length === 0,
            'publisher departure cleanup'
        );
        assert.deepEqual(errors, []);
        const report = {
            status: 'passed',
            browser: (await send('Browser.getVersion')).product,
            source: '9925486cec9910c0a76e47208b29b6f39942e096',
            syntheticMediaOnly: true,
            codec: webCodec,
            codecSample,
            sourceSize: [960, 540],
            targetFps: 30,
            firstReceiveStats: first,
            senderVideoTracks,
            checks: [
                'browser live quality updates sender capture and encoding settings and delivers 720p on the same receiver track',
                'separate screen audio sender accepts the 256 kbps ceiling',
                'source picker cancellation and replacement failure retain live video; success retires old capture without republishing',
                'copy feedback remains visible after the tools menu closes',
                'viewer automatically resumes after its media signaling session closes',
                'viewer automatically recovers an ended video track without leaving voice',
                'pending capture stop discards late stream without leaving voice',
                'original channel and stage',
                'real Piik P2P',
                'no duplicate legacy video sender',
                'bidirectional voice RTP',
                'existing chat',
                'unjoined/cross-channel denied',
                'two simultaneous publishers',
                'stop keeps viewing',
                'restart',
                'publisher signaling reconnect',
                'refresh/rejoin',
                'publisher departure',
            ],
            audioOutputMuted: true,
            physicalDeviceAcceptance: false,
        };
        writeFileSync(
            join(artifacts, measureCodec ? `browser-report-${webCodec.toLowerCase()}.json` : 'browser-report.json'),
            JSON.stringify(report, null, 2)
        );
        console.log(JSON.stringify(report, null, 2));
    }
} catch (error) {
    writeFileSync(
        join(artifacts, 'failure.json'),
        JSON.stringify({ error: String(error), errors, warnings, log }, null, 2)
    );
    throw error;
} finally {
    if (ws?.readyState === WebSocket.OPEN) {
        await send('Browser.close').catch(() => {});
        ws.close();
    }
    browser?.kill();
    app.kill();
    piik.close();
    for (const p of pending.values()) clearTimeout(p.timer);
    await delay(500);
    try {
        rmSync(work, {
            recursive: true,
            force: true,
            maxRetries: 4,
            retryDelay: 200,
        });
    } catch {
        console.warn(`Temporary directory remains: ${work}`);
    }
}
