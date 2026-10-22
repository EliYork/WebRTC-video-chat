import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { patchCaptureCadence } from '../scripts/piik-native-overlay.mjs';

// Optional pinned dependency: the default Node suite also runs without the SDK.
const path = new URL('../integrations/piik/.deps/upstream/native/capture/windows/main.cpp', import.meta.url);
test('pinned native overlay replaces WGC cadence and retains capture ownership/cleanup', { skip: !existsSync(path) }, () => {
    const original = readFileSync(path, 'utf8');
    const patched = patchCaptureCadence(original);
    assert.match(patched, /webrtc::FramerateController capture_cadence\(arguments.profile.frame_rate\)/);
    assert.match(patched, /capture_cadence.ShouldDropFrame\(signed_timestamp \* 100\)/);
    assert.doesNotMatch(patched, /next_output_timestamp|timing_tolerance|event=capture-frame/);
    for (const guard of ['timestamp <= previous_timestamp', 'selected target process exited', 'source_was_minimized', 'ApplyOutputControl(control, workers)', 'cleanup();'])
        assert.equal(patched.split(guard).length, original.split(guard).length, guard);
    assert.throws(() => patchCaptureCadence(patched), /context changed/);
    assert.throws(() => patchCaptureCadence(original.replace('frame_duration / 20', 'frame_duration / 10')), /context changed/);
});
