import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchCaptureCadence, preparePiikNativeOverlay } from '../scripts/piik-native-overlay.mjs';

// Optional pinned dependency: the default Node suite also runs without the SDK.
const path = new URL('../integrations/piik/.deps/upstream/native/capture/windows/main.cpp', import.meta.url);
test('pinned native overlay reports actual codec and audio capabilities and retains capture ownership', { skip: !existsSync(path) && process.env.CI !== 'true' }, (t) => {
    assert.ok(existsSync(path), 'Run npm run build:piik -- --web-only before the CI suite');
    const original = readFileSync(path, 'utf8');
    const patched = patchCaptureCadence(original);
    assert.match(patched, /webrtc::FramerateController capture_cadence\(arguments.profile.frame_rate\)/);
    assert.match(patched, /capture_cadence.ShouldDropFrame\(signed_timestamp \* 100\)/);
    assert.doesNotMatch(patched, /next_output_timestamp|timing_tolerance|event=capture-frame/);
    for (const guard of ['timestamp <= previous_timestamp', 'selected target process exited', 'source_was_minimized', 'ApplyOutputControl(control, workers)', 'cleanup();'])
        assert.equal(patched.split(guard).length, original.split(guard).length, guard);
    assert.throws(() => patchCaptureCadence(patched), /context changed/);
    assert.throws(() => patchCaptureCadence(original.replace('frame_duration / 20', 'frame_duration / 10')), /context changed/);
    const output = mkdtempSync(join(tmpdir(), 'piik-native-overlay-'));
    t.after(() => rmSync(output, { recursive: true, force: true }));
    preparePiikNativeOverlay(fileURLToPath(new URL('../integrations/piik/.deps/upstream/', import.meta.url)), output);
    const capture = readFileSync(join(output, 'native-overlay/main.cpp'), 'utf8');
    const codecArguments = [...capture.matchAll(/WriteVideoActive\(writer, arguments, ([^,]+), output\);/g)].map(match => match[1]);
    assert.deepEqual(codecArguments, ['kind', 'kind']);
    assert.match(capture, /independentAudio[^\n]+process_audio \|\| process_audio_exclusion/);
    const outputFixture = readFileSync(join(output, 'native-overlay/output_worker.test.cpp'), 'utf8');
    assert.match(outputFixture, /WriteVideoActive\(writer, arguments, OutputKind::h264, output\);/);
    assert.match(outputFixture, /WriteVideoActive\(writer, arguments, OutputKind::av1, output\);/);
    assert.match(outputFixture, /LR"PIIK_FIXTURE\([^\n]+\/native\/fixtures\/h264-padding\/aperture\.h264\)PIIK_FIXTURE"/);
    assert.match(readFileSync(join(output, 'native-overlay/build.ps1'), 'utf8'),
        /@\('h264_encoder', 'audio_applications', 'process_audio', 'capture_target'\)/);
    assert.match(readFileSync(join(output, 'native-overlay/adaptive_encoder.test.cpp'), 'utf8'),
        /HardwareEncoder encoder\(piik::capture::OutputKind::h264, env, profile,/);
});
