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
    return { api: window.VoiceShareDiagnostics };
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
    assert.equal(snapshot.诊断格式, 4);
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
