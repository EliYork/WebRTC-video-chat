import type { PeerSnapshot } from './.deps/upstream/src/client/types';

// Consume upstream's derived measurements through its public snapshots. Never
// reach into private PeerConnections or export addresses, SDP, IDs or raw stats.
export function diagnosticConnection(
    snapshot: PeerSnapshot,
    sending: boolean,
    native: boolean,
    ageMs: number
) {
    const m = snapshot.metrics;
    const finite = (n: unknown): number | null => typeof n === 'number' && Number.isFinite(n) ? n : null;
    const round = (n: number | null) => n === null ? null : Math.round(n * 100) / 100;
    const fresh = ageMs <= 10000 && finite(m.sampleTimestampMs) !== null;
    const metric = (n: unknown) => fresh ? finite(n) : null;
    const rate = (n: unknown) => metric(n) !== null && m.sampleWindowMs && m.sampleWindowMs > 0
        ? round(metric(n)! * 1000 / m.sampleWindowMs) : null;
    return {
        路径: 'Piik P2P',
        实际传输路径: m.localCandidateType === 'relay' || m.remoteCandidateType === 'relay' ? 'TURN' :
            m.localCandidateType && m.remoteCandidateType ? 'P2P' : 'unknown',
        连接状态: snapshot.connectionState,
        ICE状态: snapshot.iceConnectionState,
        统计来源: native ? 'Piik 原生 edge-quality' : 'Piik WebRTC stats',
        统计年龄_ms: round(ageMs),
        状态: !fresh ? finite(m.sampleTimestampMs) === null ? '等待视频统计' : '数据过期' : '已采样',
        视频流: [{
            统计状态: fresh ? '已采样' : finite(m.sampleTimestampMs) === null ? '未采样' : '数据过期',
            方向: sending ? '发送' : '接收',
            编码: /^video\/(H264|VP8|VP9|AV1|H265)$/i.test(m.codec || '') ? m.codec : null,
            宽: finite(m.frameWidth), 高: finite(m.frameHeight),
            实际帧率: metric(m.framesPerSecond),
            原生输出帧率: native ? metric(m.framesPerSecond) : null,
            帧率口径: native ? '原生输出帧率（不是独立采集或编码计时）' : sending ? '编码帧率' : '解码帧率',
            采样间隔_ms: metric(m.sampleWindowMs),
            区间编码帧率: sending && !native ? rate(m.intervalFramesEncoded) : null,
            区间发送帧率: sending && !native ? rate(m.intervalFramesSent) : null,
            区间解码帧率: !sending ? rate(m.intervalFramesDecoded) : null,
            码率_Mbps: metric(m.bitrateKbps) === null ? null : round(m.bitrateKbps! / 1000),
            码率口径: native ? '音视频合计' : '视频 RTP',
            每帧编解码_ms: native ? null : metric(sending ? m.intervalEncodeMs : m.intervalDecodeMs),
            往返延迟_ms: metric(m.rttMs), 抖动_ms: metric(m.jitterMs),
            '区间丢包率_%': metric(m.packetLossPercent),
            区间解码丢帧: !sending ? metric(m.intervalFramesDropped) : null,
            区间卡顿次数: !sending ? metric(m.intervalFreezeCount) : null,
            区间卡顿时长_ms: !sending ? metric(m.intervalFreezeDurationMs) : null,
            // Upstream infers this for native H.264. That inference is not
            // evidence of the hardware adapter actually used by this session.
            编码能效报告: !native && typeof m.powerEfficientEncoder === 'boolean' ? m.powerEfficientEncoder : null,
        }],
    };
}
