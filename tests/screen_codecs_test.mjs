/* eslint-disable no-await-in-loop -- Virtual clock events and resource retirement must run in order. */
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/views/js/voice/voice-screen-codecs.js', import.meta.url), 'utf8');
const available = [
    { mimeType: 'video/H264', sdpFmtpLine: 'packetization-mode=1;profile-level-id=42e01f' },
    { mimeType: 'video/VP8' },
];
const load = (overrides = {}) => {
    const window = { setTimeout, clearTimeout, setInterval, clearInterval,
        RTCRtpSender: { getCapabilities: () => ({ codecs: available }) }, ...overrides };
    vm.runInNewContext(source, { window });
    return window.VoiceScreenCodecs;
};
const track = () => ({ kind: 'video', readyState: 'live', getSettings: () => ({ width: 1920, height: 1080 }) });
const target = { width: 1920, height: 1080, frameRate: 60 };
const report = (overrides = {}) => ({ id: 'out', sourceId: 'source', timestamp: 1000, encoded: 60, captured: 60,
    width: 1920, height: 1080, codec: 'video/H264', ...overrides });

test('H264 gate rejects 50fps, capture starvation, scaled output, wrong codec and missing/reset stats', () => {
    const api = load();
    const before = report();
    const after = report({ timestamp: 2000, encoded: 120, captured: 120 });
    assert.equal(api.evaluateWindow(before, after, target).passed, true);
    assert.equal(api.evaluateWindow(before, { ...after, encoded: 110 }, target).reason, 'encoder-slow');
    assert.equal(api.evaluateWindow(before, { ...after, captured: 110 }, target).reason, 'probe-source-slow');
    assert.equal(api.evaluateWindow(before, { ...after, width: 1280 }, target).reason, 'resolution-reduced');
    assert.equal(api.evaluateWindow(before, { ...after, codec: 'video/VP8' }, target).reason, 'codec-mismatch');
    for (const changes of [{ sourceId: 'old' }, { encoded: 0 }, { timestamp: 0 }, { captured: undefined }])
        assert.equal(api.evaluateWindow(before, { ...after, ...changes }, target).reason, 'missing-stats');
});

test('auto uses measured result, manual H264 retains failed probe evidence, VP8 skips probe, retired sources cannot register', async () => {
    const api = load();
    for (const passed of [true, false]) {
        const input = track();
        const result = await api.prepare(input, { frameRate: 60 }, { probe: async () => ({ passed, reason: passed ? 'passed' : 'encoder-slow', windows: [] }) });
        assert.equal(result.primary, passed ? 'h264' : 'vp8');
        assert.equal(api.getDecision(input), result);
    }
    const manual = await api.prepare(track(), { codecMode: 'h264' }, { probe: async () => ({ passed: false, reason: 'encoder-slow' }) });
    assert.equal(manual.primary, 'h264');
    assert.equal(manual.probe.reason, 'encoder-slow');
    let calls = 0;
    assert.equal((await api.prepare(track(), { codecMode: 'vp8' }, { probe: async () => { calls++; } })).primary, 'vp8');
    assert.equal(calls, 0);
    const retired = track();
    const controller = new AbortController();
    await api.prepare(retired, {}, { signal: controller.signal, probe: async () => { controller.abort(); return { passed: true }; } });
    assert.equal(api.getDecision(retired), undefined);
    const unsupported = load({ RTCRtpSender: { getCapabilities: () => ({ codecs: [available[1]] }) } });
    assert.equal((await unsupported.prepare(track(), { codecMode: 'h264' })).primary, 'vp8');
    assert.equal(unsupported.normalizeMode('av1'), 'auto', 'future codecs are not enabled prematurely');
});

const offer = [
    'v=0', 'm=audio 9 UDP/TLS/RTP/SAVPF 111', 'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=10;useinbandfec=1',
    'm=video 9 UDP/TLS/RTP/SAVPF 96 97 98 99 100',
    'a=rtpmap:96 VP8/90000', 'a=rtpmap:97 rtx/90000', 'a=fmtp:97 apt=96',
    'a=rtpmap:98 H264/90000', 'a=fmtp:98 packetization-mode=1;profile-level-id=42e01f',
    'a=rtpmap:99 rtx/90000', 'a=fmtp:99 apt=98', 'a=rtpmap:100 AV1/90000', 'a=rtcp-fb:100 nack',
    'a=rtcp-fb:* transport-cc', 'a=mid:video', '',
].join('\r\n');

test('P2P offer preserves audio, feedback, mids and matching RTX; H264 includes VP8 compatibility fallback', () => {
    const api = load();
    const h264 = api.transformOffer(offer, 'h264');
    assert.match(h264, /m=video 9 UDP\/TLS\/RTP\/SAVPF 98 96 97 99/);
    const vp8 = api.transformOffer(offer, 'vp8');
    assert.match(vp8, /m=video 9 UDP\/TLS\/RTP\/SAVPF 96 97\r\n/);
    assert.doesNotMatch(vp8, /rtpmap:98|apt=98|AV1/);
    for (const value of [h264, vp8]) {
        assert.equal(value.split('m=video')[0], offer.split('m=video')[0]);
        assert.match(value, /a=rtcp-fb:\* transport-cc/);
        assert.match(value, /a=mid:video/);
    }
    assert.equal(api.transformOffer(offer, undefined), offer, 'ordinary camera offers are unchanged');
    assert.equal(api.findCodec([{ mimeType: 'video/H264', parameters: { 'packetization-mode': 1 } }, available[1]], 'h264').mimeType, 'video/H264');
    assert.equal(api.findCodec([available[1]], 'h264').mimeType, 'video/VP8');
});

const flush = async () => { for (let index = 0; index < 100; index++) await Promise.resolve(); };
function probeFixture({ stall = false, encodeRate = 60, scale = false } = {}) {
    let now = 0;
    let nextId = 0;
    const timers = new Map();
    let stops = 0;
    const peers = [];
    let frames = 0;
    const timer = (callback, ms, interval) => { const id = ++nextId; timers.set(id, { callback, at: now + ms, ms: interval ? ms : 0 }); return id; };
    const canvas = { width: 0, height: 0, getContext: () => ({ fillRect() {} }), captureStream: () => ({
        getVideoTracks: () => [{ requestFrame() { frames++; }, stop() { stops++; } }],
        getTracks: () => [{ stop() { stops++; } }],
    }) };
    class Pc {
        constructor(config) { assert.equal(config.iceServers.length, 0); peers.push(this); }
        close() { this.closed = true; }
        addTransceiver(input) {
            this.input = input;
            const sender = { getParameters: () => ({ encodings: [{}] }), setParameters: async (parameters) => {
                assert.equal(parameters.degradationPreference, 'maintain-resolution');
                assert.equal(parameters.encodings[0].scaleResolutionDownBy, 1);
            } };
            return { sender, setCodecPreferences(codecs) { assert.ok(codecs.some((codec) => codec.mimeType === 'video/H264')); } };
        }
        createOffer() { return stall ? new Promise(() => {}) : Promise.resolve({ sdp: 'offer' }); }
        async createAnswer() { return { sdp: 'answer' }; }
        async setLocalDescription(value) { this.localDescription = value; }
        async setRemoteDescription(value) { this.remoteDescription = value; }
        async addIceCandidate() {}
        async getStats() { return new Map([
            ['out', { type: 'outbound-rtp', kind: 'video', id: 'out', timestamp: now, codecId: 'codec', mediaSourceId: 'input',
                framesEncoded: Math.floor(frames * encodeRate / 60), frameWidth: scale ? 1280 : canvas.width, frameHeight: canvas.height }],
            ['input', { id: 'input', type: 'media-source', frames }], ['codec', { id: 'codec', mimeType: 'video/H264' }],
        ]); }
    }
    const api = load({ RTCPeerConnection: Pc, document: { createElement: () => canvas },
        setTimeout: (callback, ms) => timer(callback, ms, false), setInterval: (callback, ms) => timer(callback, ms, true),
        clearTimeout: (id) => timers.delete(id), clearInterval: (id) => timers.delete(id) });
    const advance = async (ms) => {
        const end = now + ms;
        await flush();
        while (true) {
            const entry = [...timers].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
            if (!entry) break;
            const [id, value] = entry;
            now = value.at;
            if (value.ms) value.at += value.ms; else timers.delete(id);
            value.callback();
            await flush();
        }
        now = end;
        await flush();
    };
    return { api, advance, peers, timers, stops: () => stops };
}

for (const settings of [{}, { encodeRate: 50 }, { scale: true }]) {
    test(`real probe orchestration requires two full-size cadence windows and disposes all resources ${JSON.stringify(settings)}`, async () => {
        const f = probeFixture(settings);
        const pending = f.api.probeH264(target);
        await f.advance(3000);
        const result = await pending;
        assert.equal(result.passed, !settings.encodeRate && !settings.scale);
        assert.equal(result.windows.length, 2);
        assert.equal(f.timers.size, 0);
        assert.equal(f.stops(), 1);
        assert.ok(f.peers.every((pc) => pc.closed));
    });
}

test('hung negotiation times out; cancellation closes peers immediately and cannot restart the probe', async () => {
    const f = probeFixture({ stall: true });
    const pending = f.api.probeH264(target);
    await f.advance(6600);
    assert.equal((await pending).reason, 'timeout');
    assert.equal(f.timers.size, 0);
    assert.equal(f.stops(), 1);
    assert.ok(f.peers.every((pc) => pc.closed));
    const cancelled = probeFixture();
    const controller = new AbortController();
    const result = cancelled.api.probeH264(target, { signal: controller.signal });
    controller.abort();
    await cancelled.advance(7000);
    assert.equal((await result).reason, 'cancelled');
    assert.equal(cancelled.timers.size, 0);
    assert.equal(cancelled.stops(), 1);
    assert.ok(cancelled.peers.every((pc) => pc.closed));
});
