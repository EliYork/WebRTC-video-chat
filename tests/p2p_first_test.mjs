/* eslint-disable no-await-in-loop -- Route transitions and fake-clock samples are sequential. */
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { StrictStream, StrictTrack } from './helpers/strict_media_peer.mjs';

const flush = async () => { for (let index = 0; index < 100; index++) await Promise.resolve(); };
async function fixture({ deny = false, useDefault = false } = {}) {
    let now = 100000;
    class Clock extends Date { static now() { return now; } }
    const window = { MediaStream: StrictStream, document: { hidden: false }, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {} };
    for (const file of ['voice-screen-codecs.js', 'voice-screen-sfu-runtime.js'])
        vm.runInNewContext(readFileSync(new URL('../src/views/js/voice/' + file, import.meta.url), 'utf8'), { window, Date: Clock });
    const actions = [];
    const publications = [{ id: 'publication', peerId: 'source' }];
    class Device {
        async load() {}
        createRecvTransport() { return { id: 'recv', on() {}, close() {}, consume: async () => ({ kind: 'video', track: new StrictTrack('video', 'sfu'), close() {} }) }; }
    }
    const socket = { connected: true, on() {}, off() {}, emit(event, payload, ack) {
        actions.push({ event, payload });
        if (event === 'screen:route-pressure') return;
        if (deny && payload.action === 'consume') { ack({ ok: false, reason: 'server-bandwidth-limit' }); return; }
        const responses = { capabilities: { rtpCapabilities: {} }, list: { publications }, transport: { id: 'recv' }, consume: { peerId: 'source', consumers: [{ kind: 'video' }] } };
        ack({ ok: true, ...responses[payload.action] });
    } };
    const runtime = window.VoiceScreenSfuRuntime.createRuntime({ config: { enabled: true, ...(useDefault ? { defaultReceiveMode: 'p2p-first' } : {}) }, Device, waitForMedia: async () => {} });
    runtime.attachSocket(socket);
    runtime.setSession({ roomId: 'room', peerId: 'viewer', voiceSessionGeneration: 1 });
    if (!useDefault) await runtime.setReceiveRoute('source', 'p2p-first');
    await flush();
    const pc = { connectionState: 'connected' };
    const stats = (frames, bytes, relay = false) => new Map([
        ['in', { id: 'in', type: 'inbound-rtp', kind: 'video', timestamp: now, framesDecoded: frames, bytesReceived: bytes }],
        ['t', { type: 'transport', selectedCandidatePairId: 'pair' }],
        ['pair', { id: 'pair', localCandidateId: 'local', remoteCandidateId: 'remote' }],
        ['local', { id: 'local', candidateType: 'host' }],
        ['remote', { id: 'remote', candidateType: relay ? 'relay' : 'srflx' }],
    ]);
    return { runtime, window, actions, pc, stats, advance: (ms) => { now += ms; } };
}

test('deployed default starts with P2P and enables existing SFU recovery only after real failure; manual auto remains usable', async (t) => {
    const f = await fixture({ useDefault: true }); t.after(() => f.runtime.leave());
    assert.equal(f.runtime.getReceiveRoute('source').mode, 'p2p-first');
    assert.equal(f.actions.some((row) => row.payload.action === 'consume'), false);
    f.advance(11000);
    f.runtime.observeP2p('source', { connectionState: 'failed' });
    await flush();
    assert.equal(f.runtime.getReceiveRoute('source').route, 'sfu');
    await f.runtime.setReceiveRoute('source', 'p2p');
    await f.runtime.setReceiveRoute('source', 'auto');
    assert.equal(f.runtime.getReceiveRoute('source').mode, 'auto');
    assert.equal(f.runtime.getReceiveRoute('source').route, 'sfu');
});

test('P2P-first avoids automatic SFU subscription, identifies direct vs TURN and keeps healthy direct media', async (t) => {
    const f = await fixture(); t.after(() => f.runtime.leave());
    assert.equal(f.actions.some((row) => row.payload.action === 'consume'), false);
    for (let index = 0; index < 5; index++) { f.advance(3000); f.runtime.observeP2p('source', f.pc, f.stats(index * 150, index * 3000000)); }
    assert.equal(f.runtime.getReceiveRoute('source').transport, 'direct');
    assert.equal(f.runtime.getReceiveRoute('source').route, 'p2p');
    f.runtime.observeP2p('source', f.pc, f.stats(750, 15000000, true));
    // A fresh timestamp is required for a path/quality update.
    f.advance(1000); f.runtime.observeP2p('source', f.pc, f.stats(800, 16000000, true));
    await flush();
    assert.equal(f.runtime.getReceiveRoute('source').route, 'sfu');
    assert.equal(f.runtime.getReceiveRoute('source').reason, 'turn-relay');
    await f.runtime.setReceiveRoute('source', 'p2p-first');
    assert.equal(f.runtime.getReceiveRoute('source').route, 'p2p', 'explicit retry releases SFU');
    assert.equal(f.runtime.getReceiveRoute('source').mode, 'p2p-first');
});

test('P2P-first requires repeated valid receive stalls; duplicate samples, stationary no-data and background do not trigger', async (t) => {
    const f = await fixture(); t.after(() => f.runtime.leave());
    f.runtime.observeP2p('source', f.pc, f.stats(100, 1000));
    for (let index = 0; index < 4; index++) { f.advance(1000); f.runtime.observeP2p('source', f.pc, f.stats(100, 1000)); }
    assert.equal(f.runtime.getReceiveRoute('source').route, 'p2p');
    f.window.document.hidden = true;
    for (let index = 0; index < 4; index++) { f.advance(1000); f.runtime.observeP2p('source', f.pc, f.stats(100, 10000 + index * 1000)); }
    await flush(); assert.equal(f.runtime.getReceiveRoute('source').route, 'p2p');
    f.window.document.hidden = false;
    for (let index = 0; index < 3; index++) {
        f.advance(1000);
        const sample = f.stats(100, 20000 + index * 1000);
        f.runtime.observeP2p('source', f.pc, sample);
        f.runtime.observeP2p('source', f.pc, sample);
    }
    await flush();
    assert.equal(f.runtime.getReceiveRoute('source').route, 'sfu');
    assert.equal(f.runtime.getReceiveRoute('source').reason, 'p2p-video-stalled');
});

test('manual P2P never auto-subscribes; P2P-first failure respects server admission and session cleanup', async (t) => {
    const f = await fixture({ deny: true }); t.after(() => f.runtime.leave());
    await f.runtime.setReceiveRoute('source', 'p2p');
    f.advance(20000); f.runtime.observeP2p('source', { connectionState: 'failed' });
    await flush(); assert.equal(f.actions.some((row) => row.payload.action === 'consume'), false);
    await f.runtime.setReceiveRoute('source', 'p2p-first');
    f.advance(11000); f.runtime.observeP2p('source', { connectionState: 'failed' });
    await flush();
    assert.equal(f.runtime.getReceiveRoute('source').route, 'p2p');
    assert.match(f.runtime.getReceiveRoute('source').error, /带宽/);
    f.runtime.leave();
    assert.equal(f.runtime.getReceiveRoute('source').mode, 'auto');
});

test('P2P-first sender pressure hints are session checked and do not force manual viewers to SFU', async (t) => {
    const f = await fixture(); t.after(() => f.runtime.leave());
    f.runtime.receivePressure({ peerId: 'source', roomId: 'other', voiceSessionGeneration: 1, reason: 'sender-uplink-pressure' });
    await flush(); assert.equal(f.runtime.getReceiveRoute('source').route, 'p2p');
    f.runtime.receivePressure({ peerId: 'source', roomId: 'room', voiceSessionGeneration: 1, reason: 'sender-encoder-pressure' });
    await flush(); assert.equal(f.runtime.getReceiveRoute('source').route, 'sfu');
    await f.runtime.setReceiveRoute('source', 'p2p');
    f.runtime.receivePressure({ peerId: 'source', roomId: 'room', voiceSessionGeneration: 1, reason: 'sender-encoder-pressure' });
    await flush(); assert.equal(f.runtime.getReceiveRoute('source').route, 'p2p');
});
