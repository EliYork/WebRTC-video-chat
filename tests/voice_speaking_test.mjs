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
