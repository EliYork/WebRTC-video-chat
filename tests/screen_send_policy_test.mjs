import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const read = (name) =>
    readFileSync(
        new URL('../src/views/js/voice/' + name, import.meta.url),
        'utf8'
    );
function fixture() {
    const window = {};
    vm.runInNewContext(read('voice-screen-send-policy.js'), { window });
    let parameters = {
        encodings: [{ maxBitrate: 1234 }],
        degradationPreference: 'balanced',
    };
    let count = 0;
    const track = {
        kind: 'video',
        getSettings: () => ({ width: 3840, height: 2160 }),
    };
    const sender = {
        track,
        getParameters: () => structuredClone(parameters),
        setParameters: async (value) => {
            parameters = value;
            count++;
        },
    };
    const pc = { getSenders: () => [sender] };
    return {
        api: window.VoiceScreenSendPolicy,
        track,
        sender,
        pc,
        params: () => parameters,
        count: () => count,
    };
}
test('game mode preserves resolution and 60fps target, obeys shared P2P budget and restores desktop detail mode', async () => {
    const f = fixture();
    f.api.register(f.track, { frameRate: 60, mode: 'game', maxBitrate: 6000000 });
    await f.api.apply(f.pc);
    assert.equal(f.track.contentHint, 'motion');
    assert.equal(f.params().degradationPreference, 'maintain-resolution');
    assert.equal(f.params().encodings[0].maxBitrate, 6000000);
    f.api.register(f.track, { frameRate: 30, mode: 'detail', maxBitrate: 5500000 });
    await f.api.apply(f.pc);
    assert.equal(f.track.contentHint, 'detail');
    assert.equal(f.params().degradationPreference, 'maintain-resolution');
    assert.equal(f.params().encodings[0].maxBitrate, 5500000);
});
test('screen policy applies 4K60 limits and restores prior settings for camera', async () => {
    const f = fixture();
    await f.api.apply(f.pc);
    assert.equal(f.count(), 0);
    f.api.register(f.track, { frameRate: 60 });
    await f.api.apply(f.pc);
    assert.equal(f.track.contentHint, 'detail');
    assert.equal(f.params().encodings[0].maxBitrate, 27000000);
    assert.equal(f.params().encodings[0].maxFramerate, 60);
    assert.equal(f.params().degradationPreference, 'maintain-resolution');
    f.sender.track = { kind: 'video' };
    await f.api.apply(f.pc);
    assert.equal(f.params().encodings[0].maxBitrate, 1234);
    assert.equal(f.params().encodings[0].maxFramerate, undefined);
    assert.equal(f.params().degradationPreference, 'balanced');
});

test('duplicate connection callbacks skip writes but changed parameters are repaired', async () => {
    const f = fixture();
    f.api.register(f.track, { frameRate: 60 });
    await Promise.all([
        f.api.apply(f.pc),
        f.api.apply(f.pc),
        f.api.apply(f.pc),
    ]);
    assert.equal(f.count(), 1);
    f.params().encodings[0].maxBitrate = 1000000;
    await f.api.apply(f.pc);
    assert.equal(f.count(), 2);
    assert.equal(f.params().encodings[0].maxBitrate, 27000000);
});

test('same playing stream is not rebound, paused playback and forced rebind still work', () => {
    const window = {};
    vm.runInNewContext(read('voice-media-lifecycle.js'), { window });
    const attach = window.VoiceMediaLifecycle.attachAndPlayMedia;
    let current;
    let assignments = 0;
    let plays = 0;
    const mediaElement = {
        readyState: 4,
        paused: false,
        get srcObject() {
            return current;
        },
        set srcObject(value) {
            current = value;
            assignments++;
        },
        play() {
            plays++;
            this.paused = false;
        },
        pause() {
            this.paused = true;
        },
        load() {},
    };
    const stream = {};
    attach({ mediaElement, stream });
    attach({ mediaElement, stream });
    assert.equal(assignments, 1);
    assert.equal(plays, 1);
    mediaElement.paused = true;
    attach({ mediaElement, stream });
    assert.equal(assignments, 1);
    assert.equal(plays, 2);
    attach({ mediaElement, stream, forceRebind: true });
    assert.equal(assignments, 3);
    assert.equal(plays, 3);
});
test('unsupported parameters fail safely and later retries can succeed', async () => {
    const f = fixture();
    f.api.register(f.track, { frameRate: 30 });
    const original = f.sender.setParameters;
    f.sender.setParameters = async () => {
        throw Error('unsupported');
    };
    let warnings = 0;
    await f.api.apply(f.pc, () => warnings++);
    assert.equal(warnings, 1);
    f.sender.setParameters = original;
    await f.api.apply(f.pc);
    assert.equal(f.params().encodings[0].maxBitrate, 27000000);
});
test('all capture sizes retain the detail budget at 15, 30 and 60 fps', async () => {
    for (const [width, height] of [[1280, 720], [1920, 1080], [2560, 1440], [3840, 2160]]) {
        for (const frameRate of [15, 30, 60]) {
            const f = fixture();
            f.track.getSettings = () => ({ width, height });
            f.api.register(f.track, { frameRate });
            await f.api.apply(f.pc);
            assert.equal(f.params().encodings[0].maxBitrate, 27000000);
            assert.equal(f.params().encodings[0].maxFramerate, frameRate);
            assert.equal(f.params().encodings[0].scaleResolutionDownBy, 1);
            assert.equal(f.params().degradationPreference, 'maintain-resolution');
        }
    }
});
test('capture, initial call, connected retry and replacement hook policy', () => {
    assert.match(
        read('voice-media-lifecycle.js'),
        /VoiceScreenSendPolicy\?\.register/
    );
    const source = read('voice-peer-registry.js');
    assert.match(
        source,
        /promoteOutgoing\(entry, record, 'connected'\);\s*void global.VoiceScreenSendPolicy/
    );
    assert.match(
        source,
        /bindCall\(entry, 'outgoing', record\);\s*void global.VoiceScreenSendPolicy/
    );
    assert.match(
        source,
        /record.generation = normalizedGeneration;\s*await global.VoiceScreenSendPolicy/
    );
});

test('readback detects ignored sender fields and later browser drift without exposing raw RTP parameters', async () => {
    const f = fixture();
    f.api.register(f.track, { frameRate: 60 });
    f.sender.setParameters = async () => {}; // Browser accepts call but ignores values.
    await f.api.apply(f.pc);
    let result = f.api.getReadback(f.pc)[0];
    assert.equal(result.请求.encodings[0].maxBitrate, 27000000);
    assert.equal(result.实际接受.encodings[0].maxBitrate, 1234);
    assert.ok(result.不一致字段.includes('encodings[0].maxBitrate'));
    f.params().encodings[0].ssrc = 'secret';
    assert.doesNotMatch(JSON.stringify(f.api.getReadback(f.pc)), /secret|ssrc/);
    f.sender.track = { kind: 'video' };
    assert.equal(f.api.getReadback(f.pc).length, 0, 'camera does not inherit screen diagnostics');
    result = f.api.getReadback({ getSenders: () => [] });
    assert.equal(result.length, 0);
});

test('SFU observation retains independent start hint and failures; readback compares actual settings each time', () => {
    const f = fixture();
    f.api.observe(f.sender, { encodings: [{ maxBitrate: 5500000 }] }, { path: 'SFU', startBitrateKbps: 1500, status: 'failed' });
    const result = f.api.getReadback(f.pc)[0];
    assert.equal(result.路径, 'SFU');
    assert.equal(result.启动码率提示_kbps, 1500);
    assert.equal(result.状态, 'failed');
    assert.equal(result.实际接受.encodings[0].maxBitrate, 1234);
});
