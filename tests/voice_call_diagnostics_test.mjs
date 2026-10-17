import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { sanitizeVoiceDiagnostic } from '../src/views/js/shared/voice-diagnostic-schema.js';
import { createVoiceDiagnosticsRelay } from '../src/utils/VoiceDiagnosticsRelay.js';
/* eslint-disable no-await-in-loop -- Exercise sequential samples and call lifecycles. */

const source = readFileSync(new URL('../src/views/js/voice/voice-call-diagnostics.js', import.meta.url), 'utf8');
function fixture({ storage, connections = [], shares = [], getReceiverHealth } = {}) {
    const timers = new Map();
    let id = 0;
    const state = { 会话: { state: 'joined', generation: 1 }, 本机音频: { 请求模式: 'rnnoise', 静音: true, deviceId: 'secret-device' } };
    const saved = new Map();
    const window = {
        navigator: { userAgent: 'Mozilla Windows Chrome/141.0 Edg/141.0' },
        document: { hidden: false },
        setTimeout(fn) { timers.set(++id, fn); return id; },
        clearTimeout(key) { timers.delete(key); },
        localStorage: storage || { getItem: (key) => saved.get(key), setItem: (key, value) => saved.set(key, value) },
        VoiceShareDiagnostics: { sync: async (share, options) => { assert.equal(options.force, true); return share; } },
    };
    vm.runInNewContext(source, { window });
    const runtime = window.VoiceCallDiagnostics.createRuntime({ sanitize: sanitizeVoiceDiagnostic, getState: () => state, getConnections: () => connections, getSources: () => shares, getReceiverHealth });
    return { runtime, state, saved, window, timers };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('per-call logs persist bounded history, preserve startup samples, and omit IDs', async () => {
    const { runtime, saved, state } = fixture();
    runtime.start();
    await flush();
    for (let i = 0; i < 220; i++) runtime.record('切换', { state: 'joined', peerId: 'secret-peer', error: 'secret-error' });
    for (let i = 0; i < 30; i++) { state.本机音频.麦克风增益_百分比 = i; await runtime.sample(); }
    const report = await runtime.report();
    assert.equal(report.当前会话.事件.length, 200);
    assert.equal(report.当前会话.历史采样.length, 24);
    assert.equal(report.当前会话.历史采样[1].本机音频.麦克风增益_百分比, 0);
    assert.equal(report.当前会话.历史采样.at(-1).本机音频.麦克风增益_百分比, 29);
    assert.equal(report.当前会话.截断, true);
    runtime.end('user-leave');
    const text = [...saved.values()][0];
    assert.doesNotMatch(text, /secret/);
    assert.match(text, /user-leave/);
    for (let i = 0; i < 6; i++) { runtime.start(); await flush(); runtime.end(); }
    assert.equal(JSON.parse([...saved.values()][0]).length, 5);
    runtime.clearLogs();
    assert.equal([...saved.values()][0], '[]');
    runtime.destroy();
});

test('audio interval diagnostics keep zeros, concealment and jitter separate from video', () => {
    const { window } = fixture();
    const prev = { timestamp: 1000, bytesReceived: 0, packetsLost: 0, packetsReceived: 0, totalSamplesReceived: 0, concealedSamples: 0, jitterBufferEmittedCount: 0, jitterBufferDelay: 0, totalAudioEnergy: 0, totalSamplesDuration: 0 };
    const row = { ...prev, type: 'inbound-rtp', timestamp: 2000, bytesReceived: 8000, packetsReceived: 49, packetsLost: 1, totalSamplesReceived: 48000, concealedSamples: 480, jitterBufferEmittedCount: 48000, jitterBufferDelay: 2400, audioLevel: 0, source: null, totalAudioEnergy: 0.04, totalSamplesDuration: 1 };
    prev.source = { ...prev };
    const result = window.VoiceCallDiagnostics.audioSummary([], row, prev);
    assert.equal(result['区间丢包率_%'], 2);
    assert.equal(result['隐藏样本比例_%'], 1);
    assert.equal(result.音量, 0);
    assert.equal(result.能量均方根, 0.2);
    assert.equal(result.每样本缓冲平均等待_ms, 50);
    assert.equal(window.VoiceCallDiagnostics.audioSummary([], row).码率_Mbps, null);
});

test('capture exclusion and actual playout topology survive sanitizing; quiet residual energy remains measurable', () => {
    const report = sanitizeVoiceDiagnostic({
        共享音频采集: { 捕获来源: 'monitor', 实际排除通话声音: null, 排除通话声音支持: true, 音频轨道数: 1, deviceId: 'secret' },
        输出播放: [{ 语音播放: { 原生静音: true, WebAudio放大: true, 重复播放风险: false, trackId: 'secret' } }],
    });
    assert.equal(report.共享音频采集.实际排除通话声音, null);
    assert.equal(report.输出播放[0].语音播放.重复播放风险, false);
    assert.doesNotMatch(JSON.stringify(report), /secret/);
    const { window } = fixture();
    const result = window.VoiceCallDiagnostics.audioSummary([], {
        type: 'inbound-rtp', timestamp: 2000, totalSamplesDuration: 2, totalAudioEnergy: 0.000002,
    }, { timestamp: 1000, source: { totalSamplesDuration: 1, totalAudioEnergy: 0.000001 } });
    assert.equal(result.能量均方根, 0.001);
});

test('collection ignores stale replies and reports unavailable storage without failing call', async () => {
    let finish;
    const pc = { getStats: () => new Promise((resolve) => { finish = resolve; }) };
    const { runtime, state } = fixture({ storage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }, connections: [pc] });
    runtime.start();
    await flush();
    const socket = { connected: true, on(event, handler) { this.handler = handler; }, off() {}, timeout() { return this; }, emit(event, ack) { this.ack = ack; } };
    runtime.attachSocket(socket);
    let ack;
    const request = socket.handler({ voiceSessionGeneration: 1 }, (value) => { ack = value; });
    runtime.end();
    state.会话.generation = 2;
    finish(new Map());
    await request;
    pc.getStats = async () => new Map();
    assert.equal(ack.ok, false);
    assert.match((await runtime.report()).存储状态, /失败/);
    runtime.destroy();
});

test('both-side collection marks peer failure and does not export past sessions', async () => {
    const { runtime } = fixture();
    runtime.start();
    await flush();
    const socket = { connected: true, on() {}, off() {}, timeout() { return this; }, emit(_, ack) { ack(null, { ok: true, results: [{ 序号: 1, 状态: '未响应' }], omitted: 0 }); } };
    runtime.attachSocket(socket);
    const data = await runtime.collectCombined();
    assert.equal(data.对端[0].状态, '未响应');
    assert.equal(data.本机.诊断格式, 4);
    assert.ok(data.本机.当前会话);
    assert.equal(data.本机.通话, undefined);
    runtime.destroy();
});

function relayFixture() {
    let time = 10000;
    const self = { id: 'self', owner: { roomId: 'one', peerId: 'self-peer', voiceSessionGeneration: 1 } };
    const member = { id: 'member', owner: { roomId: 'one', peerId: 'member-peer', voiceSessionGeneration: 1 }, timeout() { return this; }, emit(event, payload, ack) { this.respond?.(event, payload, ack); } };
    const foreign = { id: 'foreign', owner: { roomId: 'two', voiceSessionGeneration: 1 } };
    const api = createVoiceDiagnosticsRelay({ io: { in: () => ({ fetchSockets: async () => [self, member, foreign] }) }, getVoiceOwner: (socket) => socket.owner ? { ...socket.owner } : null, now: () => time });
    return { api, self, member, advance: () => { time += 11000; } };
}

test('relay restricts to voice owners, checks generations, rate limits and scrubs remote data', async () => {
    const { api, self, member, advance } = relayFixture();
    assert.equal((await api.collect({})).reason, 'not-in-voice');
    member.respond = (_, payload, ack) => ack(null, { ok: true, voiceSessionGeneration: payload.voiceSessionGeneration, report: { 当前状态: { 本机音频: { AEC: 'all', deviceId: 'secret' } }, ip: 'secret' } });
    const data = await api.collect(self);
    assert.equal(data.results.length, 1);
    assert.equal(data.results[0].数据.当前状态.本机音频.AEC, 'all');
    assert.doesNotMatch(JSON.stringify(data), /secret/);
    assert.equal((await api.collect(self)).reason, 'rate-limited');
    advance();
    member.respond = (_, __, ack) => ack(new Error('timeout'));
    assert.match((await api.collect(self)).results[0].状态, /未响应/);
    advance();
    member.respond = (_, payload, ack) => { member.owner.voiceSessionGeneration++; ack(null, { ok: true, voiceSessionGeneration: payload.voiceSessionGeneration, report: {} }); };
    assert.equal((await api.collect(self)).results[0].状态, '会话已变化');
});

test('schema bounds payload depth, arrays and strings and drops sensitive fields recursively', () => {
    const value = sanitizeVoiceDiagnostic({ 事件: Array.from({ length: 300 }, () => ({ 内容: { state: 'x'.repeat(300), deviceId: 'secret', rawStats: 'secret' } })) });
    assert.equal(value.事件.length, 250);
    assert.equal(value.事件[0].内容.state.length, 160);
    assert.doesNotMatch(JSON.stringify(value), /secret/);
});

test('SFU health is exported once outside periodic snapshots and its failure window persists after switching to P2P', async () => {
    const failure = { 序号: 1, reason: 'receiver-video-stalled', 健康采样: [{ 采样时间_ms: 1000,
        连续低帧次数: 3, 接收字节增长: 10, 解码帧增长: 0, 停滞线索: '本端收到数据但未解码出帧', ip: 'secret' }] };
    const { runtime, saved } = fixture({ getReceiverHealth: () => ({ 活跃接收: [], 最近回退: [failure] }) });
    runtime.start();
    await flush();
    runtime.record('SFU接收回退诊断', failure);
    const report = await runtime.report();
    assert.equal(report.SFU接收健康.最近回退[0].健康采样[0].解码帧增长, 0);
    assert.equal(report.当前状态.SFU接收健康, undefined);
    assert.ok(report.当前会话.历史采样.every((sample) => sample.SFU接收健康 === undefined));
    const { api, self, member } = relayFixture();
    member.respond = (_, payload, ack) => ack(null, { ok: true, voiceSessionGeneration: payload.voiceSessionGeneration, report });
    const relayed = await api.collect(self);
    assert.equal(relayed.results[0].数据.SFU接收健康.最近回退[0].健康采样[0].接收字节增长, 10);
    runtime.end();
    const stored = JSON.parse([...saved.values()][0]);
    assert.equal(stored[0].事件.find((event) => event.类型 === 'SFU接收回退诊断').内容.健康采样[0].连续低帧次数, 3);
    assert.doesNotMatch(JSON.stringify([report, relayed, stored]), /secret/);
    runtime.destroy();
});

test('a receiver fallback during export sampling is included in that same report', async () => {
    let finish;
    let health = { 接收健康格式: 1, 活跃接收: [], 最近回退: [] };
    const pc = { getStats: () => new Promise((resolve) => { finish = resolve; }) };
    const { runtime } = fixture({ connections: [pc], getReceiverHealth: () => health });
    runtime.start();
    await flush();
    const pending = runtime.report();
    health = { ...health, 最近回退: [{ 序号: 1, reason: 'receiver-video-stalled', 健康采样: [{ 解码帧增长: 0 }] }] };
    runtime.record('SFU接收回退诊断', health.最近回退[0]);
    finish(new Map());
    assert.equal((await pending).SFU接收健康.最近回退.length, 1);
    runtime.destroy();
});

test('full receiver windows survive the shared node budget before oversized histories are truncated', () => {
    const sample = { 采样时间_ms: 1000, 解码帧数: 100, 完整接收帧数: 100, 接收统计间隔_ms: 2000,
        区间解码帧率: 0, 判定解码帧率: 0, 连续低帧次数: 3, 接收字节增长: 10,
        解码帧增长: 0, 服务器入站字节增长: 20, 服务器出站字节增长: 20 };
    const health = { 接收健康格式: 1,
        活跃接收: Array.from({ length: 8 }, (_, i) => ({ 序号: i + 1, 健康采样: Array(8).fill(sample) })),
        最近回退: Array.from({ length: 3 }, (_, i) => ({ 序号: i + 9, reason: 'receiver-video-stalled', 健康采样: Array(8).fill(sample) })) };
    const report = { SFU接收健康: health, 当前会话: { 历史采样: Array(24).fill({
        共享: Array(8).fill({ 连接: Array(16).fill({ 视频流: Array(16).fill(sample) }) }),
    }) } };
    const safe = sanitizeVoiceDiagnostic(report);
    assert.equal(safe.截断, true, 'the existing 16000-node budget still caps unrelated large histories');
    assert.deepEqual(safe.SFU接收健康, health);
    assert.deepEqual(sanitizeVoiceDiagnostic(safe).SFU接收健康, health);
    assert.ok(Buffer.byteLength(JSON.stringify(safe.SFU接收健康)) < 128 * 1024);
});
