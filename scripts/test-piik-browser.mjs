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
const probe = `(() => {
    window.__pcs=[]; const Original=RTCPeerConnection;
    window.RTCPeerConnection=new Proxy(Original,{construct(T,args){const pc=new T(...args);__pcs.push(pc);return pc;}});
    let factory; Object.defineProperty(window,'io',{configurable:true,get(){return factory;},set(value){factory=new Proxy(value,{apply(T,self,args){const socket=Reflect.apply(T,self,args);window.__socket=socket;socket.on('piik:message',({message})=>{(window.__piikMessages??=[]).push({type:message.type,phase:message.phase,revision:message.revision});});return socket;}});}});
    navigator.mediaDevices.getDisplayMedia=async()=>{const c=document.createElement('canvas');c.width=1280;c.height=720;const x=c.getContext('2d');let f=0;const t=setInterval(()=>{x.fillStyle='hsl('+(f++%360)+',75%,45%)';x.fillRect(0,0,c.width,c.height);x.fillStyle='white';x.fillRect((f*17)%1200,120,80,440);},16);const s=c.captureStream(30);s.getVideoTracks()[0].addEventListener('ended',()=>clearInterval(t));window.__capture=s;return s;};
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
            '--disable-gpu',
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
    const list = await mediaRequest(b, { action: 'list' });
    assert.equal(list.shares.length, 1);
    assert.equal(
        (await mediaRequest(c, { action: 'watch', shareId: list.shares[0].id }))
            .ok,
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
    assert.equal((await mediaRequest(a, { action: 'list' })).shares.length, 2);
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
            evaluate(b, `document.documentElement.dataset.roomBoot==='ready'`),
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
