import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticConnection } from '../integrations/piik/diagnostics.ts';
import { sanitizeVoiceDiagnostic } from '../src/views/js/shared/voice-diagnostic-schema.js';

const snapshot = { connectionState: 'connected', iceConnectionState: 'connected',
    peerId: 'secret-peer', connectionId: 'secret-connection',
    metrics: { sampleTimestampMs: 10000, sampleWindowMs: 2000, codec: 'video/H264',
        framesPerSecond: 60, intervalFramesDecoded: 120, intervalFramesEncoded: 120,
        intervalFramesSent: 110, bitrateKbps: 8000, frameWidth: 1920, frameHeight: 1080,
        localCandidateType: 'host', remoteCandidateType: 'srflx',
        remoteCandidateAddress: 'secret-address', encoderImplementation: 'not-exported',
        powerEfficientEncoder: true, packetLossPercent: 0 } };

test('Piik viewer diagnostics preserve derived codec, interval decode, bitrate and actual path without IDs', () => {
    const row = diagnosticConnection(snapshot, false, false, 50);
    assert.equal(row.状态, '已采样');
    assert.equal(row.实际传输路径, 'P2P');
    const video = row.视频流[0];
    assert.equal(video.区间解码帧率, 60);
    assert.equal(video.码率_Mbps, 8);
    assert.equal(video['区间丢包率_%'], 0);
    assert.equal(video.编码, 'video/H264');
    assert.doesNotMatch(JSON.stringify(row), /secret|not-exported/);
    assert.equal(sanitizeVoiceDiagnostic(row).统计来源, 'Piik WebRTC stats');
});

test('native output is not mislabeled as measured capture, hardware or encode timing; stale rates become null', () => {
    const row = diagnosticConnection(snapshot, true, true, 100);
    assert.match(row.视频流[0].帧率口径, /原生输出/);
    assert.equal(row.视频流[0].实际帧率, 60);
    assert.equal(row.视频流[0].区间编码帧率, null);
    assert.equal(row.视频流[0].编码能效报告, null);
    assert.equal(row.视频流[0].每帧编解码_ms, null);
    const stale = diagnosticConnection(snapshot, true, true, 11000);
    assert.equal(stale.状态, '数据过期');
    assert.equal(stale.视频流[0].实际帧率, null);
    assert.equal(stale.视频流[0].码率_Mbps, null);
    assert.equal(diagnosticConnection({ ...snapshot, metrics: { sampleTimestampMs: null } }, true, true, 0).状态, '等待视频统计');
});
