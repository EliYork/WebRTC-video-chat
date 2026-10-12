import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { StrictStream, StrictTrack } from './helpers/strict_media_peer.mjs';

const load = (overrides = {}) => {
    const window = {
        MediaStream: StrictStream,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        ...overrides,
    };
    vm.runInNewContext(
        readFileSync(
            new URL(
                '../src/views/js/voice/voice-screen-sfu-runtime.js',
                import.meta.url
            ),
            'utf8'
        ),
        { window }
    );
    return window.VoiceScreenSfuRuntime;
};
test('SFU screen replaces duplicate P2P video/game audio while preserving microphone and separate volume roles', () => {
    const api = load();
    const mic = new StrictTrack('audio', 'mic');
    const duplicateAudio = new StrictTrack('audio', 'p2p-game');
    const duplicateVideo = new StrictTrack('video', 'p2p-video');
    const game = new StrictTrack('audio', 'sfu-game');
    const video = new StrictTrack('video', 'sfu-video');
    const base = new StrictStream([mic, duplicateAudio, duplicateVideo]);
    const result = api.mergeScreenMedia({
        baseStream: base,
        baseTrackRoles: [
            { role: 'screen-share-audio', trackId: duplicateAudio.id },
        ],
        screenStream: new StrictStream([game, video]),
        screenTrackRoles: [{ role: 'screen-share-audio', trackId: game.id }],
    });
    assert.deepEqual(result.stream.getTracks(), [mic, game, video]);
    assert.equal(result.trackRoles[0].role, 'participant-audio');
    assert.equal(result.trackRoles[1].role, 'screen-share-audio');
    assert.equal(api.mergeScreenMedia({ baseStream: base }).stream, base);
    assert.equal(mic.readyState, 'live');
});

for (const phase of ['forget-peer', 'stats-failure', 'ready-failure']) {
    test(`failed SFU unsubscribe during ${phase} resets server reservation for P2P recovery`, async () => {
        const timers = new Map();
        let timerId = 0;
        const api = load({
            setTimeout: (callback, ms) => { timers.set(++timerId, { callback, ms }); return timerId; },
            clearTimeout: (id) => timers.delete(id),
            setInterval: () => 0, clearInterval() {},
        });
        const actions = [];
        const streams = [];
        let closed = false;
        const consumer = {
            kind: 'video', track: new StrictTrack('video', 'sfu'),
            close() { closed = true; },
            getStats() { throw new Error('stats failed'); },
        };
        class Device {
            async load() {}
            createRecvTransport() {
                return { id: 'receive', on() {}, close() {}, consume: async () => consumer };
            }
        }
        const socket = {
            connected: true, on() {}, off() {},
            emit(event, payload, ack) {
                actions.push(payload.action);
                const responses = {
                    capabilities: { rtpCapabilities: {} },
                    list: { publications: [{ id: 'publication', peerId: 'source' }] },
                    transport: { id: 'receive' },
                    consume: { peerId: 'source', consumers: [{ kind: 'video' }] },
                };
                if (payload.action === 'unsubscribe' || (phase === 'ready-failure' && payload.action === 'ready')) {
                    ack({ ok: false, reason: 'injected-ack-failure' });
                } else ack({ ok: true, ...responses[payload.action] });
            },
        };
        const runtime = api.createRuntime({
            config: { enabled: true }, Device, waitForMedia: async () => {},
            onRemoteStream: (value) => streams.push(value.stream),
        });
        const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
        runtime.attachSocket(socket);
        runtime.setSession({ roomId: 'game', peerId: 'viewer', voiceSessionGeneration: 1 });
        await flush();
        assert.ok(streams.some(Boolean), 'subscription attached before cancellation');
        if (phase === 'forget-peer') runtime.forgetPeer('source');
        if (phase === 'stats-failure') {
            for (let i = 0; i < 3; i++) {
                const timer = [...timers].find(([, value]) => value.ms === 2000);
                assert.ok(timer, 'health timer must reschedule until third failure');
                timers.delete(timer[0]);
                timer[1].callback();
                await flush();
            }
        }
        await flush();
        assert.ok(actions.includes('unsubscribe'));
        assert.ok(actions.includes('reset'), 'failed unsubscribe must release publisher route through server reset');
        assert.equal(streams.at(-1), null);
        assert.equal(runtime.getRemoteSource('source'), undefined);
        assert.equal(closed, true);
        runtime.leave();
    });
}
test('an unavailable optional SFU SDK preserves P2P and never stops the captured screen track', async () => {
    const api = load();
    const track = new StrictTrack('video', 'screen');
    const events = [];
    const socket = {
        connected: true,
        on() {},
        off() {},
        emit: (...args) => {
            events.push(args);
            args.at(-1)?.({ ok: true });
        },
    };
    const runtime = api.createRuntime({ config: { enabled: true } });
    runtime.attachSocket(socket);
    runtime.setSession({
        roomId: 'game',
        peerId: 'me',
        voiceSessionGeneration: 1,
    });
    await runtime.publish(new StrictStream([track]));
    assert.equal(runtime.snapshot().hasUplink, false);
    assert.equal(runtime.usesServer('viewer'), false);
    runtime.leave();
    assert.equal(track.readyState, 'live');
});

async function publishFixture({ primary = 'h264', startBitrate = 'browser', rejectH264 = false, offered = ['h264', 'vp8'] } = {}) {
    const window = { MediaStream: StrictStream, setTimeout, clearTimeout, setInterval, clearInterval };
    for (const file of ['voice-screen-codecs.js', 'voice-screen-send-policy.js', 'voice-screen-sfu-runtime.js'])
        vm.runInNewContext(readFileSync(new URL('../src/views/js/voice/' + file, import.meta.url), 'utf8'), { window });
    const codecs = offered.map((key) => ({ mimeType: key === 'h264' ? 'video/H264' : 'video/VP8', parameters: key === 'h264' ? { 'packetization-mode': 1 } : {} }));
    const video = new StrictTrack('video', 'screen');
    const audio = new StrictTrack('audio', 'screen-audio');
    await window.VoiceScreenCodecs.prepare(video, { codecMode: primary === 'vp8' ? 'vp8' : 'auto', frameRate: 60 }, { probe: async () => ({ passed: true, reason: 'passed' }) });
    const attempts = [];
    const producers = [];
    class Device {
        sendRtpCapabilities = { codecs };
        async load() {}
        createSendTransport() {
            return { id: 'send', on() {}, close() {}, getStats: async () => new Map(),
                produce: async (options) => {
                    attempts.push(options);
                    if (rejectH264 && options.codec?.mimeType === 'video/H264') {
                        const error = new Error('unsupported-codec'); error.name = 'UnsupportedError'; throw error;
                    }
                    let parameters = { encodings: structuredClone(options.encodings || [{}]) };
                    const producer = { kind: options.track.kind, appData: options.appData,
                        rtpSender: { track: options.track, getParameters: () => structuredClone(parameters), setParameters: async (value) => { parameters = value; } },
                        close() { this.closed = true; } };
                    producers.push(producer);
                    return producer;
                },
            };
        }
    }
    const handlers = {};
    const socket = { connected: true, on: (event, callback) => { handlers[event] = callback; }, off() {},
        emit(event, payload, ack) {
            const responses = { capabilities: { rtpCapabilities: {}, videoBitrate: 22000000, initialViewerBitrate: 5500000, audioBitrate: 128000 },
                list: { publications: [] }, transport: { id: 'send' }, publish: { publicationId: 'pub' } };
            ack({ ok: true, ...responses[payload.action] });
        } };
    const runtime = window.VoiceScreenSfuRuntime.createRuntime({ config: { enabled: true }, Device });
    runtime.attachSocket(socket);
    runtime.setSession({ roomId: 'game', peerId: 'me', voiceSessionGeneration: 1 });
    await runtime.publish(new StrictStream([video, audio]), { frameRate: 60, startBitrate });
    return { runtime, video, audio, attempts, producers, handlers, policy: window.VoiceScreenSendPolicy };
}

for (const startBitrate of ['browser', '1500', '5500']) {
    test(`SFU honors detected codec, independent audio, full-size parameters and ${startBitrate} start hint`, async (t) => {
        const f = await publishFixture({ startBitrate });
        t.after(() => f.runtime.leave());
        assert.equal(f.runtime.hasUplink(), true);
        assert.equal(f.attempts[0].codec.mimeType, 'video/H264');
        assert.equal(f.attempts[0].stopTracks, false);
        assert.equal(f.attempts[0].codecOptions?.videoGoogleStartBitrate, startBitrate === 'browser' ? undefined : Number(startBitrate));
        assert.equal(f.attempts[1].codec, undefined, 'screen audio codec remains Opus');
        assert.equal(f.attempts[1].codecOptions.opusStereo, true);
        const readback = f.policy.getReadback(f.runtime.getSendConnection())[0];
        assert.equal(readback.请求.degradationPreference, 'maintain-resolution');
        assert.equal(readback.请求.encodings[0].scaleResolutionDownBy, 1);
        assert.equal(readback.不一致字段.length, 0);
        assert.equal(readback.启动码率提示_kbps, startBitrate === 'browser' ? null : Number(startBitrate));
        f.handlers['sfu:health']({ publicationId: 'pub', roomId: 'game', voiceSessionGeneration: 1,
            serverHealth: { 采样时间_ms: 1234, 入站: { 码率_bps: 5000000, ip: 'secret' }, ip: 'secret' } });
        assert.equal(f.runtime.getSendHealth().入站.码率_bps, 5000000);
        assert.doesNotMatch(JSON.stringify(f.runtime.getSendHealth()), /secret|ip/);
        f.runtime.stopPublishing();
        assert.equal(f.video.readyState, 'live');
        assert.equal(f.audio.readyState, 'live');
        assert.ok(f.producers.every((producer) => producer.closed));
    });
}

test('SFU unsupported H264 retries VP8 once; a VP8-only router and manual VP8 use VP8 immediately', async (t) => {
    for (const settings of [{ rejectH264: true }, { offered: ['vp8'] }, { primary: 'vp8' }]) {
        const f = await publishFixture(settings);
        t.after(() => f.runtime.leave());
        assert.equal(f.runtime.hasUplink(), true);
        const videos = f.attempts.filter((attempt) => attempt.track.kind === 'video');
        assert.equal(videos.at(-1).codec.mimeType, 'video/VP8');
        assert.equal(videos.length, settings.rejectH264 ? 2 : 1);
        assert.equal(f.video.readyState, 'live');
    }
});
test('bandwidth admission fallback is logged, repeated publication waits for cooldown, and leave clears history', async () => {
    const api = load();
    const handlers = new Map();
    const events = [];
    let consumes = 0;
    const socket = {
        connected: true,
        on: (name, handler) => handlers.set(name, handler), off() {},
        emit(_, payload, ack) {
            if (payload.action === 'consume') { consumes++; ack({ ok: false, reason: 'server-bandwidth-limit' }); return; }
            const result = { config: { enabled: true }, routerRtpCapabilities: {}, publications: [] };
            ack({ ok: true, ...result });
        },
    };
    class Device {
        async load() {}
        createRecvTransport() { return { on() {}, close() {} }; }
    }
    const runtime = api.createRuntime({ config: { enabled: true }, Device, onRouteEvent: (event) => events.push(event) });
    runtime.attachSocket(socket);
    runtime.setSession({ roomId: 'game', peerId: 'viewer', voiceSessionGeneration: 1 });
    const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
    await flush();
    const publication = { id: 'private-publication', peerId: 'source', roomId: 'game', voiceSessionGeneration: 1 };
    handlers.get('sfu:publication')(publication);
    await flush();
    handlers.get('sfu:publication')(publication);
    await flush();
    assert.equal(consumes, 1);
    assert.ok(events.some((event) => event.reason === 'server-bandwidth-limit'));
    assert.doesNotMatch(JSON.stringify(runtime.snapshot()), /private-publication|source/);
    runtime.leave();
    assert.equal(runtime.snapshot().routeHistory.length, 0);
});
