import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ejs from 'ejs';
import { fileURLToPath } from 'node:url';
import { sanitizeVoiceDiagnostic } from '../src/views/js/shared/voice-diagnostic-schema.js';

const read = (path) => readFileSync(new URL(`../src/views/${path}`, import.meta.url), 'utf8');
const flush = () => new Promise((resolve) => setImmediate(resolve));
class Element {
    constructor(tagName) { this.tagName = tagName; }
    children = [];
    listeners = {};
    attributes = {};
    textContent = '';
    className = '';
    disabled = false;
    open = false;
    append(...children) { this.children.push(...children); }
    prepend(child) { this.children.unshift(child); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    querySelector(selector) {
        return this.children.find((child) => selector[0] === '#'
            ? child.id === selector.slice(1) : child.className.split(' ').includes(selector.slice(1)))
            || this.children.map((child) => child.querySelector(selector)).find(Boolean);
    }
    click() { this.clicked = true; return this.listeners.click?.(); }
    showModal() { this.open = true; }
    close() { this.open = false; this.listeners.close?.(); }
    remove() { this.removed = true; }
}

function fixture({ clipboardFails = false, saved = [] } = {}) {
    const timers = new Map();
    const elements = [];
    const copied = [];
    const downloads = [];
    const shares = [];
    const connections = [];
    const state = { 会话: { state: 'idle', generation: null }, 本机音频: { 输入设备: '默认', deviceId: 'secret' },
        共享路径变化: { routeHistory: [] } };
    let id = 0;
    const window = {
        navigator: { userAgent: 'Windows Chrome/155', clipboard: { async writeText(text) {
            if (clipboardFails) throw new Error('denied');
            copied.push(JSON.parse(text));
        } } },
        document: { hidden: false, body: new Element('body'), createElement(tag) {
            const element = new Element(tag); elements.push(element); return element;
        } },
        setTimeout(fn) { timers.set(++id, fn); return id; },
        clearTimeout(key) { timers.delete(key); },
        localStorage: { getItem: () => JSON.stringify(saved), setItem() {} },
        Blob,
        URL: { createObjectURL(blob) { downloads.push(blob); return 'blob:diagnostics'; }, revokeObjectURL() {} },
    };
    vm.runInNewContext(read('js/voice/voice-share-diagnostics.js'), { window });
    vm.runInNewContext(read('js/voice/voice-call-diagnostics.js'), { window });
    const health = { 接收健康格式: 1, 活跃接收: [], 最近回退: [] };
    const runtime = window.VoiceCallDiagnostics.createRuntime({ sanitize: sanitizeVoiceDiagnostic,
        getState: () => state, getSources: () => shares, getConnections: () => connections, getReceiverHealth: () => health });
    const button = new Element('button');
    button.textContent = '复制诊断';
    return { runtime, button, window, timers, copied, downloads, elements, state, shares, connections, health };
}

test('room places call log actions in the header and keeps a direct download link', () => {
    const html = ejs.render(read('room/index.ejs'), { channelName: '大厅', roomId: 'lobby', channels: [],
        cspNonce: 'test', roomBootstrap: '{}', roomAssetVersions: {} }, { filename: fileURLToPath(new URL('../src/views/room/index.ejs', import.meta.url)) });
    const header = html.match(/<header class="workspace-topbar"[\s\S]*?<\/header>/)?.[0];
    assert.ok(header);
    assert.match(header, /workspace-brand/);
    assert.match(header, /<a class="workspace-download" href="\/download\/windows"/);
    assert.doesNotMatch(header, /stageMoreToggle|workspace-tools/);
    assert.match(header, /popovertarget="call-tools"/);
    assert.match(header, /data-call-log-actions[^>]*>[\s\S]*?data-copy-call-diagnostics[^>]*>复制诊断<\/button>/);
    assert.equal((html.match(/data-copy-call-diagnostics/g) || []).length, 1);
    assert.ok(html.indexOf('</header>') < html.indexOf('id="main"'));
    assert.doesNotMatch(html, /复制双方诊断|复制脱敏诊断/);
    assert.match(html, /data-call-log-actions/);
    assert.match(html, /data-show-call-logs/);
    assert.doesNotMatch(html, /data-clear-call-logs/);
    assert.match(html, /id="copyRoomLink"/);
    const script = read('script.js');
    const binding = script.split('\n').filter((line) => line.includes('[data-copy-call-diagnostics]'));
    assert.equal(binding.length, 1);
    assert.match(script, /callTools\?\.querySelector\('\[data-copy-call-diagnostics\]'\)\?\.addEventListener\('click',[\s\S]*?callTools\.hidePopover\?\.\(\);\s+void callDiagnostics\.copyCombined\(event.currentTarget,/);
    assert.doesNotMatch(script, /window\.VoiceCallDiagnostics\.copyCombined\s*=/);
    assert.doesNotMatch(read('js/voice/voice-share-diagnostics.js'), /createElement\('button'\)|clipboard|copyCombined/);
});

test('stage replaces desktop tools and retains safe edges and touch-sized header actions', () => {
    const template = read('room/index.ejs');
    assert.doesNotMatch(template, /js\/layout\/|layout-settings|desktop-window-toolbar/);
    assert.match(template, /stageChatToggle/);
    assert.match(template, /stageChannelsToggle/);
    const css = read('styles/layout.css') + read('styles/stage-layout.css');
    for (const side of ['top', 'left', 'right']) assert.ok(css.includes(`env(safe-area-inset-${side})`));
    assert.match(css, /min-height: 44px/);
    assert.match(css, /padding-top: calc\(var\(--workspace-bar-height\) \+ env\(safe-area-inset-top\)\)/);
    assert.match(template, /viewport-fit=cover/);
});

test('copy works before joining or sharing, blocks concurrent clicks and restores its label after success', async () => {
    const f = fixture();
    let finish;
    f.window.navigator.clipboard.writeText = (text) => new Promise((resolve) => {
        f.copied.push(JSON.parse(text)); finish = resolve;
    });
    const feedback = [];
    const pending = f.runtime.copyCombined(f.button, (message) => feedback.push(message));
    assert.equal(f.button.textContent, '正在收集诊断…');
    assert.equal(f.button.disabled, true);
    assert.equal(f.button.attributes['aria-busy'], 'true');
    await f.runtime.copyCombined(f.button);
    await flush();
    assert.equal(f.copied.length, 1);
    assert.equal(f.copied[0].未响应原因, 'not-in-voice');
    assert.equal(f.copied[0].本机.当前状态.会话.state, 'idle');
    assert.deepEqual(f.copied[0].本机.当前状态.共享, []);
    assert.doesNotMatch(JSON.stringify(f.copied), /secret/);
    finish();
    await pending;
    assert.equal(f.button.textContent, '诊断已复制');
    assert.deepEqual(feedback, ['正在收集诊断…', '诊断已复制']);
    assert.equal(f.button.disabled, false);
    assert.equal(f.button.attributes['aria-busy'], 'false');
    [...f.timers.values()][0]();
    assert.equal(f.button.textContent, '复制诊断');
    f.runtime.destroy();
});

test('copy without screen sharing keeps successful peers and explicit non-response statuses', async () => {
    const f = fixture();
    f.state.会话 = { state: 'joined', generation: 1 };
    f.runtime.start();
    await flush();
    f.runtime.attachSocket({ connected: true, on() {}, off() {}, timeout() { return this; }, emit(_, ack) {
        ack(null, { ok: true, results: [{ 序号: 1, 状态: '已采样', 数据: { 当前状态: { 本机音频: { AEC: true } } } },
            { 序号: 2, 状态: '未响应（旧版本、离线或超时）' },
            { 序号: 3, 状态: '已采样', 数据: { 当前会话: { 事件: 'malformed', 历史采样: [null, { 共享: {} }] } } }],
        omitted: 0 });
    } });
    await f.runtime.copyCombined(f.button);
    const data = f.copied[0];
    assert.equal(data.对端[0].数据.当前状态.本机音频.AEC, true);
    assert.match(data.对端[1].状态, /未响应/);
    assert.deepEqual(data.对端[2].数据.当前会话.事件, []);
    assert.equal(data.对端[2].数据.当前会话.脱敏截断, true);
    assert.ok(data.本机.当前会话.历史采样.length);
    assert.equal(f.button.textContent, '诊断已复制');
    f.runtime.destroy();
});

test('long call copies the last event and measurements before and after leaving', async () => {
    const f = fixture();
    f.state.会话 = { state: 'joined', generation: 1 };
    for (let index = 0; index < 6; index++) {
        const audio = { id: 'private-inbound', type: 'inbound-rtp', kind: 'audio', timestamp: 1234, packetsLost: 1 };
        f.connections.push({ getStats: async () => new Map([[audio.id, audio]]) });
    }
    f.runtime.start();
    await flush();
    const bulky = Array.from({ length: 6 }, () => ({ 音频流: Array(4).fill({ 累计丢包: 1, 抖动_ms: 8, 码率_Mbps: .07,
        音量: .55, 编码: 'audio/opus', 方向: '接收', '隐藏样本比例_%': 1 }) }));
    for (let index = 0; index < 100; index++) f.runtime.record('状态变化', { 连接: bulky, 会话: { state: 'joined' } });
    f.runtime.record('Piik 共享异常', { 来源: 'Piik', 阶段: 'watch', reason: 'piik-watch-failed', peerId: 'private-peer' });
    await f.runtime.copyCombined(f.button);
    const active = f.copied[0].本机.当前会话;
    assert.equal(active.事件.length, 40);
    assert.ok(active.历史采样.length && active.精简时间线.length > 100);
    assert.equal(active.事件.at(-1).内容.reason, 'piik-watch-failed');
    assert.equal(active.复制截断, true);
    assert.equal(active.脱敏截断, false);
    f.runtime.end('user-leave');
    f.state.会话 = { state: 'idle', generation: null };
    await f.runtime.copyCombined(f.button);
    const ended = f.copied[1];
    assert.equal(ended.本机.当前会话, null);
    assert.equal(ended.本机.最近会话.结束原因, 'user-leave');
    assert.equal(ended.本机.最近会话.最后异常.内容.reason, 'piik-watch-failed');
    assert.equal(ended.本机.当前状态.连接.length, 6);
    assert.equal(ended.未响应原因, 'socket-disconnected');
    assert.doesNotMatch(JSON.stringify(ended), /private-/);
    f.runtime.destroy();
});

test('legacy history with missing rows can be selected while a different call is active', async () => {
    const 开始时间 = '2026-10-17T00:00:00.000Z';
    const f = fixture({ saved: [{ 开始时间, 结束时间: '2026-10-17T00:00:01.000Z', 事件: [null, { 类型: '通话结束' }],
        历史采样: [null], 当前状态: { 会话: { state: 'failed', generation: 999, 失败原因: 'join-failed' } } }] });
    f.runtime.start();
    f.runtime.attachSocket({ connected: true, on() {}, off() {}, timeout() { throw new Error('historical copy must stay local'); } });
    await f.runtime.copyCombined(f.button, undefined, 开始时间);
    const { 本机, 未响应原因 } = f.copied[0];
    assert.equal(本机.最近会话.开始时间, 开始时间);
    assert.equal(本机.最近会话.脱敏截断, true);
    assert.equal(本机.当前状态.会话.失败原因, 'join-failed');
    assert.equal(本机.当前状态.会话.generation, undefined);
    assert.equal(未响应原因, 'historical-local-only');
    f.runtime.destroy();
});

test('copy uses live share sampling and retains route history and receiver health after SFU fallback', async () => {
    const f = fixture();
    f.state.会话 = { state: 'joined', generation: 1 };
    let timestamp = 1000;
    const pc = { screenRoute: 'SFU', getStats: async () => new Map([['video', { id: 'private', type: 'outbound-rtp',
        kind: 'video', timestamp: timestamp += 1000, framesEncoded: timestamp / 20, framesSent: timestamp / 25,
        bytesSent: timestamp * 100, mediaSourceId: 'capture' }], ['capture', { id: 'capture', timestamp, frames: timestamp / 16 }]]) };
    f.shares.push({ tile: new Element('div'), isScreenSharing: true, isLocal: true,
        outgoingConnections: [pc], stream: { getVideoTracks: () => [{ getSettings: () => ({ width: 1920, height: 1080, frameRate: 60 }) }] } });
    f.runtime.start();
    await flush();
    await f.runtime.copyCombined(f.button);
    const share = f.copied[0].本机.当前状态.共享[0];
    assert.equal(share.采集轨道设置.宽, 1920);
    assert.equal(share.连接[0].路径, 'SFU');
    assert.equal(share.连接[0].视频流[0].区间编码帧率, 50);
    assert.equal(share.连接[0].视频流[0].区间发送帧率, 40);
    f.state.共享路径变化.routeHistory.push({ event: 'fallback', reason: 'receiver-video-stalled' });
    f.health.最近回退.push({ reason: 'receiver-video-stalled', 健康采样: [{ 接收字节增长: 10, 解码帧增长: 0 }] });
    pc.screenRoute = 'P2P';
    f.runtime.record('共享路径事件', f.state.共享路径变化);
    await f.runtime.copyCombined(f.button);
    const local = f.copied[1].本机;
    assert.equal(local.当前状态.共享[0].连接[0].路径, 'P2P');
    assert.equal(local.SFU接收健康.最近回退[0].健康采样[0].解码帧增长, 0);
    assert.equal(local.当前状态.共享路径变化.routeHistory[0].reason, 'receiver-video-stalled');
    assert.ok(local.当前会话.事件.some((event) => event.类型 === '共享路径事件'));
    assert.ok(local.当前会话.历史采样.some((sample) => sample.共享[0]?.连接[0].路径 === 'SFU'));
    assert.doesNotMatch(JSON.stringify(f.copied), /private|secret/);
    f.runtime.destroy();
});

test('denied or absent clipboard preserves the full export in the text dialog and downloadable JSON', async () => {
    for (const clipboard of ['denied', 'absent']) {
        const f = fixture({ clipboardFails: true });
        if (clipboard === 'absent') delete f.window.navigator.clipboard;
        // eslint-disable-next-line no-await-in-loop -- Exercise both clipboard failure modes.
        await f.runtime.copyCombined(f.button);
        const dialog = f.window.document.body.children[0];
        assert.equal(dialog.open, true);
        const [area, download, close] = dialog.children;
        assert.equal(area.readOnly, true);
        const data = JSON.parse(area.value);
        assert.equal(data.本机.当前状态.本机音频.输入设备, '默认');
        assert.doesNotMatch(area.value, /secret/);
        download.click();
        // eslint-disable-next-line no-await-in-loop -- Read the user-triggered download.
        assert.equal(await f.downloads[0].text(), area.value);
        const link = f.elements.find((element) => element.tagName === 'a');
        assert.match(link.download, /^voice-diagnostics-\d+\.json$/);
        assert.equal(link.clicked, true);
        assert.equal(f.button.disabled, false);
        assert.match(f.button.textContent, /手动复制/);
        close.click();
        assert.equal(dialog.removed, true);
        f.runtime.destroy();
    }
});

for (const outcome of ['resolve', 'reject']) {
    test(`destroyed diagnostics ignores clipboard ${outcome} and releases its button immediately`, async () => {
        const f = fixture(); let finish;
        f.window.navigator.clipboard.writeText = () => new Promise((resolve, reject) => { finish = outcome === 'resolve' ? resolve : reject; });
        const pending = f.runtime.copyCombined(f.button); await flush();
        f.runtime.destroy();
        assert.equal(f.button.disabled, false); assert.equal(f.button.attributes['aria-busy'], 'false');
        f.button.textContent = '新界面反馈'; finish(new Error('old clipboard request')); await pending;
        assert.equal(f.button.textContent, '新界面反馈');
        assert.equal(f.window.document.body.children.length, 0);
        assert.equal(f.timers.size, 0);
    });
}

test('destroying idle diagnostics while collecting prevents a later clipboard write', async () => {
    const f = fixture(); let finish;
    f.window.VoiceShareDiagnostics.sync = () => new Promise(resolve => { finish = resolve; });
    f.shares.push({ tile: {}, isScreenSharing: true });
    const pending = f.runtime.copyCombined(f.button); await flush();
    f.runtime.destroy(); finish({}); await pending;
    assert.equal(f.copied.length, 0); assert.equal(f.timers.size, 0);
    assert.equal(f.button.textContent, '复制诊断'); assert.equal(f.button.disabled, false);
});

for (const outcome of ['resolve', 'reject']) {
    test(`clipboard ${outcome} from the previous session requests retry without opening its manual export`, async () => {
        const f = fixture(); let finish;
        f.window.navigator.clipboard.writeText = () => new Promise((resolve, reject) => { finish = outcome === 'resolve' ? resolve : reject; });
        const pending = f.runtime.copyCombined(f.button); await flush();
        f.state.会话 = { state: 'joined', generation: 2 };
        finish(new Error('old session clipboard result')); await pending;
        assert.equal(f.window.document.body.children.length, 0);
        assert.match(f.button.textContent, /会话已变化/); assert.equal(f.button.disabled, false);
        f.runtime.destroy();
    });
}

test('copy after diagnostics destruction does not collect or write clipboard data', async () => {
    const f = fixture(); f.runtime.destroy();
    await f.runtime.copyCombined(f.button);
    assert.equal(f.copied.length, 0); assert.equal(f.timers.size, 0);
    assert.equal(f.button.textContent, '复制诊断'); assert.equal(f.button.disabled, false);
});

test('a retired diagnostics feedback callback cannot overwrite a new owner after destroy', async () => {
    const f = fixture(); await f.runtime.copyCombined(f.button);
    const restore = [...f.timers.values()][0]; f.runtime.destroy();
    f.button.textContent = '新界面反馈'; restore();
    assert.equal(f.button.textContent, '新界面反馈'); assert.equal(f.timers.size, 0);
});

test('a session change reports retry and releases the copy button without copying stale diagnostics', async () => {
    const f = fixture();
    let finish;
    f.state.会话 = { state: 'joined', generation: 1 };
    f.runtime.start();
    await flush();
    f.runtime.attachSocket({ connected: true, on() {}, off() {}, timeout() { return this; }, emit(_, ack) { finish = ack; } });
    const pending = f.runtime.copyCombined(f.button);
    f.state.会话.generation = 2;
    finish(null, { ok: true, results: [] });
    await pending;
    assert.equal(f.copied.length, 0);
    assert.match(f.button.textContent, /会话已变化/);
    assert.equal(f.button.disabled, false);
    f.runtime.destroy();
});
