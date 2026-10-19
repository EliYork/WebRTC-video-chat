import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { StrictStream, StrictTrack } from './helpers/strict_media_peer.mjs';
import { sanitizeVoiceDiagnostic } from '../src/views/js/shared/voice-diagnostic-schema.js';
import { createVoiceDiagnosticsRelay } from '../src/utils/VoiceDiagnosticsRelay.js';
/* eslint-disable no-await-in-loop -- Advance the real receiver monitor one scheduled check at a time. */

async function fixture({ onReceiverFailure, onReceiverIssue, waitForMedia = async () => {} } = {}) {
    let now = 1000000;
    let timerId = 0;
    const timers = new Map();
    const handlers = {};
    const actions = [];
    const failures = [];
    const streams = [];
    const document = { hidden: false };
    class Clock extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
    }
    const window = { MediaStream: StrictStream, document,
        setTimeout(callback, ms) { timers.set(++timerId, { callback, ms }); return timerId; },
        clearTimeout(id) { timers.delete(id); }, setInterval() { return 0; }, clearInterval() {} };
    vm.runInNewContext(readFileSync(new URL('../src/views/js/voice/voice-screen-sfu-runtime.js', import.meta.url), 'utf8'), { window, Date: Clock });
    let row = { id: 'secret-rtp-id', type: 'inbound-rtp', kind: 'video', timestamp: now,
        framesDecoded: 100, framesReceived: 100, bytesReceived: 10000, packetsReceived: 100,
        packetsLost: 2, nackCount: 4, pliCount: 1, freezeCount: 0, totalFreezesDuration: 0,
        ip: 'secret-address' };
    let read = async () => new Map([[row.id, { ...row }]]);
    const consumer = { kind: 'video', track: new StrictTrack('video', 'secret-track'),
        close() {}, getStats: () => read() };
    class Device {
        async load() {}
        createRecvTransport() {
            return { id: 'secret-transport', on() {}, close() {}, consume: async () => consumer };
        }
    }
    const publication = { id: 'secret-publication', peerId: 'secret-peer', roomId: 'game', voiceSessionGeneration: 1 };
    const socket = { connected: true, on: (event, callback) => { handlers[event] = callback; }, off() {},
        emit(_, payload, ack) {
            actions.push(payload.action);
            const response = { capabilities: { rtpCapabilities: {} }, list: { publications: [publication] },
                transport: { id: 'secret-transport' }, consume: { peerId: 'secret-peer', consumers: [{ kind: 'video' }] } };
            ack({ ok: true, ...response[payload.action] });
        } };
    const runtime = window.VoiceScreenSfuRuntime.createRuntime({ config: { enabled: true }, Device,
        waitForMedia, onRemoteStream: ({ stream }) => streams.push(stream),
        onReceiverIssue,
        onReceiverFailure: (value) => { failures.push(value); onReceiverFailure?.(value); } });
    const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
    runtime.attachSocket(socket);
    runtime.setSession({ roomId: 'game', peerId: 'viewer', voiceSessionGeneration: 1 });
    await flush();
    let source = 10000;
    let ingress = 10000;
    let egress = 10000;
    const step = async ({ decoded = 60, received = 5000, incoming = 5000, outgoing = 5000, health = true, sourceGrowth = 5000, advance = 2000, updates = {} } = {}) => {
        now += advance;
        source += sourceGrowth;
        ingress += incoming;
        egress += outgoing;
        row = { ...row, timestamp: now, framesDecoded: row.framesDecoded + decoded,
            framesReceived: row.framesReceived + (decoded || 0), bytesReceived: row.bytesReceived + received, ...updates };
        if (health) handlers['sfu:health']({ ...publication, publicationId: publication.id, videoBytes: source,
            serverHealth: { 采样时间_ms: now, 入站: { 累计字节: ingress }, 出站: { 累计字节: egress }, ip: 'secret-server' } });
        const timer = [...timers].find(([, value]) => value.ms === 2000);
        assert.ok(timer, 'receiver monitor is scheduled at its existing interval');
        timers.delete(timer[0]);
        timer[1].callback();
        await flush();
    };
    return { runtime, actions, failures, streams, handlers, document, step, flush, publication, timers,
        advance: (ms) => { now += ms; },
        setRead: (value) => { read = value; }, getRow: () => ({ ...row }),
        latest: () => runtime.getReceiverHealth().活跃接收[0]?.健康采样.at(-1) };
}

test('SFU release retains the exact three low-FPS checks and preceding window without IDs; cooldown still applies', async (t) => {
    const f = await fixture({ onReceiverFailure() { throw new Error('storage-unavailable'); } });
    t.after(() => f.runtime.leave());
    for (let i = 0; i < 9; i++) await f.step();
    for (let i = 0; i < 2; i++) await f.step({ decoded: 0 });
    assert.equal(f.actions.filter((action) => action === 'unsubscribe').length, 0);
    await f.step({ decoded: 0, updates: { nackCount: 10, pliCount: 3, freezeCount: 1, totalFreezesDuration: 0.4 } });
    assert.equal(f.actions.filter((action) => action === 'unsubscribe').length, 1);
    assert.equal(f.runtime.getRemoteSource('secret-peer'), undefined);
    const health = f.runtime.getReceiverHealth();
    assert.equal(health.活跃接收.length, 0);
    const saved = health.最近回退[0];
    assert.equal(saved.reason, 'receiver-video-stalled');
    assert.equal(saved.健康采样.length, 8);
    assert.equal(saved.健康采样.at(-1).采样时间_ms - saved.健康采样[0].采样时间_ms, 14000);
    assert.deepEqual(Array.from(saved.健康采样.slice(-3), (row) => row.连续低帧次数), [1, 2, 3]);
    assert.equal(saved.健康采样.at(-1).NACK增长, 6);
    assert.equal(saved.健康采样.at(-1).PLI增长, 2);
    assert.equal(saved.健康采样.at(-1).区间卡顿时长_ms, 400);
    assert.equal(f.failures.length, 1, 'diagnostic callback failure cannot suppress fallback');
    assert.doesNotMatch(JSON.stringify(health), /secret/);
    saved.健康采样[0].接收字节增长 = -999;
    assert.notEqual(f.runtime.getReceiverHealth().最近回退[0].健康采样[0].接收字节增长, -999);
    f.handlers['sfu:publication'](f.publication);
    await f.flush();
    assert.equal(f.actions.filter((action) => action === 'consume').length, 1, '120 second cooldown is unchanged');
    f.handlers.disconnect();
    assert.equal(f.runtime.getReceiverHealth().最近回退.length, 1, 'socket recovery preserves failure evidence');
    f.runtime.leave();
    assert.equal(f.runtime.getReceiverHealth().最近回退.length, 0);
});

test('manual P2P releases the server reservation and blocks discovery until auto is restored', async (t) => {
    const f = await fixture();
    t.after(() => f.runtime.leave());
    assert.equal(f.runtime.getReceiveRoute('secret-peer').mode, 'auto');
    assert.equal(f.runtime.getReceiveRoute('secret-peer').route, 'sfu');
    const selecting = f.runtime.setReceiveRoute('secret-peer', 'p2p');
    assert.equal(f.runtime.getReceiveRoute('secret-peer').pending, true);
    await selecting;
    assert.equal(f.runtime.getReceiveRoute('secret-peer').mode, 'p2p');
    assert.equal(f.runtime.getReceiveRoute('secret-peer').route, 'p2p');
    assert.equal(f.actions.filter((action) => action === 'unsubscribe').length, 1);
    f.handlers['sfu:publication'](f.publication);
    await f.flush();
    assert.equal(f.actions.filter((action) => action === 'consume').length, 1);
    assert.equal(f.runtime.getReceiveRoute('another-peer').mode, 'auto');
    await f.runtime.setReceiveRoute('secret-peer', 'auto');
    assert.equal(f.runtime.getReceiveRoute('secret-peer').route, 'sfu');
    assert.equal(f.actions.filter((action) => action === 'consume').length, 2);
    f.runtime.leave();
    assert.equal(f.runtime.getReceiveRoute('secret-peer').mode, 'auto');
});

test('manual SFU retains low-FPS health evidence without automatic fallback; auto restores the original trigger', async (t) => {
    const f = await fixture();
    t.after(() => f.runtime.leave());
    await f.runtime.setReceiveRoute('secret-peer', 'sfu');
    await f.step();
    for (let i = 0; i < 4; i++) await f.step({ decoded: 0 });
    assert.equal(f.runtime.getReceiveRoute('secret-peer').route, 'sfu');
    assert.equal(f.latest().区间解码帧率, 0);
    assert.equal(f.actions.filter((action) => action === 'unsubscribe').length, 0);
    await f.runtime.setReceiveRoute('secret-peer', 'auto');
    await f.step({ decoded: 0 });
    assert.equal(f.runtime.getReceiveRoute('secret-peer').route, 'p2p');
    assert.equal(f.runtime.getReceiverHealth().最近回退[0].reason, 'receiver-video-stalled');
});

test('manual SFU pins its failure window before switching routes, without changing fallback behavior', async (t) => {
    const issues = [];
    const f = await fixture({ onReceiverIssue: (issue) => issues.push(issue) });
    t.after(() => f.runtime.leave());
    await f.runtime.setReceiveRoute('secret-peer', 'sfu');
    for (let i = 0; i < 8; i++) await f.step();
    for (let i = 0; i < 4; i++) await f.step({ decoded: 0 });
    assert.equal(issues.length, 1, 'sustained stall does not spam duplicate windows');
    assert.equal(f.actions.filter((action) => action === 'unsubscribe').length, 0);
    await f.runtime.setReceiveRoute('secret-peer', 'p2p');
    const health = f.runtime.getReceiverHealth();
    assert.equal(health.活跃接收.length, 0);
    assert.equal(health.最近回退.length, 0, 'manual observation is not called a fallback');
    assert.equal(health.最近异常[0].健康采样.length, 8);
    assert.equal(health.最近异常[0].健康采样.at(-1).解码帧增长, 0);
    assert.deepEqual(JSON.parse(JSON.stringify(sanitizeVoiceDiagnostic(health))), JSON.parse(JSON.stringify(health)));
    assert.doesNotMatch(JSON.stringify(health), /secret/);
});

test('first-frame timeout retains pre-attach receive and decode evidence', async (t) => {
    const issues = [];
    const f = await fixture({ onReceiverIssue: (issue) => issues.push(issue), waitForMedia: async (_, transport, observe) => {
        observe(new Map([['video', { id: 'secret', type: 'inbound-rtp', kind: 'video', timestamp: 1000,
            bytesReceived: 9000, framesReceived: 0, framesDecoded: 0 }]]));
        throw new Error('sfu-video-not-arriving');
    } });
    t.after(() => f.runtime.leave());
    assert.equal(f.streams.some(Boolean), false);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].reason, 'receiver-ready-failed');
    assert.equal(issues[0].健康采样[0].解码帧数, 0);
    assert.doesNotMatch(JSON.stringify(f.runtime.getReceiverHealth()), /secret/);
});

test('explicit SFU retry bypasses only the receiver cooldown and route stats honor the selected consumer', async (t) => {
    const f = await fixture();
    t.after(() => f.runtime.leave());
    const source = f.runtime.getRemoteSource('secret-peer');
    assert.equal(f.runtime.getRemoteSource('secret-peer').pc, source.pc, 'stats wrapper is stable');
    assert.equal((await source.pc.getStats(source.stream.getVideoTracks()[0])).values().next().value.id, f.getRow().id);
    await f.step();
    for (let i = 0; i < 3; i++) await f.step({ decoded: 0 });
    await f.runtime.setReceiveRoute('secret-peer', 'auto');
    assert.equal(f.runtime.getReceiveRoute('secret-peer').route, 'p2p', 'auto preserves cooldown');
    await f.runtime.setReceiveRoute('secret-peer', 'sfu');
    assert.equal(f.runtime.getReceiveRoute('secret-peer').route, 'sfu');
    assert.equal(f.runtime.getReceiveRoute('secret-peer').error, '');
});

test('manual SFU also disables stats-error failover and reports mandatory server closure', async (t) => {
    const f = await fixture();
    t.after(() => f.runtime.leave());
    await f.runtime.setReceiveRoute('secret-peer', 'sfu');
    f.setRead(async () => { throw new Error('failed'); });
    for (let i = 0; i < 4; i++) await f.step();
    assert.equal(f.runtime.getReceiveRoute('secret-peer').route, 'sfu');
    f.handlers['sfu:closed']({ ...f.publication, publicationId: f.publication.id, reason: 'transport-closed' });
    assert.equal(f.runtime.getReceiveRoute('secret-peer').route, 'p2p');
    assert.match(f.runtime.getReceiveRoute('secret-peer').error, /已断开/);
});

test('manual P2P while SFU is awaiting decoded media cannot attach a late SFU stream', async (t) => {
    let decoded;
    const f = await fixture({ waitForMedia: () => new Promise((resolve) => { decoded = resolve; }) });
    t.after(() => f.runtime.leave());
    assert.equal(typeof decoded, 'function');
    const selecting = f.runtime.setReceiveRoute('secret-peer', 'p2p');
    decoded();
    await selecting;
    assert.equal(f.streams.some(Boolean), false);
    assert.equal(f.actions.includes('ready'), false);
    assert.equal(f.actions.filter((action) => action === 'unsubscribe').length, 1);
    assert.equal(f.runtime.getReceiveRoute('secret-peer').error, '');
    assert.equal(f.runtime.getReceiveRoute('secret-peer').mode, 'p2p');
});

for (const [name, options, expected] of [
    ['server-egress', { outgoing: 0 }, '服务器入站增长但出站未增长'],
    ['downstream', { received: 0 }, '服务器出站增长但本端未收数据'],
    ['decode', {}, '本端收到数据但未解码出帧'],
    ['stale-health', { health: false, advance: 5000 }, '服务器统计缺失或过期'],
]) {
    test(`SFU ${name} evidence is a measured clue; missing/repeated counters are not zero traffic`, async (t) => {
        const f = await fixture();
        t.after(() => f.runtime.leave());
        await f.step();
        await f.step({ decoded: 0, ...options });
        assert.equal(f.latest().停滞线索, expected);
        if (!options.health && options.health !== undefined) {
            assert.equal(f.latest().服务器入站字节增长, null);
            assert.equal(f.latest().服务器出站字节增长, null);
        }
        assert.equal(f.actions.filter((action) => action === 'unsubscribe').length, 0);
    });
}

test('healthy 30 FPS, hidden pages and stationary sources keep SFU; counter resets remain unknown', async (t) => {
    const f = await fixture();
    t.after(() => f.runtime.leave());
    for (let i = 0; i < 12; i++) await f.step();
    assert.equal(f.runtime.getReceiverHealth().活跃接收[0].健康采样.length, 8);
    assert.equal(f.latest().区间解码帧率, 30);
    f.document.hidden = true;
    for (let i = 0; i < 4; i++) await f.step({ decoded: 0 });
    assert.equal(f.latest().判定有效, false);
    f.document.hidden = false;
    for (let i = 0; i < 4; i++) await f.step({ decoded: 0, sourceGrowth: 0 });
    assert.equal(f.latest().来源活跃, false);
    await f.step({ updates: { id: 'secret-new-report', bytesReceived: 0, framesDecoded: 0 } });
    assert.equal(f.latest().统计对象变化, true);
    assert.equal(f.latest().接收字节增长, null);
    assert.equal(f.latest().区间解码帧率, null);
    await f.step({ updates: { nackCount: undefined, bytesReceived: 0 } });
    assert.equal(f.latest().NACK增长, null);
    assert.equal(f.actions.filter((action) => action === 'unsubscribe').length, 0);
    assert.equal(f.actions.filter((action) => action === 'consume').length, 1);
});

test('three stats errors preserve bounded failure evidence without exporting error text', async (t) => {
    const f = await fixture();
    t.after(() => f.runtime.leave());
    await f.step();
    f.setRead(async () => { throw new Error('secret-address'); });
    for (let i = 0; i < 3; i++) await f.step();
    const saved = f.runtime.getReceiverHealth().最近回退[0];
    assert.equal(saved.reason, 'receiver-stats-timeout');
    assert.deepEqual(Array.from(saved.健康采样.slice(-3), (row) => row.连续统计失败次数), [1, 2, 3]);
    assert.equal(f.actions.filter((action) => action === 'unsubscribe').length, 1);
    assert.doesNotMatch(JSON.stringify(saved), /secret/);
    assert.deepEqual(JSON.parse(JSON.stringify(sanitizeVoiceDiagnostic({ SFU接收健康: f.runtime.getReceiverHealth() }).SFU接收健康)),
        JSON.parse(JSON.stringify(f.runtime.getReceiverHealth())));
});

test('late stats after session disposal cannot append health or trigger unsubscribe', async (t) => {
    const f = await fixture();
    t.after(() => f.runtime.leave());
    let finish;
    f.setRead(() => new Promise((resolve) => { finish = resolve; }));
    await f.step();
    f.runtime.leave();
    finish(new Map([['secret', f.getRow()]]));
    await f.flush();
    assert.equal(f.runtime.getReceiverHealth().最近回退.length, 0);
    assert.equal(f.runtime.getReceiverHealth().活跃接收.length, 0);
    assert.equal(f.actions.filter((action) => action === 'unsubscribe').length, 0);
});

test('repeated real fallback/retry cycles keep only the latest three failure windows', async (t) => {
    const f = await fixture();
    t.after(() => f.runtime.leave());
    for (let attempt = 0; attempt < 4; attempt++) {
        if (attempt) {
            f.advance(120001);
            f.handlers['sfu:publication'](f.publication);
            await f.flush();
        }
        await f.step();
        for (let i = 0; i < 3; i++) await f.step({ decoded: 0, received: 0 });
    }
    assert.equal(f.failures.length, 4);
    assert.equal(f.runtime.getReceiverHealth().最近回退.length, 3);
    assert.deepEqual(Array.from(f.runtime.getReceiverHealth().最近回退, (row) => row.序号), [2, 3, 4]);
    assert.equal(f.actions.filter((action) => action === 'unsubscribe').length, 4);
});

test('monitor frame counts explain clock differences without changing its decision or selecting transport-wide stale rows', async (t) => {
    const f = await fixture();
    t.after(() => f.runtime.leave());
    f.setRead(async () => new Map([
        ['old', { ...f.getRow(), id: 'secret-old', framesDecoded: 0 }],
        ['active', f.getRow()],
    ]));
    await f.step();
    const previous = f.getRow();
    // The existing monitor uses elapsed wall time, while RTC rates use the
    // selected report's timestamp. Preserve both instead of hiding a mismatch.
    await f.step({ decoded: 4, updates: { timestamp: previous.timestamp + 500 } });
    const sample = f.latest();
    assert.equal(sample.解码帧数, previous.framesDecoded + 4);
    assert.equal(sample.完整接收帧数, previous.framesReceived + 4);
    assert.equal(sample.接收统计间隔_ms, 500);
    assert.equal(sample.采样间隔_ms, 2000);
    assert.equal(sample.区间解码帧率, 8);
    assert.equal(sample.判定解码帧率, 2);
    assert.equal(sample.连续低帧次数, 1);
    assert.equal(f.failures.length, 0);
    assert.doesNotMatch(JSON.stringify(sample), /secret/);
});

function callLogFixture(getReceiverHealth, initialStorage = []) {
    const saved = new Map(initialStorage);
    const handlers = {};
    let id = 0;
    const window = {
        navigator: { userAgent: 'Windows Chrome/155' }, document: { hidden: false },
        setTimeout: () => ++id, clearTimeout() {},
        localStorage: { getItem: (key) => saved.get(key), setItem: (key, value) => saved.set(key, value) },
    };
    vm.runInNewContext(readFileSync(new URL('../src/views/js/voice/voice-call-diagnostics.js', import.meta.url), 'utf8'), { window });
    const runtime = window.VoiceCallDiagnostics.createRuntime({ sanitize: sanitizeVoiceDiagnostic,
        getReceiverHealth, getState: () => ({ 会话: { state: 'joined', generation: 1 } }),
        getSources: () => [], getConnections: () => [] });
    const socket = { connected: true, on: (event, callback) => { handlers[event] = callback; }, off() {},
        timeout() { return this; }, emit() { throw new Error('collection not wired'); } };
    runtime.attachSocket(socket);
    runtime.start();
    return { runtime, socket, handlers, saved };
}

test('actual monitor releases reach persisted logs and JSON collected by either participant through the real relay', async (t) => {
    let viewer;
    const f = await fixture({ onReceiverFailure: (failure) => viewer.runtime.record('SFU接收回退诊断', failure) });
    viewer = callLogFixture(() => f.runtime.getReceiverHealth());
    const sender = callLogFixture(() => ({ 接收健康格式: 1, 活跃接收: [], 最近回退: [] }));
    t.after(() => { viewer.runtime.destroy(); sender.runtime.destroy(); f.runtime.leave(); });
    for (let cycle = 0; cycle < 3; cycle++) {
        if (cycle) {
            f.advance(120001);
            f.handlers['sfu:publication'](f.publication);
            await f.flush();
        }
        for (let i = 0; i < 9; i++) await f.step();
        for (let i = 0; i < 3; i++) await f.step({ decoded: 0 });
    }
    assert.equal(f.actions.filter((action) => action === 'unsubscribe').length, 3);
    const expected = JSON.parse(JSON.stringify(f.runtime.getReceiverHealth()));
    assert.equal(expected.最近回退.length, 3);
    for (const failure of expected.最近回退) {
        assert.equal(failure.健康采样.length, 8);
        assert.equal(failure.健康采样.at(-1).采样时间_ms - failure.健康采样[0].采样时间_ms, 14000);
        assert.deepEqual(failure.健康采样.slice(-3).map((sample) => sample.连续低帧次数), [1, 2, 3]);
        assert.ok(failure.健康采样.slice(0, 5).every((sample) => sample.区间解码帧率 === 30));
    }
    const peers = [sender, viewer].map((log, index) => ({ id: String(index), log,
        owner: { roomId: 'test', peerId: 'secret-owner-' + index, voiceSessionGeneration: 1 },
        timeout() { return this; }, emit(event, payload, ack) { void log.handlers[event](payload, (reply) => ack(null, reply)); } }));
    let time = 10000;
    const relay = createVoiceDiagnosticsRelay({ io: { in: () => ({ fetchSockets: async () => peers }) }, getMembers: () => peers,
        getVoiceOwner: (peer) => peer.owner, now: () => time });
    for (const peer of peers) {
        peer.log.socket.emit = (event, payload) => {
            if (event === 'voice:diagnostics:checkpoint') relay.checkpoint(peer, payload);
            else void relay.collect(peer).then((result) => payload(null, result));
        };
        const combined = JSON.parse(JSON.stringify(await peer.log.runtime.collectCombined()));
        const receiver = peer.log === viewer ? combined.本机 : combined.对端[0].数据;
        assert.deepEqual(receiver.SFU接收健康, expected, 'all eight samples survive every sanitizing/relay step');
        assert.equal(combined.对端[0].状态, '已采样');
        assert.doesNotMatch(JSON.stringify(combined), /secret/);
        assert.ok(Buffer.byteLength(JSON.stringify(combined)) < 256 * 1024, 'bounded fixture combined export');
        time += 11000;
    }
    assert.ok(Buffer.byteLength(JSON.stringify(expected)) < 64 * 1024, 'three complete failure windows stay small');
    viewer.runtime.end();
    const persisted = JSON.parse([...viewer.saved.values()][0]);
    const failures = persisted[0].事件.filter((event) => event.类型 === 'SFU接收回退诊断');
    assert.deepEqual(failures.map((event) => event.内容), expected.最近回退);
    const restored = callLogFixture(() => ({ 接收健康格式: 1, 活跃接收: [], 最近回退: [] }), viewer.saved);
    restored.runtime.end();
    const restoredSessions = JSON.parse([...restored.saved.values()][0]);
    assert.equal(restoredSessions[0].事件.filter((event) => event.类型 === 'SFU接收回退诊断')[2].内容.健康采样.length, 8);
    restored.runtime.destroy();
});
