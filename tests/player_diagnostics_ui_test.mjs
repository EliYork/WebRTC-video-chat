import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { createDocument, allText } from './helpers/player-dom.mjs';
const read = (name) => readFileSync(new URL(`../src/views/js/voice/${name}.js`, import.meta.url), 'utf8');
const fixture = () => {
    const document = createDocument();
    const window = { document, setTimeout, clearTimeout };
    vm.runInNewContext(read('voice-share-stats-view'), { window });
    const tile = document.createElement('article');
    const body = document.createElement('div'); body.className = 'tile-body'; tile.append(body); document.body.append(tile);
    return { window, document, tile, body, api: window.VoiceShareStatsView };
};
const snapshot = () => ({ 角色: '观看者', 采样时间: new Date().toISOString(), 播放画面: { 宽: 3840, 高: 2160, 提交合成器帧率: 0 },
    连接: [{ 序号: 1, 路径: 'SFU', 视频流: [{ 方向: '接收', 编码: 'video/VP8', 宽: 3840, 高: 2160, 区间完整接收帧率: 45, 区间解码帧率: 0, 码率_Mbps: 15, 指标状态: {} }] }] });

test('stats overlay is opt-in, tile-contained, preserves real zeros and separates receive/decode/presentation', () => {
    const f = fixture(); const view = f.api.create(f.tile); const data = snapshot();
    view.update(data);
    assert.equal(f.body.children[0].hidden, true);
    view.toggle();
    const text = allText(f.body);
    assert.match(text, /完整接收 FPS 45/); assert.match(text, /解码 FPS 0/); assert.match(text, /播放提交 FPS 0/);
    assert.match(text, /服务器转发/); assert.match(text, /3840 × 2160/); assert.match(text, /15 Mbps/);
    assert.doesNotMatch(text, /采集 FPS|编码 FPS|目标 FPS/);
    assert.equal(f.tile.querySelector('section').parentElement, f.body);
});
test('missing, unsupported, stale and background metrics never masquerade as measured zero', () => {
    const f = fixture(); const data = snapshot(); const row = data.连接[0].视频流[0];
    row.区间完整接收帧率 = null; row.区间解码帧率 = null;
    row.指标状态 = { 区间完整接收帧率: '不支持', 区间解码帧率: '未采样' };
    let text = JSON.stringify(f.api.model(data));
    assert.match(text, /不支持/); assert.match(text, /未采样/);
    text = JSON.stringify(f.api.model(data, Date.now() + 15000));
    assert.match(text, /数据过期/); assert.doesNotMatch(text, /15 Mbps/);
    assert.match(JSON.stringify(f.api.model(data, Date.now(), true)), /页面后台/);
    row.统计状态 = '数据过期';
    assert.match(JSON.stringify(f.api.model(data)), /数据过期/);
});
test('sender targets are explicitly settings; paths and per-connection measurements are not aggregated', () => {
    const f = fixture(); const data = snapshot(); data.角色 = '共享者'; data.共享目标 = { frameRate: 60 };
    Object.assign(data.连接[0].视频流[0], { 方向: '发送', 区间采集帧率: 55, 区间编码帧率: 50, 区间发送帧率: 45 });
    data.连接.push({ 序号: 2, 路径: 'P2P', 状态: '统计读取失败或超时，下次重试' });
    const view = f.api.create(f.tile); view.update(data); view.toggle();
    const text = allText(f.body);
    assert.match(text, /目标 FPS（设置） 60/); assert.match(text, /采集 FPS 55/); assert.match(text, /编码 FPS 50/); assert.match(text, /发送 FPS 45/);
    assert.match(text, /连接 2 · P2P · 路径未确认/); assert.match(text, /统计读取失败/);
    view.remove(); assert.equal(f.body.children.length, 0);
});

test('AV1 experiment warns about cadence, SDP absence is not unsupported, and idle SFU is not the active viewer path', () => {
    const f = fixture(); const data = snapshot(); data.角色 = '共享者';
    data.共享路径变化 = { hasUplink: true, serverViewers: 0, uplinkStatus: 'idle' };
    data.编码器选择 = { mode: 'av1', primary: 'av1', reason: 'manual-av1-below-target', probe: { passed: false } };
    data.连接[0].编码协商 = { remoteSdpAV1: false, actual: 'video/H264', negotiated: 'video/H264', status: 'frames-verified' };
    data.连接.push({ 序号: 2, 路径: 'P2P', 实际传输路径: 'direct', 视频流: [{ 方向: '发送', 编码: 'video/AV1', 区间编码帧率: 55 }] });
    const model = f.api.model(data); let text = JSON.stringify(model);
    assert.match(text, /未达目标 FPS，继续实验/); assert.match(text, /未包含（不代表不支持）/);
    assert.match(model.groups[1].title, /SFU 备用上传（无观看者）/);
    assert.match(model.groups[2].title, /P2P 直连/); assert.match(text, /video\/AV1/);
    data.共享路径变化.serverViewers = 1;
    assert.match(f.api.model(data).groups[1].title, /服务器转发/);
    data.角色 = '观看者'; data.共享路径变化.serverViewers = 0;
    assert.match(f.api.model(data).groups[1].title, /服务器转发/);
    delete data.连接[0].编码协商.remoteSdpAV1;
    text = JSON.stringify(f.api.model(data)); assert.match(text, /当前远端 SDP 含 AV1","未知/);
    vm.runInNewContext(read('voice-player-events'), { window: f.window });
    const eventText = f.window.VoicePlayerEvents.describe({ 类型: '观看路径切换', 内容: { 角色: '共享者', 路径: 'SFU', uplinkStatus: 'idle' } }).text;
    assert.equal(eventText, 'SFU 备用上传（无服务器观看者）');
});

test('event timeline defaults to the current call, filters category/scope, sorts precise times and preserves raw details', () => {
    const f = fixture(); vm.runInNewContext(read('voice-player-events'), { window: f.window });
    const sessions = [
        { 开始时间: '2026-10-17T00:00:00.000Z', 结束时间: '2026-10-17T01:00:00.000Z', 事件: [{ 时间: '2026-10-17T00:00:00.001Z', 类型: '通话开始' }] },
        { 开始时间: '2026-10-18T00:00:00.000Z', 截断: true, 事件: [
            { 时间: '2026-10-18T00:00:02.123Z', 类型: '共享播放异常', 内容: { 视频序号: 1, reason: 'low-decoded-fps' } },
            { 时间: '2026-10-18T00:00:01.123Z', 类型: '共享路径事件', 内容: { event: 'subscribe-failed', reason: 'subscription-timeout' } },
            { 时间: '2026-10-18T00:00:03.123Z', 类型: '共享开始', 内容: { 视频序号: 2 } },
        ] },
    ];
    let unsubscribed = false, raw = false;
    const dialog = f.window.VoicePlayerEvents.show({ getLogs: () => ({ sessions, currentIndex: 1, storageState: '可用' }), subscribe: () => () => { unsubscribed = true; }, showRaw: () => { raw = true; }, shareOrdinal: 1, host: f.tile });
    const selects = dialog.querySelectorAll('select');
    assert.equal(selects[0].value, sessions[1].开始时间);
    const text = allText(dialog);
    assert.match(text, /记录已截断/); assert.match(text, /订阅超时/);
    assert.match(text, /通话级（未归属单个视频）/);
    const items = dialog.querySelectorAll('details');
    assert.equal(items.length, 2); assert.match(items[0].querySelector('summary').textContent, /01.123/);
    items[1].open = true; items[1].dispatchEvent({ type: 'toggle' });
    assert.match(allText(items[1]), /low-decoded-fps/); assert.match(allText(items[1]), /2026-10-18T00:00:02.123Z/);
    selects[1].value = '异常与恢复'; selects[1].dispatchEvent({ type: 'change' });
    assert.equal(dialog.querySelectorAll('details').length, 2);
    selects[3].value = 'newest'; selects[3].dispatchEvent({ type: 'change' });
    assert.match(dialog.querySelector('summary').textContent, /02.123/);
    dialog.querySelectorAll('button').at(-1).click(); assert.equal(raw, true);
    assert.doesNotMatch(allText(dialog.querySelector('.voice-events-list')), /共享 2/);
    selects[0].value = sessions[0].开始时间; selects[0].dispatchEvent({ type: 'change' });
    assert.match(allText(dialog), /当前筛选下暂无事件/);
    dialog.close(); assert.equal(unsubscribed, true); assert.equal(dialog.isConnected, false);
});

test('video-only menu supports touch entry, keyboard navigation, dismissal, focus restore and reused remote volume', () => {
    const f = fixture();
    f.window.innerWidth = 800; f.window.innerHeight = 600;
    vm.runInNewContext(read('voice-player-menu'), { window: f.window });
    const video = f.document.createElement('video'); f.body.append(video);
    const header = f.document.createElement('div'); header.className = 'tile-header-actions'; f.tile.append(header);
    let visible = false, events = 0, volume = 0, opens = 0;
    f.window.VoiceShareDiagnostics = { isVisible: () => visible, toggle: () => { visible = !visible; } };
    f.window.VoicePlayerMenu.configure({ beforeOpen: () => opens++, showEvents: (tile) => { assert.equal(tile, f.tile); events++; }, onVolume: (event, tile) => { assert.equal(tile, f.tile); assert.ok(event.clientX >= 0); volume++; } });
    const source = { tile: f.tile, video, isScreenSharing: true };
    f.window.VoicePlayerMenu.sync(source); f.window.VoicePlayerMenu.sync(source);
    assert.equal(header.children.length, 1);
    assert.equal(f.tile.listeners.has('contextmenu'), false);
    assert.equal(f.document.listeners.has('contextmenu'), false);
    const context = { type: 'contextmenu', clientX: 390, clientY: 290 };
    video.dispatchEvent(context);
    assert.ok(context.defaultPrevented && context.stopped);
    let menu = f.tile.querySelector('.voice-player-menu');
    assert.equal(menu.children.length, 3); assert.equal(f.document.activeElement, menu.children[0]);
    menu.dispatchEvent({ type: 'keydown', key: 'End' }); assert.equal(f.document.activeElement, menu.children[2]);
    menu.dispatchEvent({ type: 'keydown', key: 'ArrowDown' }); assert.equal(f.document.activeElement, menu.children[0]);
    menu.dispatchEvent({ type: 'keydown', key: 'Enter' }); assert.equal(visible, true); assert.equal(f.document.activeElement, video);
    const more = header.children[0]; more.click();
    menu = f.tile.querySelector('.voice-player-menu'); assert.match(menu.children[0].textContent, /隐藏/);
    menu.children[1].click(); assert.equal(events, 1);
    more.click(); menu = f.tile.querySelector('.voice-player-menu'); menu.children[2].click(); assert.equal(volume, 1);
    video.dispatchEvent({ type: 'keydown', key: 'F10', shiftKey: true });
    menu = f.tile.querySelector('.voice-player-menu'); menu.dispatchEvent({ type: 'keydown', key: 'Escape' });
    assert.equal(f.document.activeElement, video); assert.equal(f.tile.querySelector('.voice-player-menu'), undefined);
    more.dispatchEvent({ type: 'keydown', key: 'ArrowDown' });
    f.document.dispatchEvent({ type: 'pointerdown', target: f.document.body });
    assert.equal(f.tile.querySelector('.voice-player-menu'), undefined);
    assert.equal(more.getAttribute('aria-expanded'), 'false'); assert.equal(opens, 5);
    f.window.VoicePlayerMenu.remove(f.tile); assert.equal(header.children.length, 0);
    assert.equal(video.listeners.get('contextmenu').length, 0);
});

test('menu clamps to tile/viewport bounds, replaces video listeners and omits local volume', () => {
    const f = fixture(); f.window.innerWidth = 800; f.window.innerHeight = 600;
    vm.runInNewContext(read('voice-player-menu'), { window: f.window });
    const api = f.window.VoicePlayerMenu;
    const point = api.position({ left: 100, top: 50, right: 700, bottom: 500 }, { width: 190, height: 135 }, 699, 499, 800, 600);
    assert.equal(point.left, 402); assert.equal(point.top, 307);
    const video = f.document.createElement('video'); const nextVideo = f.document.createElement('video');
    f.body.append(video, nextVideo);
    api.sync({ tile: f.tile, video, isScreenSharing: true, isLocal: true });
    api.sync({ tile: f.tile, video: nextVideo, isScreenSharing: true, isLocal: true });
    assert.equal(video.listeners.get('contextmenu').length, 0);
    nextVideo.dispatchEvent({ type: 'contextmenu', clientX: 20, clientY: 20 });
    assert.equal(f.tile.querySelector('.voice-player-menu').children.length, 2);
    api.remove(f.tile);
});

test('collector, overlay and menu share one cache and enabling statistics never starts its own stats loop', async () => {
    const f = fixture(); f.window.innerWidth = 800; f.window.innerHeight = 600;
    f.window.CustomEvent = class { constructor(type, { detail }) { this.type = type; this.detail = detail; } };
    for (const name of ['voice-player-menu', 'voice-share-diagnostics']) vm.runInNewContext(read(name), { window: f.window });
    const api = f.window.VoiceShareDiagnostics;
    const video = f.document.createElement('video'); f.body.append(video);
    const track = { kind: 'video', readyState: 'live', getSettings: () => ({}) };
    let calls = 0;
    const pc = { screenRoute: 'SFU', getStats: async (selector) => {
        assert.equal(selector, track); calls++;
        return new Map([['r', { id: 'private-track', type: 'inbound-rtp', kind: 'video', timestamp: calls * 1000, framesReceived: calls * 45, framesDecoded: calls * 24, bytesReceived: calls * 1000000, frameWidth: 3840, frameHeight: 2160 }]]);
    } };
    const input = { tile: f.tile, video, pc, isScreenSharing: true, stream: { getVideoTracks: () => [track] } };
    await api.sync(input, { force: true }); assert.equal(calls, 1);
    assert.equal(f.body.querySelector('.voice-share-stats').hidden, true);
    f.tile.querySelector('.voice-player-more').click();
    f.tile.querySelector('.voice-player-menu').children[0].click();
    assert.equal(calls, 1, 'opening the overlay reads only the cache');
    await api.sync(input);
    assert.equal(calls, 2); assert.match(allText(f.body), /完整接收 FPS 45/); assert.match(allText(f.body), /解码 FPS 24/);
    assert.match(allText(f.body), /播放提交 FPS 不支持/); assert.doesNotMatch(allText(f.body), /private-track/);
    api.remove(f.tile);
    assert.equal(f.tile.querySelector('.voice-player-more'), undefined);
    assert.equal(f.body.querySelector('.voice-share-stats'), undefined);
});

test('native reported FPS remains explicitly sourced; a hidden local preview is not reported as a stalled viewer', () => {
    const f = fixture(); const data = snapshot(); data.角色 = '共享者';
    data.播放画面.预览隐藏 = true;
    Object.assign(data.连接[0].视频流[0], { 方向: '发送', 区间编码帧率: null, 浏览器报告帧率: 30, 区间采集帧率: null, 采集实际帧率: 60 });
    const text = JSON.stringify(f.api.model(data));
    assert.match(text, /编码 FPS（浏览器报告）","30/); assert.match(text, /采集 FPS（浏览器报告）","60/);
    assert.match(text, /本机预览已隐藏/);
});
