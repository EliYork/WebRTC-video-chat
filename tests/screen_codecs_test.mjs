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
    vm.runInNewContext(source, { window, Date: overrides.Date || Date });
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
    assert.equal(unsupported.normalizeMode('av1'), 'av1', 'AV1 is explicitly opt-in');
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
function probeFixture({ stall = false, encodeRate = 60, scale = false, primary = 'h264' } = {}) {
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
            return { sender, setCodecPreferences(codecs) { assert.ok(codecs.some((codec) => codec.mimeType === (primary === 'av1' ? 'video/AV1' : 'video/H264'))); } };
        }
        createOffer() { return stall ? new Promise(() => {}) : Promise.resolve({ sdp: 'offer' }); }
        async createAnswer() { return { sdp: 'answer' }; }
        async setLocalDescription(value) { this.localDescription = value; }
        async setRemoteDescription(value) { this.remoteDescription = value; }
        async addIceCandidate() {}
        async getStats() { return new Map([
            ['out', { type: 'outbound-rtp', kind: 'video', id: 'out', timestamp: now, codecId: 'codec', mediaSourceId: 'input',
                framesEncoded: Math.floor(frames * encodeRate / 60), frameWidth: scale ? 1280 : canvas.width, frameHeight: canvas.height }],
            ['input', { id: 'input', type: 'media-source', frames }], ['codec', { id: 'codec', mimeType: primary === 'av1' ? 'video/AV1' : 'video/H264' }],
        ]); }
    }
    const api = load({ RTCRtpSender: { getCapabilities: () => ({ codecs: [...available, { mimeType: 'video/AV1' }] }) }, RTCPeerConnection: Pc, document: { createElement: () => canvas }, Date: { now: () => now },
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
test('recent full measured trials are reused only for matching dimensions/FPS and expire after 30 seconds', async () => {
    const f = probeFixture({ encodeRate: 50 });
    const first = f.api.prepare(track(), { frameRate: 60 });
    await f.advance(3000);
    assert.equal((await first).probe.reason, 'encoder-slow');
    const resources = f.peers.length;
    assert.equal((await f.api.prepare(track(), { frameRate: 60 })).probe.cacheHit, true);
    assert.equal(f.peers.length, resources);
    const changed = f.api.prepare(track(), { frameRate: 30 });
    await f.advance(3000);
    assert.equal((await changed).probe.cacheHit, undefined);
    assert.equal(f.peers.length, resources + 2);
    await f.advance(31000);
    const expired = f.api.prepare(track(), { frameRate: 60 });
    await f.advance(3000);
    assert.equal((await expired).probe.cacheHit, undefined);
    assert.equal(f.peers.length, resources + 4);
    assert.equal(f.timers.size, 0);
});
test('timeouts never populate the measured trial cache', async () => {
    const f = probeFixture({ stall: true });
    const first = f.api.prepare(track());
    await f.advance(6600);
    assert.equal((await first).probe.reason, 'timeout');
    const second = f.api.prepare(track());
    await f.advance(6600);
    assert.equal((await second).probe.cacheHit, undefined);
    assert.equal(f.peers.length, 4);
    assert.equal(f.timers.size, 0);
});

for (const settings of [{}, { encodeRate: 35 }, { scale: true }, { stall: true }]) {
    test(`AV1 loopback uses real orchestration, measured format/dimensions and bounded cleanup ${JSON.stringify(settings)}`, async () => {
        const f = probeFixture({ ...settings, primary: 'av1' });
        const pending = f.api.prepare(track(), { codecMode: 'av1', frameRate: 60 });
        await f.advance(settings.stall ? 6600 : 3000);
        const result = await pending;
        assert.equal(result.primary, Object.keys(settings).length ? 'h264' : 'av1');
        assert.equal(result.trials[0].reason, settings.stall ? 'timeout' : settings.scale ? 'resolution-reduced' : settings.encodeRate ? 'encoder-slow' : 'passed');
        if (!settings.stall) assert.equal(result.trials[0].windows[0].actualCodec, 'video/AV1');
        assert.ok(f.peers.every((pc) => pc.closed));
        assert.equal(f.stops(), 1);
        assert.equal(f.timers.size, 0);
    });
}

test('AV1 preference checks sending capability, keeps auto unchanged and preserves AV1 RTX/profile/feedback', async () => {
    const api = load({ RTCRtpSender: { getCapabilities: () => ({ codecs: [...available, { mimeType: 'video/AV1' }] }) } });
    const av1 = await api.prepare(track(), { codecMode: 'av1' }, { probe: async () => ({ passed: true, reason: 'passed' }) });
    assert.equal(av1.primary, 'av1');
    assert.equal(av1.support.av1Send, true);
    assert.equal(av1.support.av1Receive, null);
    assert.equal(av1.hardwareAcceleration, 'unknown');
    assert.equal((await api.prepare(track(), {}, { probe: async () => ({ passed: true }) })).primary, 'h264');
    const noAV1 = load();
    assert.equal((await noAV1.prepare(track(), { codecMode: 'av1' }, { probe: async () => ({ passed: true }) })).primary, 'h264');
    const sdp = offer.replace('96 97 98 99 100', '96 97 98 99 100 101').replace('a=rtcp-fb:100 nack', 'a=rtcp-fb:100 nack\r\na=fmtp:100 profile=0;level-idx=5;tier=0\r\na=rtpmap:101 rtx/90000\r\na=fmtp:101 apt=100');
    const preferred = api.transformOffer(sdp, 'av1');
    assert.match(preferred, /SAVPF 100 98 96 97 99 101/);
    assert.match(preferred, /fmtp:101 apt=100/);
    assert.match(preferred, /profile=0;level-idx=5;tier=0/);
    assert.match(preferred, /rtcp-fb:100 nack/);
    assert.equal(preferred.split('m=video')[0], sdp.split('m=video')[0]);
    const answer = noAV1.transformOffer(offer.replace(' 100', '').replace(/a=rtpmap:100[^\r]*\r\n|a=rtcp-fb:100[^\r]*\r\n/g, ''), 'av1');
    assert.match(answer, /SAVPF 98 96/);
    assert.doesNotMatch(answer, /rtpmap:100/);
    assert.equal(api.findCodec([available[1]], 'av1').mimeType, 'video/VP8');
});

test('AV1 probe separates insufficient capture from encoding and never labels scaled output successful', () => {
    const api = load();
    const before = report({ codec: 'video/AV1' });
    const after = report({ codec: 'video/AV1', timestamp: 2000, captured: 95, encoded: 95 });
    assert.equal(api.evaluateWindow(before, after, target, 'av1').reason, 'probe-source-slow');
    assert.equal(api.evaluateWindow(before, { ...after, captured: 120 }, target, 'av1').reason, 'encoder-slow');
});

test('AV1 runtime observes existing samples, detects zero startup frames, rejects stale owners and reports actual fallback codec', () => {
    let now = 10000;
    const api = load({ Date: { now: () => now } });
    const pc = { connectionState: 'connected', remoteDescription: { sdp: 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 VP8/90000\r\n' } };
    const reasons = [];
    let current = true;
    api.registerConnection(pc, { primary: 'av1', requested: 'av1', sending: true, isCurrent: () => current, onFallback: (reason) => reasons.push(reason) });
    api.observeConnection(pc, [{ type: 'outbound-rtp', kind: 'video', framesEncoded: 0 }]);
    now += 8001;
    api.observeConnection(pc, []);
    api.observeConnection(pc, []);
    assert.deepEqual(reasons, ['encoder-start-failed']);
    api.registerConnection(pc, { primary: 'av1', requested: 'av1', sending: true, isCurrent: () => current, onFallback: (reason) => reasons.push(reason) });
    api.observeConnection(pc, [{ type: 'outbound-rtp', kind: 'video', framesEncoded: 40, codecId: 'codec' }, { id: 'codec', mimeType: 'video/VP8' }]);
    assert.equal(api.getConnectionState(pc).actual, 'video/VP8');
    assert.equal(api.getConnectionState(pc).reason, 'remote-codec-fallback');
    assert.equal(api.getConnectionState(pc).status, 'frames-verified');
    current = false;
    assert.equal(api.failConnection(pc, 'negotiation-failed'), false);
    current = true;
    api.retireConnection(pc);
    assert.equal(api.failConnection(pc, 'negotiation-failed'), false);
});

test('AV1 cancellation cleans loopback tracks, prevents decision registration and keeps codec caches separate', async () => {
    const f = probeFixture({ primary: 'av1', stall: true });
    const input = track();
    const controller = new AbortController();
    const pending = f.api.prepare(input, { codecMode: 'av1' }, { signal: controller.signal });
    await f.advance(20);
    controller.abort();
    await f.advance(7000);
    assert.equal((await pending).trials[0].reason, 'cancelled');
    assert.equal(f.api.getDecision(input), undefined);
    assert.equal(f.timers.size, 0);
    assert.ok(f.peers.every((pc) => pc.closed));
    assert.equal(f.stops(), 1);
});

test('an AV1 decoder capability rejection is distinct from encoding throughput', async () => {
    const f = load({ RTCRtpSender: { getCapabilities: () => ({ codecs: [{ mimeType: 'video/AV1' }, ...available] }) },
        RTCRtpReceiver: { getCapabilities: () => ({ codecs: available }) }, RTCPeerConnection: class {} });
    const decision = await f.prepare(track(), { codecMode: 'av1' });
    assert.equal(decision.trials[0].reason, 'unsupported');
    assert.equal(decision.primary, 'h264');
    assert.equal(f.support().av1Receive, false);
    assert.equal(f.support().av1Send, true);
});
