/* eslint-disable no-console, no-await-in-loop */
// Isolated headless Edge, synthetic motion + fake microphones. No desktop,
// user browser profile, input injection, window focus, or physical devices.
import assert from 'node:assert/strict';
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
const probe = `(() => {
    Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.__diagnosticsCopy=text;}}});
    window.__pcs=[]; const Original=RTCPeerConnection;
    window.RTCPeerConnection=new Proxy(Original,{construct(T,args){const pc=new T(...args);__pcs.push(pc);return pc;}});
    let factory; Object.defineProperty(window,'io',{configurable:true,get(){return factory;},set(value){factory=new Proxy(value,{apply(T,self,args){const socket=Reflect.apply(T,self,args);window.__socket=socket;socket.on('piik:message',({message})=>{(window.__piikMessages??=[]).push({type:message.type,phase:message.phase,revision:message.revision});});return socket;}});}});
    navigator.mediaDevices.getDisplayMedia=async(options)=>{window.__lastCaptureOptions=options;if(window.__cancelNextCapture){window.__cancelNextCapture=false;throw new DOMException('Synthetic picker cancelled','NotAllowedError');}const c=document.createElement('canvas');c.width=1280;c.height=720;const x=c.getContext('2d');let f=0;const t=setInterval(()=>{x.fillStyle='hsl('+(f++%360)+',75%,45%)';x.fillRect(0,0,c.width,c.height);x.fillStyle='white';x.fillRect((f*17)%1200,120,80,440);},16);const s=c.captureStream(30);const track=s.getVideoTracks()[0],stop=track.stop.bind(track),apply=track.applyConstraints.bind(track);track.stop=()=>{clearInterval(t);stop();};track.applyConstraints=async(value)=>{window.__lastCaptureConstraints=value;return apply(value);};window.__capture=s;if(window.__holdNextCapture){window.__holdNextCapture=false;return new Promise(resolve=>{window.__releaseCapture=()=>resolve(s);});}return s;};
    window.__mediaStats=async()=>{const result=[];for(const pc of __pcs){if(pc.connectionState!=='connected')continue;const stats=await pc.getStats();for(const r of stats.values()){if(r.type==='inbound-rtp'||r.type==='outbound-rtp')result.push({type:r.type,kind:r.kind,framesDecoded:r.framesDecoded,framesEncoded:r.framesEncoded,bytesReceived:r.bytesReceived,bytesSent:r.bytesSent,codec:stats.get(r.codecId)?.mimeType});}}return result;};
})()`;
async function open(room = 'lobby') {
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
    await send('Page.addScriptToEvaluateOnNewDocument', { source: probe }, s);
    await send(
        'Page.navigate',
        { url: `http://127.0.0.1:${port}/room/${room}` },
        s
    );
    await wait(
        () =>
            evaluate(s, `document.documentElement.dataset.roomBoot==='ready'`),
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
        `(() => {const select=document.querySelector('[data-screen-share-codec]');select.value='vp8';select.dispatchEvent(new Event('change',{bubbles:true}));})()`
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
try {
    await wait(async () => {
        try {
            return (await fetch(`http://127.0.0.1:${port}/room/lobby`)).ok;
        } catch {
            return false;
        }
    }, 'Node startup');
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
        const report = await runNativePerformance({ open, evaluate, click, wait, port, work });
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
            await click(s, '#toggleAudio');
            await wait(
                () =>
                    evaluate(
                        s,
                        `document.querySelector('#toggleAudio').title.includes('关闭')`
                    ),
                'fake microphone enabled'
            );
        }
        await share(a);
        await wait(() => receiving(b), 'Piik video in original stage');
        await wait(() => evaluate(a, `!document.querySelector('dialog').open`), 'sharing dialog closes on success');
        assert.notEqual(await evaluate(a, '__lastCaptureOptions.audio'), false, 'capture follows the existing checked source-audio preference; test output remains muted');
        const publicationId = (await mediaRequest(b, { action: 'list' })).shares[0].id;
        const originalTrackId = await evaluate(a, '__capture.getVideoTracks()[0].id');
        await click(a, '[data-local-share-controls] [data-share-action="quality"]');
        await evaluate(a, `(()=>{const fps=document.querySelector('[data-screen-share-frame-rate]');fps.value='15';fps.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-screen-share-bitrate]').value='6000000';})()`);
        await click(a, '[data-screen-share-start]');
        await wait(() => evaluate(a, `!document.querySelector('dialog').open`), 'browser live quality ack');
        assert.equal((await mediaRequest(b, { action: 'list' })).shares[0].id, publicationId);
        assert.equal(await evaluate(a, '__capture.getVideoTracks()[0].id'), originalTrackId, 'live quality preserves capture');
        assert.equal(await evaluate(a, `__pcs.flatMap(pc=>pc.getSenders()).some(s=>s.track?.kind==='video' && s.getParameters().encodings.some(e=>e.maxFramerate===15 && e.maxBitrate===6000000))`), true, 'quality is actually applied to sender');
        await click(a, '[data-local-share-controls] [data-share-action="source"]');
        await evaluate(a, '__cancelNextCapture=true');
        await click(a, '[data-screen-share-start]');
        await wait(() => evaluate(a, `!document.querySelector('[data-screen-share-start]').disabled`), 'cancelled picker recovers');
        assert.equal((await mediaRequest(b, { action: 'list' })).shares[0].id, publicationId, 'cancel keeps old publication');
        assert.equal(await evaluate(a, '__capture.getVideoTracks()[0].readyState'), 'live');
        await evaluate(a, 'window.__oldCapture=__capture');
        await evaluate(a, `document.querySelector('[data-screen-share-audio]').checked=false`);
        await click(a, '[data-screen-share-start]');
        await wait(() => evaluate(a, `!document.querySelector('dialog').open`), 'controlled browser source replacement');
        const replaced = await mediaRequest(b, { action: 'list' });
        assert.equal(replaced.shares.length, 1);
        assert.notEqual(replaced.shares[0].id, publicationId);
        assert.equal(await evaluate(a, '__oldCapture.getVideoTracks()[0].readyState'), 'ended');
        assert.equal(await evaluate(a, '__lastCaptureOptions.audio'), false, 'explicit audio opt-out reaches the capture API');
        await wait(() => receiving(b), 'browser receiver after replacement');
        const list = await mediaRequest(b, { action: 'list' });
        assert.equal(list.shares.length, 1);
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
        await click(b, '[data-copy-call-diagnostics]');
        await wait(() => evaluate(b, '!!window.__diagnosticsCopy'), 'paired diagnostic export');
        const diagnostics = (await evaluate(b, 'JSON.parse(window.__diagnosticsCopy)')).本机;
        assert.equal(diagnostics.网页版本, JSON.parse(readFileSync('package.json', 'utf8')).version);
        assert.equal(diagnostics.客户端类型, '浏览器');
        assert.ok(diagnostics.当前状态.共享.some(s => s.连接.some(c =>
            c.统计来源 === 'Piik WebRTC stats' && c.视频流.some(v => v.编码 === 'video/VP8' && v.实际帧率 > 0))),
            'real Piik receive statistics reach the original call diagnostic export');
        const first = await evaluate(b, '__mediaStats()');
        assert.ok(
            first.some(
                (r) =>
                    r.kind === 'video' &&
                    r.framesDecoded > 0 &&
                    r.codec === 'video/VP8'
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
            codec: 'VP8',
            sourceSize: [1280, 720],
            targetFps: 30,
            firstReceiveStats: first,
            senderVideoTracks,
            checks: [
                'browser live quality updates actual sender FPS and bitrate',
                'cancel source picker retains old share; confirmed switch retires old capture',
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
            join(artifacts, 'browser-report.json'),
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
