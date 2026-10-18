import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { createVoiceDiagnosticsRelay } from '../src/utils/VoiceDiagnosticsRelay.js';
import { sanitizeVoiceDiagnostic } from '../src/views/js/shared/voice-diagnostic-schema.js';

function fixture() {
    let time = 10000;
    const sender = { id: 'sender', owner: { roomId: 'one', peerId: 'private-sender', voiceSessionGeneration: 1 } };
    const viewer = { id: 'viewer', owner: { roomId: 'one', peerId: 'private-viewer', voiceSessionGeneration: 1 },
        timeout() { return this; }, emit(event, payload, ack) { this.respond?.(event, payload, ack); } };
    let members = [sender, viewer];
    const relay = createVoiceDiagnosticsRelay({ io: { in: () => ({ fetchSockets: async () => members }) },
        getMembers: () => members, getVoiceOwner: (socket) => socket.owner, now: () => time });
    const report = { 当前状态: { 采样时间: '2026-10-18T09:12:00.000Z', 共享: [] },
        SFU接收健康: { 最近异常: [{ reason: 'receiver-video-stalled', 健康采样: [{ 接收字节增长: 9000, 解码帧增长: 0 }] }] }, deviceId: 'private-device' };
    const save = (generation = 1) => relay.checkpoint(viewer, { voiceSessionGeneration: generation, report });
    return { relay, sender, viewer, report, save, advance: (ms) => { time += ms; },
        setMembers: (next) => { members = next; } };
}

test('checkpoint survives departure, carries original sample time and expires after two minutes', async () => {
    const f = fixture();
    assert.equal(f.save(), true);
    f.advance(5000);
    f.viewer.owner = null;
    f.setMembers([f.sender]);
    const result = await f.relay.collect(f.sender);
    assert.equal(result.results.length, 1);
    assert.match(result.results[0].状态, /缓存.*已离开/);
    assert.equal(result.results[0].缓存年龄_ms, 5000);
    assert.equal(result.results[0].数据.当前状态.采样时间, '2026-10-18T09:12:00.000Z');
    assert.equal(result.results[0].数据.SFU接收健康.最近异常[0].健康采样[0].解码帧增长, 0);
    assert.doesNotMatch(JSON.stringify(result), /private/);
    f.advance(120001);
    assert.equal((await f.relay.collect(f.sender)).results.length, 0);
});

test('cache never crosses rooms, later joiners or a new voice session of the same socket', async () => {
    const f = fixture();
    assert.equal(f.save(99), false);
    assert.equal(f.save(), true);
    f.viewer.owner = null;
    const newcomer = { id: 'new', owner: { roomId: 'one', peerId: 'new-peer', voiceSessionGeneration: 1 } };
    f.setMembers([newcomer]);
    assert.equal((await f.relay.collect(newcomer)).results.length, 0);
    f.advance(11000);
    f.sender.owner.voiceSessionGeneration = 2;
    f.setMembers([f.sender]);
    assert.equal((await f.relay.collect(f.sender)).results.length, 0);
    f.sender.owner.roomId = 'two';
    assert.equal((await f.relay.collect(f.sender)).results.length, 0);
});

test('live samples win over cache, timeout falls back explicitly, and checkpoints are throttled', async () => {
    const f = fixture();
    assert.equal(f.save(), true);
    assert.equal(f.save(), false);
    f.viewer.respond = (_, payload, ack) => ack(null, { ok: true, voiceSessionGeneration: payload.voiceSessionGeneration,
        report: { 当前状态: { 状态: 'fresh' } } });
    assert.equal((await f.relay.collect(f.sender)).results[0].状态, '已采样');
    f.advance(11000);
    f.viewer.respond = (_, payload, ack) => ack(new Error('offline'));
    assert.match((await f.relay.collect(f.sender)).results[0].状态, /缓存.*未响应/);
});

test('default export removes repeated state and codec configuration while retaining measurements and full anomaly windows', () => {
    const window = {};
    vm.runInNewContext(readFileSync(new URL('../src/views/js/voice/voice-call-diagnostics.js', import.meta.url), 'utf8'), { window });
    const health = { 最近异常: [{ reason: 'receiver-video-stalled', 健康采样: Array(8).fill({ 解码帧增长: 0, 接收字节增长: 12000 }) }] };
    const state = { 采样时间: 'now', 共享: [{ 编码器选择: { probe: { windows: Array(20).fill({ reason: 'encoder-slow' }) } },
        连接: [{ 路径: 'SFU', 视频流: [{ 区间解码帧率: 0, 码率_Mbps: 18, 区间完整接收帧率: null }],
            发送参数核对: Array(8).fill({ 请求: { encodings: [{ maxBitrate: 22000000 }] } }) }] }] };
    const raw = { 当前状态: state, SFU接收健康: health,
        当前会话: { 当前状态: state, 历史采样: Array(24).fill(state), 事件: Array(200).fill({ 类型: '状态变化', 内容: state }) } };
    const compact = window.VoiceCallDiagnostics.compactReport(raw);
    assert.equal(compact.当前会话.当前状态, undefined);
    assert.equal(compact.当前会话.历史采样.length, 10);
    assert.equal(compact.当前会话.事件.length, 40);
    assert.equal(compact.当前会话.历史采样[0].共享[0].编码器选择, undefined);
    assert.equal(compact.当前会话.历史采样[0].共享[0].连接[0].视频流[0].区间解码帧率, 0);
    assert.equal(compact.当前会话.历史采样[0].共享[0].连接[0].视频流[0].区间完整接收帧率, null);
    assert.equal(compact.当前状态, state);
    assert.deepEqual(sanitizeVoiceDiagnostic(compact).SFU接收健康, health);
    assert.ok(JSON.stringify(compact).length < JSON.stringify(raw).length / 4);
    assert.equal(raw.当前会话.历史采样.length, 24, 'full local history stays intact');
});
