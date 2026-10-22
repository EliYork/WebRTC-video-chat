import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(
    new URL(
        '../src/views/js/voice/voice-share-diagnostics.js',
        import.meta.url
    ),
    'utf8'
);
class Element {
    children = [];
    listeners = {};
    textContent = '';
    open = false;
    append(...children) {
        this.children.push(...children);
    }
    addEventListener(type, fn) {
        this.listeners[type] = fn;
    }
    remove() {
        this.removed = true;
    }
}
function load() {
    const window = {
        document: { createElement: () => new Element() },
        setTimeout,
        clearTimeout,
    };
    vm.runInNewContext(source, { window });
    return { api: window.VoiceShareDiagnostics, window };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('phase metrics distinguish received and decoded frames and average buffer/QP deltas', () => {
    const { api } = load();
    const before = { id: 'r', timestamp: 1000, framesReceived: 0, framesDecoded: 0, qpSum: 0, jitterBufferDelay: 0, jitterBufferEmittedCount: 0, nackCount: 0 };
    const after = { ...before, type: 'inbound-rtp', timestamp: 2000, framesReceived: 45, framesDecoded: 6, qpSum: 180, jitterBufferDelay: 0.9, jitterBufferEmittedCount: 6, nackCount: 2 };
    const result = api.summarize([], after, before);
    assert.equal(result.区间完整接收帧率, 45);
    assert.equal(result.区间解码帧率, 6);
    assert.equal(result.区间平均QP, 30);
    assert.equal(result.每帧抖动缓冲等待_ms, 150);
    assert.equal(result.区间NACK次数, 2);
    assert.equal(api.summarize([], after).区间平均QP, null);
    assert.equal(api.summarize([], { ...after, timestamp: 3000 }, after).区间平均QP, null);
});

test('presentation callback is sampled separately and cancelled when panel is removed', async () => {
    const { api } = load();
    const tile = new Element();
    let callback;
    let cancelled = 0;
    const video = {
        requestVideoFrameCallback(fn) { callback = fn; return 7; },
        cancelVideoFrameCallback(id) { assert.equal(id, 7); cancelled++; },
    };
    const input = { tile, video, isScreenSharing: true };
    api.sync(input);
    tile.children[0].open = true;
    api.sync(input);
    await flush();
    callback(0, { presentedFrames: 10 });
    api.sync(input);
    await flush();
    const snapshot = JSON.parse(tile.children[0].children[2].textContent);
    assert.equal(snapshot.诊断格式, 5);
    assert.equal(snapshot.播放画面.提交合成器帧率, null);
    api.remove(tile);
    assert.equal(cancelled, 1);
});

test('statistics use interval rates, retain zero, and never export raw identifying fields', () => {
    const { api } = load();
    const previous = {
        id: 'private-id',
        timestamp: 1000,
        bytesReceived: 0,
        packetsReceived: 0,
        packetsLost: 0,
        framesDecoded: 0,
        framesDropped: 0,
        totalDecodeTime: 0,
    };
    const report = {
        ...previous,
        type: 'inbound-rtp',
        timestamp: 2000,
        bytesReceived: 125000,
        packetsReceived: 99,
        packetsLost: 1,
        framesDecoded: 25,
        framesDropped: 2,
        totalDecodeTime: 0.05,
        codecId: 'secret-codec',
        frameWidth: 1280,
        frameHeight: 720,
        ip: '192.168.0.1',
        trackIdentifier: 'private-track',
    };
    const rows = [{ id: 'secret-codec', mimeType: 'video/VP9' }];
    const result = api.summarize(rows, report, previous);
    assert.equal(result['码率_Mbps'], 1);
    assert.equal(result['区间丢包率_%'], 1);
    assert.equal(result.实际帧率, 25);
    assert.equal(result['每帧编解码_ms'], 2);
    assert.equal(result.区间解码丢帧, 2);
    assert.equal(result.编码, 'video/VP9');
    assert.doesNotMatch(JSON.stringify(result), /private|secret|192\.168/);
    assert.equal(api.summarize(rows, report, null)['码率_Mbps'], null);
    assert.equal(
        api.summarize(rows, { ...report, id: 'new' }, previous)['码率_Mbps'],
        null
    );
    assert.equal(
        api.summarize(rows, { ...report, bytesReceived: -1 }, previous)[
            '码率_Mbps'
        ],
        null
    );
    assert.equal(
        api.summarize(rows, { ...report, timestamp: 3000 }, report).实际帧率,
        0
    );
});

test('sender diagnostics link codec, capture, transport and remote feedback', () => {
    const { api } = load();
    const row = {
        id: 's',
        type: 'outbound-rtp',
        codecId: 'c',
        transportId: 't',
        remoteId: 'r',
        mediaSourceId: 'm',
        framesPerSecond: 30,
        qualityLimitationReason: 'bandwidth',
    };
    const result = api.summarize(
        [
            { id: 'c', mimeType: 'video/AV1' },
            { id: 't', selectedCandidatePairId: 'p' },
            {
                id: 'p',
                currentRoundTripTime: 0.1,
                availableOutgoingBitrate: 4000000,
                address: 'secret',
            },
            { id: 'r', packetsLost: 7, jitter: 0.02 },
            { id: 'm', framesPerSecond: 60 },
        ],
        row
    );
    assert.equal(result.采集实际帧率, 60);
    assert.equal(result.实际帧率, 30);
    assert.equal(result.编码受限原因, 'bandwidth');
    assert.equal(result['往返延迟_ms'], 100);
    assert.equal(result['本端连接估计可用上行_Mbps'], 4);
    assert.equal(result['抖动_ms'], 20);
});

test('interval capture, encode and send cadence can diverge; zero and source resets remain distinct', () => {
    const { api } = load();
    const before = { id: 'out', timestamp: 1000, framesEncoded: 60, framesSent: 60 };
    const after = { ...before, type: 'outbound-rtp', timestamp: 2000, framesEncoded: 110, framesSent: 105, mediaSourceId: 'capture' };
    const captureBefore = { id: 'capture', timestamp: 1000, frames: 60 };
    const captureAfter = { ...captureBefore, timestamp: 2000, frames: 120, framesPerSecond: 60 };
    const sample = api.summarize([captureAfter], after, before, captureBefore);
    assert.equal(sample.区间采集帧率, 60);
    assert.equal(sample.区间编码帧率, 50);
    assert.equal(sample.区间发送帧率, 45);
    assert.equal(api.summarize([captureAfter], after, before, { ...captureBefore, id: 'retired' }).区间采集帧率, null);
    assert.equal(api.summarize([{ ...captureAfter, frames: 60 }], after, before, captureBefore).区间采集帧率, 0);
});

test('panel is collapsed, samples only when open, shows sanitized data without copy buttons and removes on stop', async () => {
    const { api } = load();
    const tile = new Element();
    let calls = 0;
    const pc = {
        getStats: async () => {
            calls++;
            return new Map([
                [
                    'r',
                    {
                        id: 'secret',
                        type: 'inbound-rtp',
                        kind: 'video',
                        timestamp: 1000,
                        frameWidth: 1920,
                        frameHeight: 1080,
                    },
                ],
            ]);
        },
    };
    const input = {
        tile,
        pc,
        isScreenSharing: true,
        isLocal: false,
        video: { videoWidth: 1920, videoHeight: 1080 },
    };
    api.sync(input);
    const panel = tile.children[0];
    assert.equal(panel.open, false);
    assert.equal(calls, 0);
    panel.open = true;
    api.sync(input);
    await flush();
    assert.equal(calls, 1);
    assert.equal(panel.children.length, 3, 'only summary, note and statistics remain');
    assert.ok(panel.children.every((child) => !child.listeners.click), 'no copy handlers remain');
    assert.match(panel.children[2].textContent, /观看者/);
    assert.doesNotMatch(panel.children[2].textContent, /secret/);
    api.remove(tile);
    assert.equal(panel.removed, true);
});

test('failed stats stay visible and late reads cannot update a removed panel', async () => {
    const { api } = load();
    const tile = new Element();
    let finish;
    const input = {
        tile,
        isScreenSharing: true,
        pc: {
            getStats: () =>
                new Promise((resolve) => {
                    finish = resolve;
                }),
        },
    };
    api.sync(input);
    const panel = tile.children[0];
    panel.open = true;
    api.sync(input);
    await flush();
    const before = panel.children[2].textContent;
    api.remove(tile);
    finish(new Map());
    await flush();
    assert.equal(panel.children[2].textContent, before);
    input.pc = {
        getStats: async () => {
            throw Error('private IP');
        },
    };
    api.sync(input);
    const replacement = tile.children[1];
    replacement.open = true;
    api.sync(input);
    await flush();
    assert.match(replacement.children[2].textContent, /统计读取失败/);
    assert.doesNotMatch(replacement.children[2].textContent, /private IP/);
});
test('call log samples a collapsed share and keeps compositor callbacks alive until removal', async () => {
    const { api } = load();
    const tile = new Element();
    let callback, cancelled = 0, scheduled = 0;
    const video = {
        requestVideoFrameCallback(fn) { callback = fn; scheduled++; return scheduled; },
        cancelVideoFrameCallback() { cancelled++; },
    };
    const source = { tile, video, isScreenSharing: true, localAudioProcessing: { state: { speechGateEnabled: true, speechGateSupported: true } }, pc: { getStats: async () => new Map() } };
    const snapshot = await api.sync(source, { force: true });
    assert.equal(tile.children[0].open, false);
    assert.equal(snapshot.本机音频.非语音门控启用, true);
    callback(0, { presentedFrames: 10 });
    assert.equal(scheduled, 2);
    tile.children[0].listeners.toggle();
    assert.equal(cancelled, 0);
    api.remove(tile);
    assert.equal(cancelled, 1);
});

test('cached stats are invalidated on source replacement; late reads cannot revive the previous path', async () => {
    const { api } = load(); const tile = new Element(); let finish;
    const old = { tile, isScreenSharing: true, stream: {}, pc: { getStats: () => new Promise((resolve) => { finish = resolve; }) } };
    const pending = api.sync(old, { force: true }); await flush();
    const next = { ...old, stream: {}, pc: { screenRoute: 'SFU', getStats: async () => new Map() } };
    api.sync(next, { force: true });
    assert.equal(api.getCached(tile), undefined);
    finish(new Map()); assert.equal(await pending, undefined);
    await api.sync(next, { force: true });
    assert.equal(api.getCached(tile).连接[0].路径, 'SFU');
    api.remove(tile); assert.equal(api.getCached(tile), undefined);
});

test('metric availability distinguishes a first interval, unsupported counters, measured zero and repeated timestamps', () => {
    const { api } = load(); const row = { id: 'r', type: 'inbound-rtp', timestamp: 1000, framesDecoded: 3 };
    const first = api.summarize([], row);
    assert.equal(first.指标状态.区间解码帧率, '未采样'); assert.equal(first.指标状态.区间完整接收帧率, '未提供');
    const zero = api.summarize([], { ...row, timestamp: 2000 }, row);
    assert.equal(zero.区间解码帧率, 0); assert.equal(zero.指标状态.区间解码帧率, '已采样');
    assert.equal(api.summarize([], row, row).统计状态, '数据过期');
});

test('presentation callback stopped by a hidden panel can rearm on forced sampling for the same video', async () => {
    const { api } = load();
    const tile = new Element();
    let callback;
    let scheduled = 0;
    const video = { requestVideoFrameCallback(fn) { callback = fn; return ++scheduled; }, cancelVideoFrameCallback() {} };
    const input = { tile, video, isScreenSharing: true };
    api.sync(input);
    tile.children[0].open = true;
    await api.sync(input);
    tile.children[0].open = false;
    callback(0, { presentedFrames: 1 });
    assert.equal(scheduled, 1);
    await api.sync(input, { force: true });
    assert.equal(scheduled, 2);
    callback(0, { presentedFrames: 2 });
    assert.equal(scheduled, 3);
    api.remove(tile);
});

for (const [width, height, fps] of [[1920, 1080, 60], [2560, 1440, 60], [3840, 2160, 60], [1920, 1080, 30]]) {
    test(`AV1 metrics preserve actual dimensions and distinct capture/encode/send cadence ${width}x${height}@${fps}`, () => {
        const { api } = load();
        const before = { id: 'out', timestamp: 1000, framesEncoded: 100, framesSent: 100, bytesSent: 1000 };
        const after = { ...before, timestamp: 2000, type: 'outbound-rtp', kind: 'video', framesEncoded: 100 + fps - 5, framesSent: 100 + fps - 10, bytesSent: 1001000, frameWidth: width, frameHeight: height, codecId: 'av1', mediaSourceId: 'capture' };
        const captureBefore = { id: 'capture', timestamp: 1000, frames: 100 };
        const capture = { ...captureBefore, timestamp: 2000, frames: 100 + fps };
        const sample = api.summarize([{ id: 'av1', mimeType: 'video/AV1' }, capture], after, before, captureBefore);
        assert.equal(sample.编码, 'video/AV1');
        assert.equal(sample.宽, width); assert.equal(sample.高, height);
        assert.equal(sample.区间采集帧率, fps);
        assert.equal(sample.区间编码帧率, fps - 5);
        assert.equal(sample.区间发送帧率, fps - 10);
        assert.equal(sample.码率_Mbps, 8);
    });
}

test('presentation uses callback timestamps across independent collection clocks and visibility epochs', async () => {
    const { api, window } = load();
    const listeners = new Map();
    window.document.addEventListener = (name, fn) => listeners.set(name, fn);
    window.document.removeEventListener = (name, fn) => { assert.equal(listeners.get(name), fn); listeners.delete(name); };
    let now = 0, callback;
    window.performance = { now: () => now };
    const video = { requestVideoFrameCallback(fn) { callback = fn; return 1; }, cancelVideoFrameCallback() {} };
    const input = { tile: new Element(), video, isScreenSharing: true };
    const read = () => api.sync(input, { force: true });
    await read();
    callback(1000, { presentedFrames: 60 }); now = 1300;
    assert.equal((await read()).播放画面.提交合成器帧率, null);
    callback(2000, { presentedFrames: 120 }); now = 2010;
    assert.equal((await read()).播放画面.提交合成器帧率, 60, 'collector interval is only 710 ms');
    assert.equal((await read()).播放画面.提交合成器帧率, null, 'no new callback is not a measured zero');
    window.document.hidden = true; listeners.get('visibilitychange')();
    callback(2100, { presentedFrames: 125 }); now = 2200;
    assert.equal((await read()).播放指标状态, '后台不测量');
    window.document.hidden = false; listeners.get('visibilitychange')();
    callback(30000, { presentedFrames: 1800 }); now = 30001;
    assert.equal((await read()).播放画面.提交合成器帧率, null, 'discard background catch-up');
    callback(31000, { presentedFrames: 1860 }); now = 31001;
    assert.equal((await read()).播放画面.提交合成器帧率, 60);
    now = 35000;
    assert.equal((await read()).播放画面.提交合成器帧率, null, 'stale callback cannot imply current playback');
    input.stream = {};
    callback(35001, { presentedFrames: 2100 }); now = 35002;
    assert.equal((await read()).播放画面.提交合成器帧率, null, 'new stream resets the baseline');
    api.remove(input.tile);
    assert.equal(listeners.size, 0);
});

test('Piik derived connections replace unrelated PeerJS stats without collecting another media path', async () => {
    const { api } = load();
    const piikConnections = [{ 序号: 1, 状态: '已采样', 统计来源: 'Piik WebRTC stats', 视频流: [{ 编码: 'video/H264', 区间解码帧率: 60 }] }];
    const result = await api.sync({ tile: new Element(), isScreenSharing: true,
        piikConnections, pc: { getStats() { assert.fail('must not query voice connection'); } } }, { force: true });
    assert.equal(result.连接, piikConnections);
});

test('copying diagnostics immediately after a sample cannot turn one frame into a 60 FPS claim', async () => {
    const { api, window } = load();
    let now = 0, callback, dropped = 0;
    window.performance = { now: () => now };
    const video = { requestVideoFrameCallback(fn) { callback = fn; return 1; }, cancelVideoFrameCallback() {},
        getVideoPlaybackQuality() { return { droppedVideoFrames: dropped }; } };
    const input = { tile: new Element(), video, isScreenSharing: true };
    const read = () => api.sync(input, { force: true });
    await read();
    callback(1000, { presentedFrames: 60 }); now = 1000; await read();
    callback(2000, { presentedFrames: 110, processingDuration: 0.015,
        receiveTime: 1975, presentationTime: 1990, expectedDisplayTime: 1999 }); now = 2000; dropped = 10;
    const measured = (await read()).播放画面;
    assert.equal(measured.提交合成器帧率, 50);
    assert.equal(measured.最近帧解码准备_ms, 15);
    assert.equal(measured.最近帧收齐到提交_ms, 15);
    assert.equal(measured.最近帧回调滞后_ms, 1);
    callback(2016, { presentedFrames: 111 }); now = 2016;
    const immediate = await read();
    assert.equal(immediate.播放画面.提交合成器帧率, null);
    assert.equal(immediate.播放画面.区间播放丢帧, null);
    callback(3000, { presentedFrames: 160 }); now = 3000; dropped = 20;
    const next = await read();
    assert.equal(next.播放画面.提交合成器帧率, 50, 'short read must not consume the baseline');
    assert.equal(next.播放画面.区间播放丢帧, 10);
    assert.equal(next.播放画面.播放采样间隔_ms, 1000);
    api.remove(input.tile);
});

function controlledReads() {
    const context = load();
    const timers = new Map();
    let nextTimer = 0;
    context.window.setTimeout = (fn, delay) => {
        const id = ++nextTimer;
        timers.set(id, { fn, delay });
        return id;
    };
    context.window.clearTimeout = id => timers.delete(id);
    const requests = [];
    const pc = { getStats: () => new Promise((resolve, reject) => requests.push({ resolve, reject })) };
    const input = { tile: new Element(), isScreenSharing: true, stream: {}, pc };
    return { ...context, timers, requests, input };
}

for (const outcome of ['resolve', 'reject']) {
    test(`removing a share settles its pending stats before late ${outcome} and releases timers`, async () => {
        const { api, timers, requests, input, window } = controlledReads();
        let observed = 0, published = 0, settled = false;
        window.VoiceScreenCodecs = { observeConnection: () => observed++ };
        input.onSample = () => published++;
        const pending = api.sync(input, { force: true });
        pending.then(() => { settled = true; });
        await flush();
        assert.equal(timers.size, 1);
        api.remove(input.tile);
        await flush();
        const beforeLate = { settled, timers: timers.size };
        requests[0][outcome](outcome === 'resolve' ? new Map() : Error('late private stats'));
        const result = await pending;
        await flush();
        assert.deepEqual(beforeLate, { settled: true, timers: 0 });
        assert.equal(result, undefined);
        assert.equal(observed, 0);
        assert.equal(published, 0);
        assert.equal(api.getCached(input.tile), undefined);
    });
}

test('replacement starts new stats immediately and old cleanup cannot release its pending ownership', async () => {
    const { api, timers, requests, input } = controlledReads();
    const old = api.sync(input, { force: true });
    await flush();
    const next = { ...input, stream: {} };
    const current = api.sync(next, { force: true });
    await flush();
    const beforeLate = { reads: requests.length, timers: timers.size, distinct: current !== old };
    requests[0].resolve(new Map());
    await flush();
    const repeated = api.sync(next, { force: true });
    await flush();
    // Clean up even on the original implementation, which reuses the old read.
    for (const request of requests) request.resolve(new Map());
    await repeated;
    await current;
    api.remove(input.tile);
    assert.deepEqual(beforeLate, { reads: 2, timers: 1, distinct: true });
    assert.equal(repeated, current, 'old finally must not clear the current busy flag');
    assert.equal(await old, undefined);
    assert.equal(timers.size, 0);
});

test('removal before the stats microtask prevents querying the ended connection', async () => {
    const { api, timers, requests, input } = controlledReads();
    const pending = api.sync(input, { force: true });
    api.remove(input.tile);
    await flush();
    const reads = requests.length;
    for (const request of requests) request.resolve(new Map());
    await pending;
    assert.equal(reads, 0);
    assert.equal(timers.size, 0);
});

test('removal releases every pending outgoing stats read', async () => {
    const { api, timers, requests, input } = controlledReads();
    const outgoing = { ...input, isLocal: true, outgoingConnections: [input.pc, input.pc] };
    let settled = false;
    const pending = api.sync(outgoing, { force: true });
    pending.then(() => { settled = true; });
    await flush();
    assert.equal(timers.size, 2);
    api.remove(input.tile);
    await flush();
    const beforeLate = { settled, timers: timers.size };
    for (const request of requests) request.resolve(new Map());
    await pending;
    assert.deepEqual(beforeLate, { settled: true, timers: 0 });
});

test('current stats timeout is bounded and a following sample can recover', async () => {
    const { api, timers, requests, input } = controlledReads();
    const pending = api.sync(input, { force: true });
    await flush();
    const [timerId, timer] = [...timers][0];
    assert.equal(timer.delay, 2500);
    timers.delete(timerId);
    timer.fn();
    assert.match((await pending).连接[0].状态, /统计读取失败或超时/);
    const next = api.sync(input, { force: true });
    await flush();
    requests[1].resolve(new Map());
    assert.equal((await next).连接[0].状态, '等待视频统计');
    requests[0].reject(Error('late timeout rejection'));
    await flush();
    api.remove(input.tile);
    assert.equal(timers.size, 0);
});

function frameReads() {
    const context = load();
    let now = 0, nextId = 0;
    const scheduled = [], cancelled = [];
    context.window.performance = { now: () => now };
    const video = () => ({
        requestVideoFrameCallback(fn) {
            const id = ++nextId;
            scheduled.push({ id, fn, video: this });
            return id;
        },
        cancelVideoFrameCallback(id) { cancelled.push({ id, video: this }); },
    });
    const input = { tile: new Element(), video: video(), stream: {}, isScreenSharing: true };
    return { ...context, input, video, scheduled, cancelled, setNow: value => { now = value; } };
}

test('a late frame from a replaced video cannot erase the current callback handle', async () => {
    const { api, input, video, scheduled, cancelled } = frameReads();
    await api.sync(input, { force: true });
    const old = scheduled.at(-1);
    input.video = video();
    await api.sync(input, { force: true });
    const current = scheduled.at(-1);
    old.fn(1000, { presentedFrames: 900 });
    await api.sync(input, { force: true });
    const beforeRemoval = scheduled.length;
    api.remove(input.tile);
    assert.equal(beforeRemoval, 2, 'old callback must not cause another current callback to be registered');
    assert.equal(cancelled.at(-1).id, current.id);
    assert.equal(cancelled.at(-1).video, input.video);
});

test('A to B to A video reuse cannot revive the first video callback', async () => {
    const { api, input, video, scheduled, setNow } = frameReads();
    const firstVideo = input.video;
    await api.sync(input, { force: true });
    const old = scheduled.at(-1);
    input.video = video(); await api.sync(input, { force: true });
    input.video = firstVideo; await api.sync(input, { force: true });
    const current = scheduled.at(-1);
    old.fn(1000, { presentedFrames: 900, processingDuration: 0.9 }); setNow(1001);
    const stale = await api.sync(input, { force: true });
    const afterOld = scheduled.length;
    current.fn(2000, { presentedFrames: 60 }); setNow(2001);
    const first = await api.sync(input, { force: true });
    scheduled.at(-1).fn(3000, { presentedFrames: 120 }); setNow(3001);
    const measured = await api.sync(input, { force: true });
    api.remove(input.tile);
    assert.equal(afterOld, 3, 'obsolete A callback must not start a second callback chain');
    assert.equal(stale.播放画面.最近帧解码准备_ms, null);
    assert.equal(first.播放画面.提交合成器帧率, null);
    assert.equal(measured.播放画面.提交合成器帧率, 60);
});

test('changing streams on the same video discards the previously registered frame callback', async () => {
    const { api, input, scheduled, cancelled, setNow } = frameReads();
    await api.sync(input, { force: true });
    const old = scheduled.at(-1);
    input.stream = {};
    await api.sync(input, { force: true });
    const registrations = scheduled.length;
    const oldCancelled = cancelled.some(row => row.id === old.id);
    old.fn(1000, { presentedFrames: 900, processingDuration: 0.9 }); setNow(1001);
    const result = await api.sync(input, { force: true });
    api.remove(input.tile);
    assert.equal(registrations, 2);
    assert.equal(oldCancelled, true);
    assert.equal(result.播放画面.最近帧解码准备_ms, null);
    assert.equal(scheduled.length, 2);
});

test('closing and reopening sampling on the same video cannot revive its cancelled callback', async () => {
    const { api, input, scheduled, setNow } = frameReads();
    api.sync(input);
    const panel = input.tile.children[0]; panel.open = true;
    await api.sync(input);
    const old = scheduled.at(-1);
    panel.open = false; panel.listeners.toggle();
    panel.open = true; await api.sync(input);
    old.fn(1000, { presentedFrames: 900, processingDuration: 0.9 }); setNow(1001);
    const snapshot = await api.sync(input);
    const registrations = scheduled.length;
    api.remove(input.tile);
    assert.equal(registrations, 2);
    assert.equal(snapshot.播放画面.最近帧解码准备_ms, null);
});

test('a removed collector frame cannot disturb a new collector on the same tile and video', async () => {
    const { api, input, scheduled, cancelled } = frameReads();
    await api.sync(input, { force: true });
    const old = scheduled.at(-1); api.remove(input.tile);
    await api.sync(input, { force: true });
    const current = scheduled.at(-1);
    old.fn(1000, { presentedFrames: 900 });
    await api.sync(input, { force: true });
    api.remove(input.tile);
    assert.equal(scheduled.length, 2);
    assert.equal(cancelled.at(-1).id, current.id);
});
