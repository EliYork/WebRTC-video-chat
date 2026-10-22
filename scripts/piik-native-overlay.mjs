// Piik 9925486c: replace its jitter-sensitive WGC pacing with the already
// linked WebRTC controller. Generated sources/build script stay ignored.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function patchCaptureCadence(text) {
    const edits = [
        ['#include "adaptive_encoder.h"', '#include "adaptive_encoder.h"\n#include "common_video/framerate_controller.h"'],
        ['UINT64 next_output_timestamp = 0;', 'webrtc::FramerateController capture_cadence(arguments.profile.frame_rate);'],
        [`      const UINT64 timing_tolerance = frame_duration / 20;
      if (next_output_timestamp != 0 && timestamp < next_output_timestamp &&
          next_output_timestamp - timestamp > timing_tolerance) {`,
        `      // WGC uses 100 ns units; WebRTC expects nanoseconds. Its half-frame
      // pacing tolerates capture jitter without skipping the following slot.
      if (capture_cadence.ShouldDropFrame(signed_timestamp * 100)) {`],
        [`      if (next_output_timestamp == 0) {
        next_output_timestamp = timestamp + frame_duration;
      } else {
        const UINT64 elapsed = timestamp > next_output_timestamp
                                   ? timestamp - next_output_timestamp
                                   : 0;
        next_output_timestamp +=
            (elapsed / frame_duration + 1) * frame_duration;
      }
`, ''],
    ];
    text = text.replaceAll('\r\n', '\n');
    for (const [before, after] of edits) {
        if (text.split(before).length !== 2)
            throw Error('Piik native cadence overlay context changed');
        text = text.replace(before, after);
    }
    return text;
}

export function preparePiikNativeOverlay(source, out) {
    const directory = join(out, 'native-overlay');
    const native = join(source, 'native/capture/windows');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'main.cpp'), patchCaptureCadence(readFileSync(join(native, 'main.cpp'), 'utf8')));
    // Reuse upstream SDK discovery, compiler, libraries and checks unchanged.
    const quote = path => `'${path.replaceAll("'", "''")}'`;
    let script = readFileSync(join(native, 'build.ps1'), 'utf8').replaceAll('\r\n', '\n');
    const edits = [
        ['$helperDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path', `$helperDirectory = ${quote(native)}`],
        ["$source = Join-Path $helperDirectory ($name + '.cpp')", `$source = if ($name -eq 'main') { ${quote(join(directory, 'main.cpp'))} } else { Join-Path $helperDirectory ($name + '.cpp') }`],
        ["$systemLibraries = '", `$compileFlags += ' /I "${native}"'\n$systemLibraries = '`],
    ];
    for (const [before, after] of edits) {
        if (script.split(before).length !== 2)
            throw Error('Piik native build overlay context changed');
        script = script.replace(before, after);
    }
    const path = join(directory, 'build.ps1');
    writeFileSync(path, script);
    return path;
}
