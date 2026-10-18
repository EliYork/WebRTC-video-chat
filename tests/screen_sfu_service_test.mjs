/* eslint-disable no-await-in-loop -- Admission, release and native lifecycle checks must retain their ordering. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import {
    readScreenSfuConfig,
    createScreenSfuBudget,
} from '../src/utils/ScreenSfuBudget.js';
import { createScreenSfuService, summarizeScreenSfuStats, screenRouterCodecs } from '../src/utils/ScreenSfuService.js';

let sequence = 0;
test('SFU stats expose video packet counters only and missing counters remain unknown', () => {
    const rows = [
        { type: 'inbound-rtp', kind: 'video', bitrate: 8000000, byteCount: 1000, packetCount: 80, packetsLost: 0, ssrc: 'secret', ip: 'secret' },
        { type: 'inbound-rtp', kind: 'audio', bitrate: 128000, byteCount: 99, packetCount: 10 },
    ];
    assert.deepEqual(summarizeScreenSfuStats(rows, 'inbound-rtp'), { 码率_bps: 8000000, 累计字节: 1000, 累计包数: 80, 累计丢包: 0 });
    assert.equal(summarizeScreenSfuStats([], 'outbound-rtp').码率_bps, null);
    assert.doesNotMatch(JSON.stringify(summarizeScreenSfuStats(rows, 'inbound-rtp')), /secret|ssrc|ip/);
});
class NativeObject extends EventEmitter {
    constructor(properties = {}) {
        super();
        Object.assign(
            this,
            { id: `id-${++sequence}`, closed: false },
            properties
        );
    }
    close() {
        this.closed = true;
    }
}
const fixture = (overrides = {}) => {
    const config = readScreenSfuConfig({ SFU_ANNOUNCED_ADDRESS: '127.0.0.1', SFU_EGRESS_MBPS: 30, SFU_VIDEO_MBPS: 22, SFU_PAYLOAD_MBPS: 23, ...overrides });
    const created = [];
    let trafficBitrate = 0;
    const fakeWorker = new NativeObject();
    fakeWorker.createWebRtcServer = async () => new NativeObject();
    fakeWorker.getResourceUsage = async () => ({
        ru_utime: 0,
        ru_stime: 0,
        ru_maxrss: 1024,
    });
    fakeWorker.createRouter = async () => {
        const router = new NativeObject({
            rtpCapabilities: { codecs: [] },
            canConsume: ({ rtpCapabilities }) => rtpCapabilities.noAV1 !== true,
        });
        router.createWebRtcTransport = async (options) => {
            const transport = new NativeObject({
                ...options,
                iceParameters: {},
                iceCandidates: [],
                dtlsParameters: {},
            });
            transport.connect = async () => {};
            transport.getStats = async () => [{ availableOutgoingBitrate: transport.capacity || 23000000 }];
            transport.setMaxIncomingBitrate = async (value) => {
                transport.incoming = value;
            };
            transport.setMaxOutgoingBitrate = async (value) => {
                transport.outgoing = value;
            };
            transport.produce = async (value) =>
                new NativeObject({
                    ...value,
                    getStats: async () => [
                        { type: 'inbound-rtp', bitrate: trafficBitrate },
                    ],
                });
            transport.consume = async (value) => {
                const consumer = new NativeObject({
                    ...value,
                    kind: 'video',
                    rtpParameters: {},
                });
                consumer.resume = async () => {
                    consumer.paused = false;
                };
                consumer.keyframes = 0;
                consumer.requestKeyFrame = async () => { consumer.keyframes++; };
                transport.consumers ||= [];
                transport.consumers.push(consumer);
                consumer.getStats = async () => [{ type: 'outbound-rtp', fractionLost: transport.loss || 0 }];
                return consumer;
            };
            created.push(transport);
            return transport;
        };
        return router;
    };
    let sample = { memoryBytes: 1, freeBytes: 1e9, cpuPercent: 0 };
    const service = createScreenSfuService({
        config,
        getVoiceOwner: (socket) => socket.owner,
        createWorker: async () => fakeWorker,
        resourceSample: () => sample,
    });
    const socket = (peerId, roomId = 'game') => ({
        id: peerId,
        disconnected: false,
        data: { voiceScreenSharing: true },
        owner: { roomId, peerId, voiceSessionGeneration: 1 },
        events: [],
        emit(event, payload) {
            this.events.push({ event, payload });
        },
    });
    const request = (client, action, data = {}) =>
        service.request(client, {
            action,
            voiceSessionGeneration: client.owner?.voiceSessionGeneration ?? 1,
            ...data,
        });
    const publish = async (client) => {
        await request(client, 'capabilities');
        const transport = await request(client, 'transport', {
            direction: 'send',
        });
        assert.equal(transport.ok, true);
        assert.equal(
            (
                await request(client, 'produce', {
                    transportId: transport.id,
                    role: 'screen-video',
                    kind: 'video',
                    rtpParameters: {},
                })
            ).ok,
            true
        );
        return (await request(client, 'publish')).publicationId;
    };
    const subscribe = async (client, publicationId) => {
        await request(client, 'capabilities');
        const transport = await request(client, 'transport', {
            direction: 'recv',
        });
        return request(client, 'consume', {
            publicationId,
            transportId: transport.id,
            rtpCapabilities: {},
        });
    };
    return {
        config,
        service,
        socket,
        request,
        publish,
        subscribe,
        created,
        fakeWorker,
        setSample: (next) => {
            sample = next;
        },
        setBitrate: (next) => {
            trafficBitrate = next;
        },
    };
};

test('global budget admits four 5.5Mbps viewers, rejects fifth, and returns released capacity', () => {
    const config = readScreenSfuConfig({ SFU_EGRESS_MBPS: 30, SFU_VIDEO_MBPS: 22, SFU_PAYLOAD_MBPS: 23 });
    assert.equal(config.enabled, false);
    assert.throws(() => readScreenSfuConfig({ SFU_VIDEO_MBPS: '27' }));
    assert.throws(() => readScreenSfuConfig({ SFU_PORT: '44444.5' }));
    const budget = createScreenSfuBudget(config);
    for (let i = 0; i < 4; i++) assert.equal(budget.reserve(`room-${i}`), true);
    assert.equal(budget.reserve('room-0'), true);
    assert.equal(budget.snapshot().reservedBps, 22512000);
    assert.equal(budget.reserve('fifth'), false);
    budget.release('room-0');
    assert.equal(budget.reserve('fifth'), true);
});
test('visible SFU handoff requests one keyframe; duplicate ready does not request again', async (t) => {
    const f = fixture();
    t.after(f.service.close);
    const publisher = f.socket('publisher');
    const id = await f.publish(publisher);
    const viewer = f.socket('viewer');
    await f.subscribe(viewer, id);
    await f.request(viewer, 'resume', { publicationId: id });
    const video = f.created[1].consumers[0];
    assert.equal(video.keyframes, 0);
    await f.request(viewer, 'ready', { publicationId: id });
    assert.equal(video.keyframes, 1);
    await f.request(viewer, 'ready', { publicationId: id });
    assert.equal(video.keyframes, 1);
});

test('weak receiver capacity and RTCP loss never lower the active source quality ceiling', async (t) => {
    const f = fixture();
    t.after(f.service.close);
    const publisher = f.socket('publisher');
    const id = await f.publish(publisher);
    const first = f.socket('first');
    await f.subscribe(first, id);
    await f.request(first, 'resume', { publicationId: id });
    await f.request(first, 'ready', { publicationId: id });
    f.created[1].capacity = 10000000;
    const later = f.socket('later');
    await f.subscribe(later, id);
    await f.request(later, 'resume', { publicationId: id });
    await f.request(later, 'ready', { publicationId: id });
    f.created[2].capacity = 1000000;
    for (let n = 0; n < 6; n++) await f.service.sampleTraffic();
    const lastTarget = () => publisher.events.filter((e) => e.event === 'sfu:routes').at(-1).payload.videoMaxBitrate;
    assert.equal(lastTarget(), f.config.videoBitrate);
    f.created[1].loss = 26;
    f.setBitrate(8000000);
    await f.service.sampleTraffic();
    assert.equal(lastTarget(), f.config.videoBitrate, 'RTCP loss must not reduce source quality');
    f.created[1].capacity = 2000000;
    f.created[1].loss = 0;
    await f.service.sampleTraffic();
    assert.equal(lastTarget(), f.config.videoBitrate, 'capacity drop must not reduce source quality');
});

test('server heartbeat includes distinct ingress and egress evidence without altering routes or admission', async (t) => {
    const f = fixture();
    t.after(f.service.close);
    const publisher = f.socket('publisher');
    const id = await f.publish(publisher);
    const viewer = f.socket('viewer');
    await f.subscribe(viewer, id);
    await f.request(viewer, 'resume', { publicationId: id });
    await f.request(viewer, 'ready', { publicationId: id });
    await f.service.sampleTraffic();
    const ingress = publisher.events.filter((event) => event.event === 'sfu:health').at(-1).payload.serverHealth;
    const egress = viewer.events.filter((event) => event.event === 'sfu:health').at(-1).payload.serverHealth;
    assert.ok(Number.isFinite(ingress.采样时间_ms));
    assert.ok(egress.入站);
    assert.ok(egress.出站);
    assert.doesNotMatch(JSON.stringify(egress), /ssrc|fractionLost|availableOutgoingBitrate/);
    assert.equal(publisher.events.filter((event) => event.event === 'sfu:routes').at(-1).payload.peerIds[0], 'viewer');
});

test('unused SFU upload yields bandwidth to P2P while pending receivers can still decode', async (t) => {
    const f = fixture();
    t.after(f.service.close);
    const publisher = f.socket('publisher');
    const id = await f.publish(publisher);
    await f.service.sampleTraffic();
    const target = () => publisher.events.filter((e) => e.event === 'sfu:routes').at(-1).payload.videoMaxBitrate;
    assert.equal(target(), 500000);
    await f.subscribe(f.socket('pending'), id);
    await f.service.sampleTraffic();
    assert.equal(target(), f.config.initialViewerBitrate);
});

test('SFU ownership rejects unjoined, stale, cross-room and foreign transport requests', async (t) => {
    const f = fixture();
    t.after(f.service.close);
    const publisher = f.socket('publisher');
    const id = await f.publish(publisher);
    const stranger = f.socket('stranger', 'project');
    assert.equal(
        (await f.subscribe(stranger, id)).reason,
        'publication-unavailable'
    );
    assert.equal(
        (await f.request(stranger, 'connect', { transportId: f.created[0].id }))
            .reason,
        'transport-owner-mismatch'
    );
    assert.equal(
        (await f.request(publisher, 'list', { voiceSessionGeneration: 2 }))
            .reason,
        'voice-owner-missing'
    );
    stranger.owner = undefined;
    assert.equal(
        (await f.request(stranger, 'capabilities')).reason,
        'voice-owner-missing'
    );
});

test('concurrent viewers share the global budget; only resumed/ready receivers suppress P2P', async (t) => {
    const f = fixture();
    t.after(f.service.close);
    const publisher = f.socket('publisher');
    const id = await f.publish(publisher);
    const viewers = Array.from({ length: 5 }, (_, i) =>
        f.socket(`viewer-${i}`)
    );
    const results = await Promise.all(
        viewers.map((viewer) => f.subscribe(viewer, id))
    );
    assert.equal(results.filter((result) => result.ok).length, 4);
    assert.equal(results[4].reason, 'server-bandwidth-limit');
    assert.equal(
        (await f.request(viewers[0], 'ready', { publicationId: id })).reason,
        'consumer-not-resumed'
    );
    await f.request(viewers[0], 'resume', { publicationId: id });
    await f.request(viewers[0], 'ready', { publicationId: id });
    const route = publisher.events
        .filter((event) => event.event === 'sfu:routes')
        .at(-1);
    assert.deepEqual(route.payload.peerIds, ['viewer-0']);
    f.service.cleanupSocket(viewers[0]);
    assert.equal(f.service.snapshot().viewers, 3);
    assert.equal((await f.subscribe(viewers[4], id)).ok, true);
});
test('one or two viewers may exceed 5.5Mbps; rising demand evicts newest viewers without cutting older bitrate', async (t) => {
    const f = fixture();
    t.after(f.service.close);
    const publisher = f.socket('publisher');
    const id = await f.publish(publisher);
    const viewers = [
        f.socket('first'),
        f.socket('second'),
        f.socket('third'),
        f.socket('fourth'),
    ];
    for (const viewer of viewers) {
        await f.subscribe(viewer, id);
        await f.request(viewer, 'resume', { publicationId: id });
        await f.request(viewer, 'ready', { publicationId: id });
    }
    f.setBitrate(8000000);
    await f.service.sampleTraffic();
    assert.equal(f.service.snapshot().viewers, 2);
    assert.equal(f.service.snapshot().reservedBps, 19200000);
    assert.deepEqual(
        publisher.events.filter((event) => event.event === 'sfu:routes').at(-1)
            .payload.peerIds,
        ['first', 'second']
    );
    assert.equal(
        (await f.subscribe(f.socket('later'), id)).reason,
        'server-bandwidth-limit'
    );
    f.setBitrate(15000000);
    await f.service.sampleTraffic();
    assert.equal(f.service.snapshot().viewers, 1);
    assert.deepEqual(
        publisher.events.filter((event) => event.event === 'sfu:routes').at(-1)
            .payload.peerIds,
        ['first']
    );
    assert.equal(f.service.snapshot().reservedBps, 18000000);
});

test('stop/restart sharing frees send transport and budget while retaining receive session', async (t) => {
    const f = fixture();
    t.after(f.service.close);
    const publisher = f.socket('publisher');
    const viewer = f.socket('viewer');
    const id = await f.publish(publisher);
    await f.subscribe(viewer, id);
    await f.request(publisher, 'stop');
    assert.equal(f.service.snapshot().viewers, 0);
    assert.equal(f.created[0].closed, true);
    assert.equal(f.created[1].closed, false);
    assert.notEqual(await f.publish(publisher), id);
    assert.equal(f.service.snapshot().publishers, 1);
});

test('worker failure releases every reservation and tells both sides to use P2P', async (t) => {
    const f = fixture();
    t.after(f.service.close);
    const publisher = f.socket('publisher');
    const viewer = f.socket('viewer');
    await f.subscribe(viewer, await f.publish(publisher));
    f.fakeWorker.emit('died', new Error('test worker failure'));
    assert.equal(f.service.snapshot().viewers, 0);
    assert.equal(f.service.snapshot().clients, 0);
    assert.ok(viewer.events.some((event) => event.event === 'sfu:fallback'));
    assert.ok(publisher.events.some((event) => event.event === 'sfu:fallback'));
});

test('sustained CPU/memory pressure returns existing shares to P2P and rejects admission', async (t) => {
    const f = fixture();
    t.after(f.service.close);
    const publisher = f.socket('publisher');
    await f.subscribe(f.socket('viewer'), await f.publish(publisher));
    f.setSample({
        memoryBytes: 800 * 1024 * 1024,
        freeBytes: 1e9,
        cpuPercent: 0,
    });
    for (let i = 0; i < 3; i++) await f.service.sampleHealth();
    assert.equal(f.service.snapshot().viewers, 0);
    assert.equal(
        (await f.request(f.socket('new'), 'capabilities')).reason,
        'server-resource-limit'
    );
});

test('session disappearing during native creation closes the result rather than leaking it', async (t) => {
    const f = fixture();
    t.after(f.service.close);
    const client = f.socket('client');
    await f.request(client, 'capabilities');
    const result = f.request(client, 'transport', { direction: 'recv' });
    client.disconnected = true;
    client.owner = undefined;
    assert.equal((await result).ok, false);
    assert.equal(f.service.snapshot().viewers, 0);
});

test('20Mbps defaults reserve transport/system headroom and reject inconsistent or oversized reservations', () => {
    const config = readScreenSfuConfig({});
    assert.equal(config.egressBudget, 20000000);
    assert.equal(config.reservedEgress, 4000000);
    assert.equal(config.payloadBudget, 16000000);
    assert.equal(config.videoBitrate, 15000000);
    assert.throws(() => readScreenSfuConfig({ SFU_VIDEO_MBPS: 22, SFU_PAYLOAD_MBPS: 23 }), /exceeds/);
    assert.throws(() => readScreenSfuConfig({ SFU_INITIAL_VIEWER_MBPS: 9, SFU_PAYLOAD_MBPS: 5, SFU_VIDEO_MBPS: 4 }), /INITIAL_VIEWER/);
    const budget = createScreenSfuBudget(config);
    assert.equal(budget.reserve('oversized', 17000000), false);
    assert.deepEqual(budget.rebalance([{ key: 'oversized', amount: 17000000 }, { key: 'ok', amount: 7000000 }]), ['oversized']);
    assert.equal(budget.snapshot().reservedBps, 7000000);
    assert.equal(budget.reserve('bad', NaN), false);
});

const outlet20 = {
    SFU_EGRESS_MBPS: 20,
    SFU_RESERVED_MBPS: 4,
    SFU_PAYLOAD_MBPS: 16,
    SFU_VIDEO_MBPS: 15,
};

test('20Mbps with 5.5Mbps initial reserve remains limited to two subscriptions even for a quiet source', async (t) => {
    const f = fixture(outlet20);
    t.after(f.service.close);
    const source = f.socket('source');
    const id = await f.publish(source);
    for (const name of ['first', 'second']) {
        const viewer = f.socket(name);
        assert.equal((await f.subscribe(viewer, id)).ok, true);
        await f.request(viewer, 'resume', { publicationId: id });
        await f.request(viewer, 'ready', { publicationId: id });
    }
    f.setBitrate(1000000);
    await f.service.sampleTraffic();
    assert.equal(f.service.snapshot().reservedBps, 11256000);
    assert.equal((await f.subscribe(f.socket('third'), id)).reason, 'server-bandwidth-limit');
    assert.equal(f.service.snapshot().viewers, 2);
});

test('proposed 3.5Mbps reserve admits four low-rate subscriptions but measured demand can evict even the last viewer', async (t) => {
    const f = fixture({ ...outlet20, SFU_INITIAL_VIEWER_MBPS: 3.5 });
    t.after(f.service.close);
    const source = f.socket('source');
    const id = await f.publish(source);
    const viewers = Array.from({ length: 5 }, (_, index) => f.socket(`viewer-${index}`));
    for (const viewer of viewers.slice(0, 4)) {
        assert.equal((await f.subscribe(viewer, id)).ok, true);
        await f.request(viewer, 'resume', { publicationId: id });
        await f.request(viewer, 'ready', { publicationId: id });
    }
    assert.equal(f.service.snapshot().reservedBps, 14512000);
    assert.equal((await f.subscribe(viewers[4], id)).reason, 'server-bandwidth-limit');
    for (const [bitrate, remaining, reserved] of [
        [3300000, 4, 15840000],
        [4400000, 3, 15840000],
        [6600000, 2, 15840000],
        [13200000, 1, 15840000],
        [15000000, 0, 0],
    ]) {
        f.setBitrate(bitrate);
        await f.service.sampleTraffic();
        assert.equal(f.service.snapshot().viewers, remaining);
        assert.equal(f.service.snapshot().reservedBps, reserved);
        if (remaining > 0) {
            const route = source.events.filter((event) => event.event === 'sfu:routes').at(-1).payload;
            assert.equal(route.videoMaxBitrate, 15000000, '15Mbps remains a ceiling rather than a fixed measured rate');
        }
    }
    assert.ok(viewers.slice(0, 4).every((viewer) => viewer.events.some((event) =>
        event.event === 'sfu:closed' && event.payload.reason === 'server-bandwidth-priority')));
});

test('proposed four-subscription allowance is shared across publishers and channels, not four per source', async (t) => {
    const f = fixture({ ...outlet20, SFU_INITIAL_VIEWER_MBPS: 3.5 });
    t.after(f.service.close);
    for (const room of ['game', 'project']) {
        const id = await f.publish(f.socket(`${room}-source`, room));
        for (const name of ['one', 'two']) {
            assert.equal((await f.subscribe(f.socket(`${room}-${name}`, room), id)).ok, true);
        }
        if (room === 'project') {
            assert.equal((await f.subscribe(f.socket('fifth', room), id)).reason, 'server-bandwidth-limit');
        }
    }
    assert.equal(f.service.snapshot().viewers, 4);
    assert.equal(f.service.snapshot().reservedBps, 14512000);
});

test('SFU mixed codec consumer rejection releases its reservation and never suppresses compatible P2P', async (t) => {
    const f = fixture();
    t.after(f.service.close);
    const publisher = f.socket('av1-source');
    const id = await f.publish(publisher);
    const desktop = f.socket('desktop');
    await f.subscribe(desktop, id);
    await f.request(desktop, 'resume', { publicationId: id });
    await f.request(desktop, 'ready', { publicationId: id });
    const phone = f.socket('phone');
    await f.request(phone, 'capabilities');
    const transport = await f.request(phone, 'transport', { direction: 'recv' });
    const before = f.service.snapshot().reservedBps;
    const denied = await f.request(phone, 'consume', { publicationId: id, transportId: transport.id, rtpCapabilities: { noAV1: true } });
    assert.equal(denied.ok, false);
    assert.equal(denied.reason, 'unsupported-codec');
    assert.deepEqual(f.service.snapshot().reservedBps, before);
    const route = publisher.events.filter((event) => event.event === 'sfu:routes').at(-1).payload.peerIds;
    assert.deepEqual(route, ['desktop']);
    assert.ok(screenRouterCodecs.some((codec) => codec.mimeType === 'video/AV1'));
});
