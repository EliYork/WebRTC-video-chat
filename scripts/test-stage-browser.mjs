/* eslint-disable no-console, no-await-in-loop */
// Optional local automation using an isolated headless Edge profile, fake
// microphone/camera and synthetic canvas shares. No real screen is captured.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:net';
import WebSocket from 'ws';

const browserPath = process.env.STAGE_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
assert.ok(existsSync(browserPath), 'Set STAGE_TEST_BROWSER to an installed Chromium/Edge executable');
const work = mkdtempSync(join(tmpdir(), 'webrtc-stage-test-'));
const artifacts = process.env.STAGE_TEST_ARTIFACTS;
if (artifacts) mkdirSync(artifacts, { recursive: true });
const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
const port = reservation.address().port; await new Promise((done) => reservation.close(done));
const useSfu = process.env.STAGE_TEST_SFU === 'true';
const sfuReservation = createServer(); sfuReservation.listen(0, '127.0.0.1'); await once(sfuReservation, 'listening');
const sfuPort = sfuReservation.address().port; await new Promise((done) => sfuReservation.close(done));
const app = spawn(process.execPath, [resolve('src/server.js')], { cwd: work, windowsHide: true,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), USE_HTTPS: 'false', SCREEN_MEDIA_PROVIDER: 'legacy', SFU_ENABLED: String(useSfu), SFU_ANNOUNCED_ADDRESS:'127.0.0.1', SFU_LISTEN_IP:'127.0.0.1', SFU_PORT:String(sfuPort), ENV: 'production', CHAT_HISTORY_FILE: join(work, 'history.json') }, stdio: 'pipe' });
let appLog = ''; app.stdout.on('data', (value) => { appLog += value; }); app.stderr.on('data', (value) => { appLog += value; });
let browser; let ws; let counter = 0;
const pending = new Map(); const errors = []; const requests = []; const warnings = [];
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const compactViewport = (width, height) => width <= 640 || (width <= 1000 && height <= 550);
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
    Object.defineProperty(navigator, 'clipboard', { configurable:true, value:{writeText:async(text)=>{window.__copiedDiagnostics=JSON.parse(text);}} });
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
const open = async ({ width = 1920, height = 1080, mobile = false } = {}) => {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sessionId); await send('Runtime.enable', {}, sessionId); await send('Network.enable', {}, sessionId);
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, sessionId);
    await send('Emulation.setTouchEmulationEnabled', { enabled: mobile }, sessionId);
    await send('Page.addScriptToEvaluateOnNewDocument', { source: probe }, sessionId);
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/room/lobby` }, sessionId);
    await wait(() => evaluate(sessionId, `document.documentElement?.dataset.roomBoot === 'ready'`), 'room entry point');
    return sessionId;
};
const click = (session, selector) => evaluate(session, `document.querySelector(${JSON.stringify(selector)}).click()`);
const viewportReady = async (session, width, height) => {
    // Headless media/dialog activity can change tab visibility. Keep this
    // isolated document active during viewport inspection so Chromium delivers
    // real resize/media-query events; never synthesize those events in the app.
    await send('Emulation.setFocusEmulationEnabled', { enabled:true }, session);
    await send('Page.bringToFront', {}, session);
    await wait(() => evaluate(session, `!document.hidden && document.querySelector('#main').dataset.viewportMode === '${compactViewport(width,height) ? 'compact' : 'wide'}'`), `viewport navigation reconciled ${width}x${height}`);
};
const tap = async (session, selector) => {
    let point;
    await wait(async () => {
        point = await evaluate(session, `(() => { const n=document.querySelector(${JSON.stringify(selector)}); if (!n) return {hit:false}; const r=n.getBoundingClientRect(), x=r.x+r.width/2, y=r.y+r.height/2; return {x,y,hit:r.width>0 && r.height>0 && n.contains(document.elementFromPoint(x,y))}; })()`);
        return point.hit;
    }, `touch target is visible and unobstructed: ${selector}`);
    await send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{ x:point.x,y:point.y }] }, session);
    await send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] }, session);
};
const screenshot = async (session, name) => {
    if (!artifacts) return;
    const { data } = await send('Page.captureScreenshot', { format: 'png' }, session);
    writeFileSync(join(artifacts, `${name}.png`), Buffer.from(data, 'base64'));
};
const share = async (session) => {
    await click(session, '#shareScreen');
    await evaluate(session, `(() => { const select = document.querySelector('[data-screen-share-codec]'); select.value = 'vp8'; select.dispatchEvent(new Event('change', {bubbles:true})); })()`);
    await click(session, '[data-screen-share-start]');
    await wait(() => evaluate(session, `document.querySelector('#main').dataset.stageMode === 'sharing' && document.querySelector('#local-video video')?.srcObject?.getVideoTracks().length > 0`), 'synthetic screen share');
};
const geometry = (session) => evaluate(session, `(() => {
    const rect = (selector) => { const node = document.querySelector(selector); const r = node.getBoundingClientRect(); const css = getComputedStyle(node); return {x:r.x,y:r.y,w:r.width,h:r.height,display:css.display,cols:css.gridTemplateColumns}; };
    const result = { viewport:[innerWidth,innerHeight,devicePixelRatio], overflow:document.documentElement.scrollWidth > innerWidth, mode:document.querySelector('#main').dataset.stageMode,
        stage:rect('.room-stage'), members:rect('.stage-members'), chat:rect('#chat-panel'), dock:rect('.stage-dock'), sidebar:rect('.stage-sidebar-column'), nav:rect('.room-sidebar'), main:rect('#main'),
        dockCount:document.querySelectorAll('#buttons').length, sidebarBrand:document.querySelector('.server-navigation')!==null,
        cards:[...document.querySelectorAll('#member-cards > *')].map((n) => { const r=n.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; }),
        icons:[...document.querySelectorAll('.stage-dock svg, .stage-dock button > i')].filter(n=>n.getBoundingClientRect().width>0).map(n=>{const r=n.getBoundingClientRect(),b=n.closest('button').getBoundingClientRect();return {w:r.width,h:r.height,inside:r.x>=b.x && r.y>=b.y && r.right<=b.right+.5 && r.bottom<=b.bottom+.5};}),
        controls:[...document.querySelectorAll('.media-dock-actions button, #destroyPeer, #copyRoomLink')].map(n=>{const r=n.getBoundingClientRect();return {w:r.width,h:r.height,x:r.x,right:r.right};}),
        cardActions:[...document.querySelectorAll('#member-cards .tile-header button')].filter(n=>n.getBoundingClientRect().width>0).map(n=>{const r=n.getBoundingClientRect(),c=n.closest('.member-card').getBoundingClientRect();return r.left>=c.left && r.right<=c.right+.5 && r.top>=c.top && r.bottom<=c.bottom+.5;}) };
    const focus = document.querySelector('#video-grid > .is-stage-focus video'); if (focus) result.fit = getComputedStyle(focus).objectFit;
    return result;
})()`);
const checkDock = (result) => {
    const [width,height] = result.viewport;
    assert.ok(result.dock.y + result.dock.h <= height + 1, `dock within viewport ${width}x${height}`);
    assert.equal(result.dockCount, 1, 'only the real Dock');
    assert.equal(result.sidebarBrand, false, 'sidebar starts with channels, not a second brand');
    const compact = compactViewport(width, height);
    if (!compact) {
        assert.ok(result.dock.w <= 320 && result.dock.x === result.sidebar.x, 'Dock parent bounded to the left column');
        assert.ok(Math.abs(result.sidebar.y + result.sidebar.h - height) <= 1, 'left column reaches bottom');
        assert.ok(result.nav.y + result.nav.h <= result.dock.y + 1, 'channel list never overlaps Dock');
        assert.ok(result.members.x >= result.dock.x + result.dock.w, 'Dock never overlaps central stage');
        if(result.chat.display !== 'none') assert.ok(result.chat.y + result.chat.h >= height - 1, 'no footer row below right chat');
        if(result.mode === 'voice') assert.ok(result.members.y + result.members.h >= height - 1, 'no footer row below voice stage');
    } else {
        assert.ok(result.dock.x >= 8 && result.dock.x + result.dock.w <= width - 8, 'mobile Dock is inset, without a full-width footer');
        assert.ok(result.dock.h <= 132, 'mobile Dock leaves room for the main view');
    }
    assert.ok(result.icons.length >= 4 && result.icons.every(i=>i.w<=24 && i.h<=24 && i.inside), `bounded icons ${width}x${height}: ${JSON.stringify(result.icons)}`);
    assert.ok(result.controls.every(b=>(compact ? b.h>=40 && b.h<=48 : b.h===44) && b.x>=0 && b.right<=width+1), `aligned controls ${width}: ${JSON.stringify(result.controls)}`);
    assert.ok(result.cardActions.every(Boolean), `member actions contained ${width}x${height}`);
};

try {
    await wait(async () => { try { return (await fetch(`http://127.0.0.1:${port}/room/lobby`)).ok; } catch { return false; } }, 'isolated local server');
    browser = spawn(browserPath, ['--headless=new', '--mute-audio', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${join(work, 'profile')}`,
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
    const a = await open({ width:390, height:844, mobile:true });
    assert.equal((await geometry(a)).stage.display, 'none');
    await wait(() => evaluate(a, `document.querySelector('#main').dataset.channelOccupancy === 'empty'`), 'empty channel guide');
    assert.equal(await evaluate(a, `document.querySelector('#members-empty').hidden`), false);
    assert.equal(await evaluate(a, `document.querySelector('#main').dataset.mobilePanel`), 'stage', 'mobile never starts behind the chat panel');
    await screenshot(a, 'mobile-idle');
    await tap(a, '#stageChannelsToggle');
    assert.equal(await evaluate(a, `getComputedStyle(document.querySelector('#stage-channels')).display !== 'none' && document.querySelector('#chat-panel').inert`), true);
    await screenshot(a, 'mobile-channels');
    await tap(a, '#stageChatToggle');
    assert.equal(await evaluate(a, `getComputedStyle(document.querySelector('.stage-members')).display === 'none' && !document.querySelector('#chat-panel').inert`), true, 'chat is an explicit view, not an overlay on the stage');
    await evaluate(a, `document.querySelector('#chatInput').value='mobile unsent draft';`);
    await tap(a, '#stageStageToggle');
    await tap(a, '#stageMoreToggle');
    assert.equal(await evaluate(a, `document.querySelector('#workspace-tools').inert`), false);
    await tap(a, '#stageStageToggle');
    assert.equal(await evaluate(a, `document.querySelector('#workspace-tools').inert`), true, 'tap outside dismisses secondary operations');
    assert.equal(await evaluate(a, `document.querySelector('#chatInput').value`), 'mobile unsent draft');
    await send('Emulation.setDeviceMetricsOverride', { width:1920,height:1080,deviceScaleFactor:1,mobile:false }, a);
    await send('Emulation.setTouchEmulationEnabled', { enabled:false }, a);
    await delay(100);
    await screenshot(a, 'not-joined');
    await click(a, '#stageJoinVoice');
    await wait(() => evaluate(a, `document.querySelector('#destroyPeer').dataset.sessionAction === 'hangup' && Boolean(document.querySelector('#local-video'))`), 'first voice join');
    await click(a, '#toggleAudio');
    await wait(() => evaluate(a, `document.querySelector('#toggleAudio').getAttribute('aria-pressed') === 'true'`), 'synthetic microphone enabled');
    await click(a, '#toggleVideo');
    await wait(() => evaluate(a, `document.querySelector('#member-cards #local-video video')?.videoWidth > 0`), 'fake camera in member card');
    const b = await open();
    await wait(() => evaluate(b, `document.querySelector('#main').dataset.channelOccupancy === 'occupied' && document.querySelector('#stageWelcomeTitle').textContent.includes('1 位')`), 'occupied channel guide');
    await click(b, '#stageJoinVoice');
    await wait(() => evaluate(a, `document.querySelectorAll('#member-cards > *').length === 2`), 'second participant');
    await wait(() => evaluate(b, `document.querySelector('#destroyPeer').dataset.sessionAction === 'hangup'`), 'second voice join');
    await wait(() => evaluate(b, `document.querySelector('#member-cards > :not(#local-video) video')?.videoWidth > 0 && document.querySelector('#member-cards > :not(#local-video) video').srcObject.getAudioTracks().length === 1`), 'remote camera and voice reception');
    await evaluate(b, `window.__cameraTile = document.querySelector('#member-cards > :not(#local-video)'); window.__cameraPlayer = __cameraTile.querySelector('video'); window.__cameraMic = __cameraPlayer.srcObject.getAudioTracks()[0];`);
    // Exercise the compact mobile sender UI; no physical device or camera is used.
    await send('Emulation.setDeviceMetricsOverride', { width:390,height:844,deviceScaleFactor:3,mobile:true }, a);
    await click(a, '#toggleVideo');
    await wait(() => evaluate(b, `__cameraTile.classList.contains('is-audio-only') && !__cameraTile.querySelector('video') && Boolean(__cameraTile.querySelector('.voice-placeholder'))`), 'camera off clears remote last frame');
    assert.equal(await evaluate(b, `__cameraPlayer.srcObject === null`), true, 'old video player is detached and cleared');
    assert.equal(await evaluate(b, `__cameraTile.querySelector('audio').srcObject.getAudioTracks()[0] === __cameraMic && __cameraMic.readyState === 'live'`), true, 'camera off preserves the exact live voice track');
    await click(a, '#toggleVideo');
    await wait(() => evaluate(b, `__cameraTile.querySelector('video')?.videoWidth > 0 && __cameraTile.classList.contains('has-video')`), 'camera reopens on the same member card');
    await evaluate(b, `window.__cameraFrames = 0; const player = __cameraTile.querySelector('video'); const frame = () => { if (++__cameraFrames < 3) player.requestVideoFrameCallback(frame); }; player.requestVideoFrameCallback(frame);`);
    await wait(() => evaluate(b, `__cameraFrames >= 3`), 'reopened camera produces new frames');
    assert.equal(await evaluate(b, `__cameraTile.querySelector('video').srcObject.getAudioTracks()[0] === __cameraMic && __cameraMic.readyState === 'live'`), true, 'camera reopen preserves voice');
    await evaluate(a, `document.querySelector('#chatInput').value='camera lifecycle regression'; document.querySelector('#chatForm').requestSubmit();`);
    await wait(() => evaluate(b, `document.querySelector('#chatMessages').textContent.includes('camera lifecycle regression')`), 'chat after camera restart');
    await send('Emulation.setDeviceMetricsOverride', { width:1920,height:1080,deviceScaleFactor:1,mobile:false }, a);
    await screenshot(a, 'voice-two-members');
    await share(a);
    await wait(() => evaluate(b, `document.querySelector('#main').dataset.stageMode === 'sharing' && document.querySelector('#video-grid > .is-stage-focus video')?.videoWidth === 1280`), 'remote synthetic screen reception, not the preceding camera frame');
    await evaluate(b, `window.__screenPlayer = document.querySelector('#video-grid > .is-stage-focus video'); window.__screenTrack = __screenPlayer.srcObject.getVideoTracks()[0];`);
    await click(a, '#toggleVideo');
    await wait(() => evaluate(a, `document.querySelector('#toggleVideo').getAttribute('aria-pressed') === 'false'`), 'camera off during screen share');
    await delay(250);
    assert.equal(await evaluate(b, `document.querySelector('#video-grid > .is-stage-focus video').srcObject.getVideoTracks()[0] === __screenTrack && __screenTrack.readyState === 'live'`), true, 'camera off must not hide or stop the active screen share');
    await delay(1800); // Let initial microphone/camera/share negotiations settle.
    const viewports = [[3840,2160,1], [2560,1440,1], [1920,1080,1], [1600,900,1], [1366,768,1], [2560,1440,1.5], [900,700,1], [800,600,1.5], [640,700,1], [390,844,3], [320,640,2], [844,390,2]];
    await evaluate(a, `window.__realDock=document.querySelector('#buttons');window.__realShareDialog=document.querySelector('[data-device-popover="screen"]');`);
    await send('Page.bringToFront', {}, a);
    for (const [width,height,dpr] of viewports) {
        await send('Emulation.setDeviceMetricsOverride', { width,height,deviceScaleFactor:dpr,mobile:false }, a);
        await viewportReady(a,width,height);
        await click(a, '[data-local-share-controls] [data-share-action="quality"]');
        const dialog = await evaluate(a, `(()=>{const d=document.querySelector('[data-device-popover="screen"]'), r=d.getBoundingClientRect(), f=d.querySelector('footer').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,bottom:r.bottom,footerBottom:f.bottom,sameDock:__realDock===document.querySelector('#buttons'),sameDialog:__realShareDialog===d};})()`);
        assert.ok(Math.abs(dialog.x + dialog.w/2-width/2)<2 && Math.abs(dialog.y + dialog.h/2-height/2)<2, `centered dialog ${width}x${height}: ${JSON.stringify(dialog)}`);
        assert.ok(dialog.y>=0 && dialog.bottom<=height && dialog.footerBottom<=height, 'dialog footer stays usable');
        assert.ok(dialog.sameDock && dialog.sameDialog, 'one real Dock and dialog across layouts');
        if (width === 1920) await screenshot(a, 'sharing-quality-dialog');
        await click(a, '[data-screen-share-cancel]');
    }
    await send('Emulation.setDeviceMetricsOverride', { width:1920,height:1080,deviceScaleFactor:1,mobile:false }, a);
    await screenshot(a, 'sharing-local-controls');
    const layouts = [];
    const counters = await evaluate(b, `({offers:__stageProbe.offers,replaceTracks:__stageProbe.replaceTracks,captures:__stageProbe.captures})`);
    await send('Page.bringToFront', {}, b);
    // Save real DOM identities; resize/chat/focus must leave players attached.
    await evaluate(b, `window.__originalPlayers = [...document.querySelectorAll('.video-tile video, .video-tile audio')].map(node=>({node,stream:node.srcObject})); document.querySelector('#chatInput').value='preserved draft';`);
    for (const [width,height,dpr] of viewports) {
        await send('Emulation.setDeviceMetricsOverride', { width,height,deviceScaleFactor:dpr,mobile:false }, b);
        await viewportReady(b,width,height);
        await delay(120);
        const expanded = await evaluate(b, `document.querySelector('#stageChatToggle').getAttribute('aria-expanded')`);
        if ((!compactViewport(width,height)) !== (expanded === 'true')) await click(b, '#stageChatToggle');
        const result = await geometry(b);
        assert.equal(result.overflow, false, `horizontal overflow ${width}x${height}`);
        assert.ok(result.stage.w > 0 && result.stage.h > 0, `visible stage ${width}`);
        checkDock(result);
        if (width <= 1000 && width > 640 && height <= 550) assert.ok(result.stage.x + result.stage.w <= result.members.x + 1, 'landscape stage beside members');
        else assert.ok(result.stage.y + result.stage.h <= result.members.y + 1, 'stage above member strip');
        if (!compactViewport(width,height)) {
            assert.ok(result.dock.w <= 320 && result.dock.x < result.stage.x, 'real dock remains in left column');
            assert.ok(result.chat.y + result.chat.h >= height - 1, 'chat uses released bottom space');
        } else assert.ok(result.members.y + result.members.h <= result.dock.y + 1, 'compact viewport member strip above dock');
        assert.equal(result.fit, 'contain');
        assert.ok(result.cards.every((card) => card.w <= 320 && card.h <= 210), 'bounded member cards');
        layouts.push(result);
        if (width===1920 || width===390) await screenshot(b, `sharing-${width}`);
        await click(b, '#stageChatToggle');
        if (!compactViewport(width,height)) assert.ok((await geometry(b)).stage.w>result.stage.w,`closing chat expands sharing stage ${width}`);
        await click(b, '#stageChatToggle');
        assert.equal(await evaluate(b, `document.querySelector('#chatInput').value`), 'preserved draft');
    }
    const playerChanges = await evaluate(b, `__originalPlayers.filter(({node,stream})=>!node.isConnected || node.srcObject!==stream).map(({node,stream})=>({tag:node.tagName,id:node.closest('.video-tile')?.id,connected:node.isConnected,oldTracks:stream?.getTracks().map(t=>t.kind+':'+t.id),newTracks:node.srcObject?.getTracks().map(t=>t.kind+':'+t.id)}))`);
    assert.deepEqual(playerChanges, [], 'layout preserves players and stream identity');
    assert.deepEqual(await evaluate(b, `({offers:__stageProbe.offers,replaceTracks:__stageProbe.replaceTracks,captures:__stageProbe.captures})`), counters, 'layout must not negotiate or capture');
    // Real touch events in the isolated browser, never the user's desktop.
    for (const [width,height] of [[390,844], [320,640], [844,390]]) {
        await send('Emulation.setDeviceMetricsOverride', { width,height,deviceScaleFactor:1,mobile:true }, b);
        await send('Emulation.setTouchEmulationEnabled', { enabled:true }, b);
        await delay(100);
        await tap(b, '#stageStageToggle');
        await tap(b, '#stageChatToggle');
        await screenshot(b, `mobile-chat-${width}`);
        assert.equal(await evaluate(b, `getComputedStyle(document.querySelector('.room-stage')).display === 'none' && getComputedStyle(document.querySelector('#chat-panel')).display !== 'none'`), true);
        await tap(b, '#stageChannelsToggle');
        assert.equal(await evaluate(b, `document.querySelector('#chat-panel').inert && getComputedStyle(document.querySelector('#stage-channels')).display !== 'none'`), true);
        await tap(b, '#stageStageToggle');
        await tap(b, '[data-control-menu="mic"]');
        await wait(() => evaluate(b, `document.querySelector('[data-device-popover="mic"]').classList.contains('is-open')`), 'touch opens microphone settings');
        if (width === 390) await screenshot(b, 'mobile-microphone-settings');
        await tap(b, '[data-device-popover="mic"] [data-control-close]');
        assert.equal(await evaluate(b, `document.querySelector('[data-device-popover="mic"]').classList.contains('is-open')`), false, 'settings have an explicit close action');
        await tap(b, '#video-grid > .is-stage-focus .voice-player-more');
        assert.equal(await evaluate(b, `document.querySelector('.voice-player-menu').textContent.includes('连接方式') && document.querySelector('.voice-player-menu').textContent.includes('调整音量')`), true, 'secondary share controls remain accessible');
        await tap(b, '.voice-player-menu button:nth-child(4)');
        await wait(() => evaluate(b, `document.querySelector('.voice-route-dialog')?.open`), 'mobile share menu opens the real route dialog');
        await tap(b, '.voice-route-dialog .voice-route-close');
        await wait(() => evaluate(b, `!document.querySelector('.voice-route-dialog')?.open`), 'touch closes route dialog');
        await tap(b, '#stageStageToggle');
        assert.equal(await evaluate(b, `document.querySelector('#chatInput').value`), 'preserved draft');
        assert.deepEqual(await evaluate(b, `__originalPlayers.filter(({node,stream})=>!node.isConnected || node.srcObject!==stream).map(({node})=>node.tagName)`), [], 'mobile navigation preserves exact players and streams');
        await screenshot(b, `mobile-sharing-${width}`);
    }
    assert.deepEqual(await evaluate(b, `({offers:__stageProbe.offers,replaceTracks:__stageProbe.replaceTracks,captures:__stageProbe.captures})`), counters, 'mobile tabs and settings never capture or negotiate');
    // Exercise actual playback and UI events without replacing any media tracks.
    await send('Emulation.setDeviceMetricsOverride', { width:390,height:844,deviceScaleFactor:1,mobile:true }, b);
    await viewportReady(b,390,844);
    await tap(b, '#stageStageToggle');
    await wait(() => evaluate(b, `document.querySelector('#video-grid > .is-stage-focus').dataset.playbackState === 'playing'`), 'shared playback feedback sees live video');
    await evaluate(b, `document.querySelector('#video-grid > .is-stage-focus video').pause()`);
    await wait(() => evaluate(b, `document.querySelector('#video-grid > .is-stage-focus').dataset.playbackState === 'paused'`), 'paused player shows resume action');
    await screenshot(b, 'mobile-resume');
    await tap(b, '#video-grid > .is-stage-focus .share-watch-message button');
    await wait(() => evaluate(b, `document.querySelector('#video-grid > .is-stage-focus').dataset.playbackState === 'playing'`), 'resume action plays original screen video');
    await tap(b, '#video-grid > .is-stage-focus .voice-player-more');
    await evaluate(b, `[...document.querySelectorAll('.voice-player-menu button')].find(n=>n.textContent === '网页内全屏').click()`);
    await wait(() => evaluate(b, `document.querySelector('.is-web-fullscreen')?.classList.contains('is-immersive-player')`), 'mobile immersive player');
    await screenshot(b, 'mobile-fullscreen-controls');
    await wait(() => evaluate(b, `document.querySelector('.is-web-fullscreen').classList.contains('player-controls-hidden')`), 'fullscreen controls auto-hide');
    await wait(() => evaluate(b, `getComputedStyle(document.querySelector('.is-web-fullscreen .tile-header')).opacity === '0'`), 'fullscreen fade completes');
    await screenshot(b, 'mobile-fullscreen-clean');
    await tap(b, '.is-web-fullscreen video');
    await wait(() => evaluate(b, `!document.querySelector('.is-web-fullscreen').classList.contains('player-controls-hidden')`), 'touch reveals fullscreen controls');
    await tap(b, '.is-web-fullscreen .fullscreen-btn');
    await wait(() => evaluate(b, `!document.querySelector('.is-web-fullscreen') && !document.fullscreenElement`), 'fullscreen exit restores original stage');
    await tap(b, '[data-control-menu="mic"]');
    await send('Input.dispatchKeyEvent', { type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27 }, b);
    await send('Input.dispatchKeyEvent', { type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27 }, b);
    await wait(() => evaluate(b, `!document.querySelector('[data-device-popover="mic"]').classList.contains('is-open') && document.querySelector('#main').dataset.mobilePanel === 'stage'`), 'close request dismisses only device settings');
    await tap(b, '#video-grid > .is-stage-focus .voice-player-more');
    await tap(b, '.voice-player-menu button:first-child');
    await wait(() => evaluate(b, `!document.querySelector('#video-grid > .is-stage-focus .voice-share-stats').hidden`), 'real video statistics open');
    await wait(() => evaluate(b, `document.querySelector('#video-grid > .is-stage-focus .voice-share-stats').textContent.includes('解码 FPS')`), 'statistics distinguish decode and playback');
    await screenshot(b, 'mobile-video-statistics');
    await tap(b, '#video-grid > .is-stage-focus .voice-share-stats button');
    await send('Page.bringToFront', {}, a);
    await evaluate(a, `document.querySelector('#chatInput').value='mobile unread regression'; document.querySelector('#chatForm').requestSubmit()`);
    await wait(() => evaluate(b, `Number(document.querySelector('#stageChatToggle').dataset.unreadCount) > 0`), 'hidden chat receives unread notification');
    await send('Page.bringToFront', {}, b);
    await screenshot(b, 'mobile-unread');
    await tap(b, '#stageChatToggle');
    await wait(() => evaluate(b, `document.querySelector('#stageChatToggle').dataset.unreadCount === '0'`), 'opening latest chat marks visible messages read');
    await tap(b, '#stageStageToggle');
    assert.deepEqual(await evaluate(b, `__originalPlayers.filter(({node,stream})=>!node.isConnected || node.srcObject!==stream).map(({node})=>node.tagName)`), [], 'immersive and resume retain actual players and streams');
    assert.deepEqual(await evaluate(b, `({offers:__stageProbe.offers,replaceTracks:__stageProbe.replaceTracks,captures:__stageProbe.captures})`), counters, 'immersive, resume and unread UI never capture or negotiate');
    const routeSession = b; // The first publisher has SFU admission; the second may legitimately use P2P.
    const routeTile = await evaluate(routeSession, `document.querySelector('#video-grid > .is-stage-focus').id`);
    assert.notEqual(routeTile, 'local-video', 'the receiver route controls must be exercised');
    if (routeTile !== 'local-video') {
        await wait(() => evaluate(routeSession, `Boolean(document.getElementById('${routeTile}').querySelector('.voice-route-toggle'))`), 'remote route control');
        await click(routeSession, `[id="${routeTile}"] .voice-route-toggle`);
        assert.equal(await evaluate(routeSession, `document.querySelector('[id="${routeTile}"] .voice-route-auto input').checked`), false, 'current server defaults to P2P first');
        if (useSfu) {
            await click(routeSession, `[id="${routeTile}"] .voice-route-auto input`);
            await wait(() => evaluate(routeSession, `document.querySelector('[id="${routeTile}"] .voice-route-toggle').title.includes('服务器转发')`), 'automatic SFU route');
        }
        if (useSfu) await click(routeSession, `[id="${routeTile}"] .voice-route-auto input`);
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
    await evaluate(b, `window.__shareMic = __cameraTile.querySelector('video').srcObject.getAudioTracks()[0];`);
    await click(a, '#shareScreen');
    await wait(() => evaluate(b, `document.querySelector('#main').dataset.stageMode === 'voice'`), 'last share end');
    await wait(() => evaluate(b, `!document.querySelector('#stageShareNotice').hidden && document.querySelector('#stageShareNotice').textContent.includes('共享已结束')`), 'share end is visible without interrupting voice');
    await wait(() => evaluate(b, `__cameraTile.classList.contains('is-audio-only') && !__cameraTile.querySelector('video') && __cameraTile.querySelector('audio').srcObject.getAudioTracks()[0] === __shareMic && __shareMic.readyState === 'live'`), 'screen end with camera off leaves voice without a frozen frame');
    const voiceLayouts = [];
    await send('Page.bringToFront', {}, a);
    for (const [width,height,dpr] of viewports) {
        await send('Emulation.setDeviceMetricsOverride', { width,height,deviceScaleFactor:dpr,mobile:false }, a);
        await viewportReady(a,width,height);
        const expanded = await evaluate(a, `document.querySelector('#stageChatToggle').getAttribute('aria-expanded')`);
        if ((!compactViewport(width,height)) !== (expanded === 'true')) await click(a, '#stageChatToggle');
        await delay(60);
        const result = await geometry(a);
        assert.equal(result.overflow, false, `voice horizontal overflow ${width}`);
        assert.equal(result.stage.display, 'none', 'no empty black stage in voice mode');
        assert.ok(result.members.h > 0 && result.members.w > 0, `voice members ${width}`);
        assert.ok(result.cards.every((card) => card.w <= 720 && card.h >= 140));
        if (!compactViewport(width,height)) {
            assert.ok(result.chat.w > 0 && result.chat.h > 0);
            assert.ok(result.members.x + result.members.w <= result.chat.x + 1, 'voice members precede right chat');
            await click(a, '#stageChatToggle');
            const closed = await geometry(a);
            assert.ok(closed.members.w>result.members.w && closed.members.x+closed.members.w>=width-1,'closing chat expands voice stage without blank columns');
            await click(a, '#stageChatToggle');
        }
        checkDock(result);
        voiceLayouts.push(result);
        if (width === 390) await screenshot(a, 'mobile-voice');
    }
    await click(b, '#destroyPeer');
    await wait(() => evaluate(a, `document.querySelectorAll('#member-cards > *').length === 1`), 'member departure');
    // Geometry fixtures use the actual card markup, with media removed. Real
    // two-party WebRTC behavior is exercised above; these are count/layout cases.
    const memberGrids = [];
    await evaluate(a, `window.__gridOriginals=[...document.querySelector('#member-cards').children];`);
    for (const count of [1,2,3,4,8,12]) {
        for (const [width,height,dpr] of viewports) {
            await send('Emulation.setDeviceMetricsOverride', { width,height,deviceScaleFactor:dpr,mobile:false }, a);
            await viewportReady(a,width,height);
            const expanded = await evaluate(a, `document.querySelector('#stageChatToggle').getAttribute('aria-expanded')`);
            if ((!compactViewport(width,height)) !== (expanded === 'true')) await click(a, '#stageChatToggle');
            await evaluate(a, `(() => {
                const host=document.querySelector('#member-cards');host.replaceChildren();host.hidden=false;
                for(let i=0;i<${count};i++) {
                    const card=__gridOriginals[i%__gridOriginals.length].cloneNode(true); card.id='geometry-member-'+i;card.querySelectorAll('video,audio').forEach(n=>n.remove());
                    let placeholder=card.querySelector('.voice-placeholder');
                    if(!placeholder) { placeholder=document.createElement('div');placeholder.className='voice-placeholder';const avatar=document.createElement('div');avatar.className='voice-placeholder-avatar';avatar.textContent='G'+(i+1);placeholder.append(avatar);card.querySelector('.tile-body').append(placeholder); }
                    placeholder.hidden=false;host.append(card);
                }
                host.dataset.memberCount='${count}';
            })()`);
            await delay(40);
            const result=await geometry(a); checkDock(result);
            assert.equal(result.overflow,false,`member grid overflow ${count}/${width}`);
            assert.equal(result.cards.length,count);
            assert.ok(result.cards.every(c=>c.w>90 && c.x>=result.members.x && c.x+c.w<=result.members.x+result.members.w+1),'cards fit central region');
            if(!compactViewport(width,height)) assert.ok(result.members.x+result.members.w<=result.chat.x+1,`chat remains right sidebar ${count}/${width}x${height}: ${JSON.stringify({members:result.members,chat:result.chat})}`);
            else assert.equal(result.chat.display,'none','mobile starts with central members visible');
            if(count===1 && width>=1366) assert.ok(result.cards[0].w>=400,'single large central card');
            memberGrids.push({count,viewport:result.viewport});
            if(count===4 && (width===1920 || width===390)) await screenshot(a,`voice-four-${width}`);
        }
    }
    await evaluate(a, `document.querySelector('#member-cards').replaceChildren(...__gridOriginals);`);
    await click(a, '[data-copy-call-diagnostics]');
    await wait(() => evaluate(a, `Boolean(window.__copiedDiagnostics)`), 'diagnostics after peer departure');
    const diagnostics = await evaluate(a, `window.__copiedDiagnostics`);
    assert.ok(diagnostics.对端.some(row=>/缓存.*已离开/.test(row.状态) && row.数据?.当前状态), 'departed peer checkpoint is included');
    assert.equal(diagnostics.本机.当前会话.当前状态, undefined, 'current state is not duplicated');
    assert.deepEqual(errors, [], 'no unhandled browser runtime errors');
    assert.deepEqual(requests, [], 'no failed runtime resources');
    const report = { status:'passed', browser: (await send('Browser.getVersion')).product, syntheticMediaOnly:true, serverForwardingEnabled:useSfu,
        shareUiChecks: ['centered dialog with visible footer at twelve viewport/DPR cases', 'same Dock and dialog DOM throughout resize', 'compact left Dock parent with full-height desktop chat', 'mobile starts on stage', 'touch navigation, settings close and share menu at 320/390/844 CSS pixels', 'mobile navigation preserves actual players, streams and chat draft without media negotiation'],
        viewportCases: layouts.length + voiceLayouts.length, memberGridCases:memberGrids.length, memberCounts:[1,2,3,4,8,12], cssViewports:layouts.map((row)=>row.viewport),
        routeChecks:useSfu ? ['automatic SFU','manual P2P','manual SFU','per-sharer preference retention'] : ['P2P','manual P2P','per-sharer preference retention'],
        tests:['empty and occupied channel guides','central join action','voice join','camera off clears remote player and preserves voice','camera restart renders fresh frames','chat after camera restart','camera off preserves active screen share','screen end with camera off clears video','two voice peers','synthetic share','responsive geometry in both modes','1/2/3/4/8/12 member grid fixtures','bounded dock icons and member actions','closing chat expands central stage','chat draft','no layout renegotiation/capture','two shares','focus retention/fallback','manual route retention','preview hide retains capture','last share end','member departure'],
        mobilePolishChecks:['pause and resume original player','immersive auto-hide and touch reveal','fullscreen exit restores stage','close request dismisses settings','actual decode and playback statistics','unread badge and read acknowledgement','share end notice','no extra media capture or negotiation'],
        diagnosticChecks:['compact export','checkpoint survives peer departure'], runtimeErrors:errors.length, failedResources:requests.length };
    if (artifacts) writeFileSync(join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
} finally {
    if (ws?.readyState === WebSocket.OPEN) { await send('Browser.close').catch(() => {}); ws.close(); }
    browser?.kill(); app.kill();
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('test finished')); }
    // Only the explicitly created temporary profile/history/log directory.
    await delay(500);
    try { rmSync(work, { recursive:true, force:true, maxRetries:5, retryDelay:200 }); } catch { console.warn(`Temporary profile remains at ${work}`); }
}
