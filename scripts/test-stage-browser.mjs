/* eslint-disable no-console, no-await-in-loop */
// Optional local automation using an isolated headless Edge profile, fake
// microphone/camera and synthetic canvas shares. No real screen is captured.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:net';
import WebSocket from 'ws';

const browserPath = process.env.STAGE_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
assert.ok(existsSync(browserPath), 'Set STAGE_TEST_BROWSER to an installed Chromium/Edge executable');
const work = mkdtempSync(join(tmpdir(), 'webrtc-stage-test-'));
const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
const port = reservation.address().port; await new Promise((done) => reservation.close(done));
const useSfu = process.env.STAGE_TEST_SFU === 'true';
const sfuReservation = createServer(); sfuReservation.listen(0, '127.0.0.1'); await once(sfuReservation, 'listening');
const sfuPort = sfuReservation.address().port; await new Promise((done) => sfuReservation.close(done));
const app = spawn(process.execPath, [resolve('src/server.js')], { cwd: work, windowsHide: true,
    env: { ...process.env, PORT: String(port), USE_HTTPS: 'false', SFU_ENABLED: String(useSfu), SFU_ANNOUNCED_ADDRESS:'127.0.0.1', SFU_LISTEN_IP:'127.0.0.1', SFU_PORT:String(sfuPort), ENV: 'production', CHAT_HISTORY_FILE: join(work, 'history.json') }, stdio: 'pipe' });
let appLog = ''; app.stdout.on('data', (value) => { appLog += value; }); app.stderr.on('data', (value) => { appLog += value; });
let browser; let ws; let counter = 0;
const pending = new Map(); const errors = []; const requests = []; const warnings = [];
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const wait = async (check, label, timeout = 15000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (await check()) return; await delay(100); }
    throw new Error(`Timeout: ${label}\n${JSON.stringify(errors)}\n${appLog.slice(-1500)}`);
};
const send = (method, params = {}, sessionId) => new Promise((done, reject) => {
    const id = ++counter;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout ${method}`)); }, 15000);
    pending.set(id, { done, reject, timer }); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
const evaluate = async (sessionId, expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
};
const probe = `(() => {
    window.__stageProbe = { offers: 0, replaceTracks: 0, captures: 0, shares: [] };
    const offer = RTCPeerConnection.prototype.createOffer;
    RTCPeerConnection.prototype.createOffer = function(...args) { window.__stageProbe.offers++; return offer.apply(this, args); };
    const replace = RTCRtpSender.prototype.replaceTrack;
    RTCRtpSender.prototype.replaceTrack = function(...args) { window.__stageProbe.replaceTracks++; return replace.apply(this, args); };
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (...args) => { window.__stageProbe.captures++; return capture(...args); };
    navigator.mediaDevices.getDisplayMedia = async () => {
        const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
        const ctx = canvas.getContext('2d');
        const draw = () => { ctx.fillStyle = '#39465c'; ctx.fillRect(0,0,1280,720); ctx.fillStyle = 'white'; ctx.font = '40px sans-serif'; ctx.fillText('Synthetic stage regression ' + Date.now(), 80, 200); };
        draw(); const timer = setInterval(draw, 100); const stream = canvas.captureStream(10);
        stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer));
        window.__stageProbe.shares.push(stream); return stream;
    };
    localStorage.setItem('voicePageLayout:v4:lobby', JSON.stringify({ items: [{ id: 'page-chatPanel', visible: false, grid: {x:999,y:999,w:0,h:0} }] }));
})();`;
const open = async () => {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sessionId); await send('Runtime.enable', {}, sessionId); await send('Network.enable', {}, sessionId);
    await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }, sessionId);
    await send('Page.addScriptToEvaluateOnNewDocument', { source: probe }, sessionId);
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/room/lobby` }, sessionId);
    await wait(() => evaluate(sessionId, `document.documentElement?.dataset.roomBoot === 'ready'`), 'room entry point');
    return sessionId;
};
const click = (session, selector) => evaluate(session, `document.querySelector(${JSON.stringify(selector)}).click()`);
const share = async (session) => {
    await click(session, '#shareScreen');
    await evaluate(session, `(() => { const select = document.querySelector('[data-screen-share-codec]'); select.value = 'vp8'; select.dispatchEvent(new Event('change', {bubbles:true})); })()`);
    await click(session, '[data-screen-share-start]');
    await wait(() => evaluate(session, `document.querySelector('#main').dataset.stageMode === 'sharing' && document.querySelector('#local-video video')?.srcObject?.getVideoTracks().length > 0`), 'synthetic screen share');
};
const geometry = (session) => evaluate(session, `(() => {
    const rect = (selector) => { const node = document.querySelector(selector); const r = node.getBoundingClientRect(); const css = getComputedStyle(node); return {x:r.x,y:r.y,w:r.width,h:r.height,display:css.display,cols:css.gridTemplateColumns}; };
    const result = { viewport:[innerWidth,innerHeight,devicePixelRatio], overflow:document.documentElement.scrollWidth > innerWidth, mode:document.querySelector('#main').dataset.stageMode,
        stage:rect('.room-stage'), members:rect('.stage-members'), chat:rect('#chat-panel'), dock:rect('.stage-dock'), nav:rect('.room-sidebar'), main:rect('#main'),
        cards:[...document.querySelectorAll('#member-cards > *')].map((n) => { const r=n.getBoundingClientRect(); return {w:r.width,h:r.height}; }) };
    const focus = document.querySelector('#video-grid > .is-stage-focus video'); if (focus) result.fit = getComputedStyle(focus).objectFit;
    return result;
})()`);

try {
    await wait(async () => { try { return (await fetch(`http://127.0.0.1:${port}/room/lobby`)).ok; } catch { return false; } }, 'isolated local server');
    browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${join(work, 'profile')}`,
        '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let browserLog = ''; browser.stderr.on('data', (value) => { browserLog += value; });
    const activePortFile = join(work, 'profile', 'DevToolsActivePort');
    await wait(() => existsSync(activePortFile) || /DevTools listening on (ws:\/\/\S+)/.test(browserLog), 'headless browser');
    const activePort = existsSync(activePortFile) ? readFileSync(activePortFile, 'utf8').trim().split(/\r?\n/) : null;
    const endpoint = activePort ? `ws://127.0.0.1:${activePort[0]}${activePort[1]}` : browserLog.match(/DevTools listening on (ws:\/\/\S+)/)[1];
    ws = new WebSocket(endpoint); await once(ws, 'open');
    ws.on('message', (value) => {
        const message = JSON.parse(value);
        if (message.id) {
            const item = pending.get(message.id); if (!item) return;
            clearTimeout(item.timer); pending.delete(message.id);
            if (message.error) item.reject(new Error(JSON.stringify(message.error))); else item.done(message.result);
        } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
        else if (message.method === 'Runtime.consoleAPICalled' && ['warning','error'].includes(message.params.type)) warnings.push(message.params.args.map(arg=>arg.value ?? arg.description).join(' '));
        else if (message.method === 'Network.responseReceived' && message.params.response.status >= 400 &&
            !message.params.response.url.endsWith('/favicon.ico')) requests.push(message.params.response.url);
    });
    const a = await open();
    assert.equal((await geometry(a)).stage.display, 'none');
    await click(a, '#destroyPeer');
    await wait(() => evaluate(a, `document.querySelector('#destroyPeer').dataset.sessionAction === 'hangup' && Boolean(document.querySelector('#local-video'))`), 'first voice join');
    await click(a, '#toggleVideo');
    await wait(() => evaluate(a, `document.querySelector('#member-cards #local-video video')?.videoWidth > 0`), 'fake camera in member card');
    const b = await open(); await click(b, '#destroyPeer');
    await wait(() => evaluate(a, `document.querySelectorAll('#member-cards > *').length === 2`), 'second participant');
    await wait(() => evaluate(b, `document.querySelector('#destroyPeer').dataset.sessionAction === 'hangup'`), 'second voice join');
    await share(a);
    await wait(() => evaluate(b, `document.querySelector('#main').dataset.stageMode === 'sharing' && document.querySelector('#video-grid > .is-stage-focus video')?.videoWidth > 0`), 'remote screen reception');
    await delay(1800); // Let initial microphone/camera/share negotiations settle.
    const viewports = [[3840,2160,1], [2560,1440,1], [1920,1080,1], [1600,900,1], [1366,768,1], [2560,1440,1.5], [900,700,1], [640,700,1], [390,844,3], [320,640,2], [844,390,2]];
    const layouts = [];
    const counters = await evaluate(b, `({offers:__stageProbe.offers,replaceTracks:__stageProbe.replaceTracks,captures:__stageProbe.captures})`);
    // Save real DOM identities; resize/chat/focus must leave players attached.
    await evaluate(b, `window.__originalPlayers = [...document.querySelectorAll('.video-tile video, .video-tile audio')].map(node=>({node,stream:node.srcObject})); document.querySelector('#chatInput').value='preserved draft';`);
    for (const [width,height,dpr] of viewports) {
        await send('Emulation.setDeviceMetricsOverride', { width,height,deviceScaleFactor:dpr,mobile:false }, b);
        await delay(120);
        if (width <= 640) {
            const expanded = await evaluate(b, `document.querySelector('#stageChatToggle').getAttribute('aria-expanded')`);
            if (expanded === 'true') await click(b, '#stageChatToggle');
        }
        const result = await geometry(b);
        assert.equal(result.overflow, false, `horizontal overflow ${width}x${height}`);
        assert.ok(result.stage.w > 0 && result.stage.h > 0, `visible stage ${width}`);
        assert.ok(result.dock.y + result.dock.h <= height + 1, `dock within viewport ${width}x${height}`);
        assert.ok(result.stage.y + result.stage.h <= result.members.y + 1, 'stage above member strip');
        assert.ok(result.members.y + result.members.h <= result.dock.y + 1, 'member strip above dock');
        assert.equal(result.fit, 'contain');
        assert.ok(result.cards.every((card) => card.w <= 320 && card.h <= 210), 'bounded member cards');
        layouts.push(result);
        await click(b, '#stageChatToggle'); await click(b, '#stageChatToggle');
        assert.equal(await evaluate(b, `document.querySelector('#chatInput').value`), 'preserved draft');
    }
    const playerChanges = await evaluate(b, `__originalPlayers.filter(({node,stream})=>!node.isConnected || node.srcObject!==stream).map(({node,stream})=>({tag:node.tagName,id:node.closest('.video-tile')?.id,connected:node.isConnected,oldTracks:stream?.getTracks().map(t=>t.kind+':'+t.id),newTracks:node.srcObject?.getTracks().map(t=>t.kind+':'+t.id)}))`);
    assert.deepEqual(playerChanges, [], 'layout preserves players and stream identity');
    assert.deepEqual(await evaluate(b, `({offers:__stageProbe.offers,replaceTracks:__stageProbe.replaceTracks,captures:__stageProbe.captures})`), counters, 'layout must not negotiate or capture');
    const routeSession = b; // The first publisher has SFU admission; the second may legitimately use P2P.
    const routeTile = await evaluate(routeSession, `document.querySelector('#video-grid > .is-stage-focus').id`);
    if (routeTile !== 'local-video') {
        await wait(() => evaluate(routeSession, `Boolean(document.getElementById('${routeTile}').querySelector('.voice-route-toggle'))`), 'remote route control');
        await click(routeSession, `[id="${routeTile}"] .voice-route-toggle`);
        assert.equal(await evaluate(routeSession, `document.querySelector('[id="${routeTile}"] .voice-route-auto input').checked`), true);
        if (useSfu) await wait(() => evaluate(routeSession, `document.querySelector('[id="${routeTile}"] .voice-route-toggle').title.includes('服务器转发')`), 'automatic SFU route');
        await click(routeSession, `[id="${routeTile}"] .voice-route-auto input`);
        await wait(() => evaluate(routeSession, `!document.querySelector('[id="${routeTile}"] .voice-route-choices button').disabled`), 'manual P2P entry');
        await click(routeSession, `[id="${routeTile}"] .voice-route-choices button`);
        await wait(() => evaluate(routeSession, `document.querySelector('[id="${routeTile}"] .voice-route-toggle').title.includes('P2P') && !document.querySelector('[id="${routeTile}"] .voice-route-auto input').disabled`), 'manual P2P route');
        if (useSfu) {
            await click(routeSession, `[id="${routeTile}"] .voice-route-choices button:nth-child(2)`);
            try {
                await wait(() => evaluate(routeSession, `document.querySelector('[id="${routeTile}"] .voice-route-toggle').title.includes('服务器转发') && !document.querySelector('[id="${routeTile}"] .voice-route-auto input').disabled`), 'manual SFU route');
            } catch (error) {
                console.error(await evaluate(routeSession, `({status:document.querySelector('[id="${routeTile}"] .voice-route-status').textContent,choices:[...document.querySelectorAll('[id="${routeTile}"] .voice-route-choices button')].map(b=>({text:b.textContent,disabled:b.disabled}))})`));
                console.error(readFileSync(join(work,'logs','node.log'),'utf8').split('\n').filter(line=>line.includes('[sfu]')).slice(-10).join('\n'));
                console.error(warnings.slice(-12));
                throw error;
            }
        }
        await click(routeSession, `[id="${routeTile}"] .voice-route-close`);
        await click(routeSession, '#stageChatToggle'); await click(routeSession, '#stageChatToggle');
        await click(routeSession, `[id="${routeTile}"] .voice-route-toggle`);
        assert.equal(await evaluate(routeSession, `document.querySelector('[id="${routeTile}"] .voice-route-auto input').checked`), false);
        await click(routeSession, `[id="${routeTile}"] .voice-route-close`);
    }
    await send('Emulation.setDeviceMetricsOverride', { width:1920,height:1080,deviceScaleFactor:1,mobile:false }, b);
    await share(b);
    await wait(() => evaluate(a, `document.querySelectorAll('#share-sources button').length === 2`), 'two simultaneous shares');
    await evaluate(a, `document.querySelectorAll('#share-sources button')[1].click(); window.__selectedSource = document.querySelector('#video-grid > .is-stage-focus').id;`);
    await click(a, '#stageChatToggle'); await click(a, '#stageChatToggle');
    assert.equal(await evaluate(a, `document.querySelector('#video-grid > .is-stage-focus').id === __selectedSource`), true);
    await click(a, '.local-screen-preview-toggle');
    assert.equal(await evaluate(a, `__stageProbe.shares[0].getVideoTracks()[0].readyState`), 'live');
    assert.equal(await evaluate(b, `document.querySelectorAll('#share-sources button').length`), 2);
    await click(a, '.local-screen-preview-toggle');
    await click(b, '#shareScreen');
    await wait(() => evaluate(a, `document.querySelectorAll('#share-sources button').length === 1`), 'focus fallback to remaining share');
    await click(a, '#shareScreen');
    await wait(() => evaluate(b, `document.querySelector('#main').dataset.stageMode === 'voice'`), 'last share end');
    const voiceLayouts = [];
    for (const [width,height,dpr] of viewports) {
        await send('Emulation.setDeviceMetricsOverride', { width,height,deviceScaleFactor:dpr,mobile:false }, a);
        const expanded = await evaluate(a, `document.querySelector('#stageChatToggle').getAttribute('aria-expanded')`);
        if ((width > 640) !== (expanded === 'true')) await click(a, '#stageChatToggle');
        await delay(60);
        const result = await geometry(a);
        assert.equal(result.overflow, false, `voice horizontal overflow ${width}`);
        assert.equal(result.stage.display, 'none', 'no empty black stage in voice mode');
        assert.ok(result.members.h > 0 && result.members.w > 0, `voice members ${width}`);
        assert.ok(result.cards.every((card) => card.w <= 320 && card.h <= 210));
        if (width > 640) assert.ok(result.chat.w > 0 && result.chat.h > 0);
        assert.ok(result.dock.y + result.dock.h <= height + 1);
        voiceLayouts.push(result);
    }
    await click(b, '#destroyPeer');
    await wait(() => evaluate(a, `document.querySelectorAll('#member-cards > *').length === 1`), 'member departure');
    assert.deepEqual(errors, [], 'no unhandled browser runtime errors');
    assert.deepEqual(requests, [], 'no failed runtime resources');
    console.log(JSON.stringify({ status:'passed', browser: (await send('Browser.getVersion')).product, syntheticMediaOnly:true, serverForwardingEnabled:useSfu,
        viewportCases: layouts.length + voiceLayouts.length, cssViewports:layouts.map((row)=>row.viewport),
        routeChecks:useSfu ? ['automatic SFU','manual P2P','manual SFU','per-sharer preference retention'] : ['P2P','manual P2P','per-sharer preference retention'],
        tests:['entry point','voice join','camera','two voice peers','synthetic share','responsive geometry in both modes','chat draft','no layout renegotiation/capture','two shares','focus retention/fallback','manual route retention','preview hide retains capture','last share end','member departure'],
        runtimeErrors:errors.length, failedResources:requests.length }, null, 2));
} finally {
    if (ws?.readyState === WebSocket.OPEN) { await send('Browser.close').catch(() => {}); ws.close(); }
    browser?.kill(); app.kill();
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('test finished')); }
    // Only the explicitly created temporary profile/history/log directory.
    await delay(500);
    try { rmSync(work, { recursive:true, force:true, maxRetries:5, retryDelay:200 }); } catch { console.warn(`Temporary profile remains at ${work}`); }
}
