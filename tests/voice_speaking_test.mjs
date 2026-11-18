import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

test('speaking meter highlights energy with hold, clears mute/departure and never connects to an output', () => {
    const events = []; let tick; let time = 1000; let amplitude = 0;
    let disconnects = 0; let closes = 0;
    const track = { kind: 'audio', readyState: 'live', enabled: true };
    let sources = [{ id: 'peer', enabled: true, stream: { getAudioTracks: () => [track] } }];
    const context = { state: 'running', createAnalyser: () => ({ disconnect() { disconnects++; }, getFloatTimeDomainData(data) { data.fill(amplitude); } }),
        createMediaStreamSource: () => ({ connect(target) { assert.equal(typeof target.getFloatTimeDomainData, 'function'); }, disconnect() { disconnects++; } }),
        close: async () => { closes++; } };
    const window = { setTimeout, clearTimeout };
    vm.runInNewContext(readFileSync(new URL('../src/views/js/voice/voice-speaking-runtime.js', import.meta.url), 'utf8'), { window });
    const runtime = window.VoiceSpeakingRuntime.createRuntime({ getSources: () => sources, onSpeaking: (...args) => events.push(args),
        createContext: () => context, createStream: (value) => { assert.equal(value, track); return {}; },
        now: () => time, setTimer: (fn) => { tick = fn; }, clearTimer() {} });
    runtime.start(); assert.deepEqual(events, []);
    amplitude = .04; tick(); assert.deepEqual(events.at(-1), ['peer', true]);
    amplitude = 0; time += 200; tick(); assert.deepEqual(events.at(-1), ['peer', true]);
    time += 200; tick(); assert.deepEqual(events.at(-1), ['peer', false]);
    amplitude = .04; tick(); sources[0].enabled = false; tick(); assert.deepEqual(events.at(-1), ['peer', false]);
    assert.equal(disconnects, 2);
    sources = []; tick(); runtime.destroy(); assert.equal(closes, 1);
    assert.equal(track.readyState, 'live');
});

test('meter follows real RMS loudness, resets silence/mute/suspension and never captures or stops tracks', () => {
    let tick, amplitude = .005, closes = 0, disconnects = 0;
    const levels = [];
    const track = { readyState: 'live', enabled: true, muted: false };
    const context = { state: 'running',
        createAnalyser: () => ({ getFloatTimeDomainData: samples => samples.fill(amplitude), disconnect: () => disconnects++ }),
        createMediaStreamSource: () => ({ connect() {}, disconnect: () => disconnects++ }), close: async () => { closes++; } };
    const window = { setTimeout, clearTimeout };
    vm.runInNewContext(readFileSync(new URL('../src/views/js/voice/voice-speaking-runtime.js', import.meta.url), 'utf8'), { window });
    const runtime = window.VoiceSpeakingRuntime.createRuntime({
        getSources: () => [{ id: 'local-video', enabled: true, stream: { getAudioTracks: () => [track] } }],
        onSpeaking() {}, onLevel: (id, level) => { assert.equal(id, 'local-video'); levels.push(level); },
        createContext: () => context, createStream: () => ({}), setTimer: fn => { tick = fn; }, clearTimer() {} });
    runtime.start(); const quiet = levels.at(-1);
    amplitude = .04; tick(); const speech = levels.at(-1);
    amplitude = .2; tick(); const loud = levels.at(-1);
    assert.ok(quiet > 0 && quiet < speech && speech < loud && loud <= 1);
    amplitude = .005; tick(); assert.ok(levels.at(-1) < loud, 'release decays instead of staying full');
    amplitude = 0; tick(); assert.equal(levels.at(-1), 0, 'silence is empty even during speaking hold');
    amplitude = 1; tick(); assert.equal(levels.at(-1), 1);
    context.state = 'suspended'; tick(); assert.equal(levels.at(-1), 0);
    context.state = 'running'; track.muted = true; tick(); assert.equal(levels.at(-1), 0);
    assert.equal(disconnects, 2);
    track.muted = false; tick(); assert.equal(levels.at(-1), 1);
    track.enabled = false; tick(); assert.equal(levels.at(-1), 0);
    runtime.destroy(); assert.equal(closes, 1); assert.equal(track.readyState, 'live');
});
