import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const window = {};
vm.runInNewContext(readFileSync(new URL('../src/views/js/voice/voice-connection-quality.js', import.meta.url), 'utf8'), { window });
const { readConnection, grade, createRuntime } = window.VoiceConnectionQuality;
const connected = { connectionState: 'connected' };

test('quality reads only the selected ICE pair and audio intervals, preserving real zeros', () => {
    const rows = [
        { id: 'transport', type: 'transport', selectedCandidatePairId: 'pair' },
        { id: 'pair', type: 'candidate-pair', state: 'succeeded', currentRoundTripTime: .05 },
        { id: 'other', type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: 2 },
        { id: 'audio', type: 'inbound-rtp', kind: 'audio', timestamp: 2000, packetsReceived: 200, packetsLost: 2, jitter: 0 },
        { id: 'video', type: 'inbound-rtp', kind: 'video', jitter: 3, packetsLost: 1000 },
    ];
    const previous = new Map([['audio', { timestamp: 1000, packetsReceived: 100, packetsLost: 1 }]]);
    const result = readConnection(rows, previous, connected);
    assert.equal(result.rttMs, 50);
    assert.equal(result.jitterMs, 0);
    assert.equal(result.lossPercent, 100 / 101);
    assert.equal(result.state, 'connected');
    assert.equal(readConnection(rows, new Map(), connected).lossPercent, null, 'first sample must not use lifetime loss');
});

test('audio RTCP remote reports contribute outbound loss, RTT and jitter', () => {
    const rows = [{ id: 'remote', type: 'remote-inbound-rtp', kind: 'audio', timestamp: 2000, fractionLost: .1, packetsLost: 20, roundTripTime: .4, jitter: .05 }];
    const result = readConnection(rows, new Map([['remote', { timestamp: 1000, packetsLost: 10 }]]), connected);
    assert.equal(result.lossPercent, 10); assert.equal(result.rttMs, 400); assert.equal(result.jitterMs, 50);
    assert.equal(grade(result), 1);
    assert.equal(readConnection(rows, new Map([['remote', rows[0]]]), connected).lossPercent, null);
    for (const [fractionLost, expected] of [[0, 0], [undefined, null], [-1, null], [1.1, null]]) {
        assert.equal(readConnection([{ ...rows[0], fractionLost }], new Map(), connected).lossPercent, expected);
    }
});

for (const values of [
    { timestamp: 1000, packetsReceived: 90, packetsLost: 1 },
    { timestamp: 3000, packetsReceived: 0, packetsLost: 0 },
    { timestamp: 3000, packetsReceived: 200, packetsLost: -1 },
    { timestamp: 3000, packetsReceived: 100, packetsLost: 1 },
]) {
    test(`idle, reset or non-increasing counters never manufacture zero loss: ${JSON.stringify(values)}`, () => {
        const result = readConnection([{ ...values, id: 'audio', type: 'inbound-rtp', kind: 'audio' }],
            new Map([['audio', { timestamp: 2000, packetsReceived: 100, packetsLost: 1 }]]), connected);
        assert.equal(result.lossPercent, null);
    });
}

test('missing, negative and non-finite values remain unknown instead of perfect signal', () => {
    const result = readConnection([{ id: 'pair', type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: .01 },
        { type: 'remote-inbound-rtp', kind: 'audio', roundTripTime: NaN, jitter: -1 }], new Map(), connected);
    assert.equal(result.rttMs, null, 'nominated alone does not prove selected');
    assert.equal(result.jitterMs, null);
    assert.equal(grade(result), null);
    assert.equal(grade({ jitterMs: 1 }), null);
    assert.equal(grade({ rttMs: 20 }), 3);
    assert.equal(grade({ lossPercent: 0 }), 3);
    assert.equal(grade({ rttMs: 650 }), 1);
});

test('actual zero RTT, zero jitter and zero interval loss are valid measurements', () => {
    const result = readConnection([{ type: 'candidate-pair', selected: true, state: 'succeeded', currentRoundTripTime: 0 },
        { id: 'audio', type: 'inbound-rtp', kind: 'audio', timestamp: 2000, packetsReceived: 10, packetsLost: 0, jitter: 0 }],
    new Map([['audio', { timestamp: 1000, packetsReceived: 0, packetsLost: 0 }]]), connected);
    assert.equal(result.lossPercent, 0); assert.equal(result.rttMs, 0); assert.equal(grade(result), 5);
});

test('multiple links use their worst real metric and disclose unavailable values', () => {
    const runtime = createRuntime();
    runtime.accept([{ state: 'connected', rttMs: 20, jitterMs: 1, lossPercent: 0, micKbps: 12.25 }, { state: 'connected', rttMs: 450, lossPercent: 3, micKbps: 30.5 }]);
    const result = runtime.snapshot({ state: 'joined' });
    assert.equal(result.bars, 2); assert.equal(result.status, 'fair');
    assert.equal(result.rttMs, 450); assert.equal(result.lossPercent, 3); assert.equal(result.micKbps, 30.5);
    assert.match(result.detail, /450ms/); assert.match(result.detail, /2 条通话链路/);
    runtime.accept([{ state: 'connected', rttMs: 90 }]);
    assert.match(runtime.snapshot({ state: 'joined' }).detail, /区间丢包 未提供/);
});

test('idle, single person, failed stats, disconnect, reconnect and offline never show full signal', () => {
    const runtime = createRuntime();
    assert.equal(runtime.snapshot().bars, null);
    assert.equal(runtime.snapshot({ state: 'joined' }).bars, null);
    runtime.accept([{ state: 'connected' }]);
    assert.equal(runtime.snapshot({ state: 'joined' }).bars, null);
    runtime.accept([{ state: 'failed', rttMs: 20 }]);
    assert.equal(runtime.snapshot({ state: 'joined' }).bars, 0);
    runtime.accept([{ state: 'connected', rttMs: 20 }, { state: 'connecting' }]);
    assert.equal(runtime.snapshot({ state: 'joined' }).status, 'connecting');
    assert.equal(runtime.snapshot({ state: 'reconnecting-socket' }).bars, null);
    assert.equal(runtime.snapshot({ state: 'joined', online: false }).status, 'disconnected');
});

test('stale samples, a failed member sample and new sessions cannot inherit a green signal', () => {
    let time = 1000; const runtime = createRuntime({ now: () => time });
    runtime.accept([{ state: 'connected', rttMs: 20, lossPercent: 0 }]);
    assert.equal(runtime.snapshot({ state: 'joined' }).bars, 5);
    time += 12001;
    assert.equal(runtime.snapshot({ state: 'joined' }).bars, null);
    runtime.accept([{ state: 'connected', rttMs: 20 }, { state: 'connected' }]);
    assert.equal(runtime.snapshot({ state: 'joined' }).bars, null);
    runtime.reset(); assert.equal(runtime.snapshot({ state: 'joined' }).bars, null);
});
