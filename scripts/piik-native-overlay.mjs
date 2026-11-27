// Piik 9925486c: replace its jitter-sensitive WGC pacing with the already
// linked WebRTC controller. Generated sources/build script stay ignored.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { editOnce } from './piik-client-overlay.mjs';
import { patchAv1Capture, patchAv1CaptureHeader, patchAv1EncoderHeader, patchAv1Encoder, patchAv1AdaptiveEncoder } from './piik-av1-capture-overlay.mjs';

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
    // Resolve quoted includes consistently across generated and unchanged files.
    for (const file of readdirSync(native)) {
        if (/\.(?:h|cpp)$/.test(file)) copyFileSync(join(native, file), join(directory, file));
    }
    let main = patchCaptureCadence(readFileSync(join(native, 'main.cpp'), 'utf8'));
    main = editOnce(main, 'int wmain(int argc, wchar_t** argv) {\n  try {\n    ProductArguments',
        'namespace piik::capture { int WriteAudioApplications(); }\nint wmain(int argc, wchar_t** argv) {\n  if (argc == 2 && wcscmp(argv[1], L"--list-audio-applications") == 0) return piik::capture::WriteAudioApplications();\n  try {\n    ProductArguments');
    main = editOnce(main, '<< ",\\"microphone\\":true,\\"softwareVP8\\":true"',
        '<< ",\\"independentAudio\\":" << (process_audio || process_audio_exclusion ? "true" : "false")\n         << ",\\"microphone\\":true,\\"softwareVP8\\":true"');
    writeFileSync(join(directory, 'main.cpp'), patchAv1Capture(main));
    const statusTestPath = join(directory, 'output_worker.test.cpp');
    let statusTest = readFileSync(statusTestPath, 'utf8').replaceAll('\r\n', '\n');
    statusTest = editOnce(statusTest, 'WriteVideoActive(writer, arguments, true, output);',
        'WriteVideoActive(writer, arguments, OutputKind::h264, output);');
    statusTest = editOnce(statusTest, '  assert(status.find("42c01f") == std::string::npos);', String.raw`  assert(status.find("42c01f") == std::string::npos);
  WriteVideoActive(writer, arguments, OutputKind::av1, output);
  assert(ReadFile(read, bytes.data(), static_cast<DWORD>(bytes.size()), &count, nullptr));
  const std::string av1_status(bytes.data(), count);
  assert(av1_status.find("\"codec\":\"av1\"") != std::string::npos);
  assert(av1_status.find("\"hardwareOnly\":true") != std::string::npos);
  assert(av1_status.find("profileLevelId") == std::string::npos);`);
    const apertureFixture = join(source, 'native/fixtures/h264-padding/aperture.h264').replaceAll('\\', '/');
    statusTest = editOnce(statusTest, `std::filesystem::path(__FILE__).parent_path().parent_path().parent_path() /
      "fixtures" / "h264-padding" / "aperture.h264"`,
    `std::filesystem::path(LR"PIIK_FIXTURE(${apertureFixture})PIIK_FIXTURE")`);
    writeFileSync(statusTestPath, statusTest);
    const adaptiveTestPath = join(directory, 'adaptive_encoder.test.cpp');
    writeFileSync(adaptiveTestPath, editOnce(readFileSync(adaptiveTestPath, 'utf8'),
        'HardwareEncoder encoder(env, profile,',
        'HardwareEncoder encoder(piik::capture::OutputKind::h264, env, profile,'));
    const h264Path = join(directory, 'h264_encoder.cpp');
    const h264 = readFileSync(join(native, 'h264_encoder.cpp'), 'utf8').replaceAll('\r\n', '\n');
    // Follow Piik f7e703e: request and validate the same Constrained Baseline profile.
    const configured = editOnce(h264, 'MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_Base)', 'MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_ConstrainedBase)');
    writeFileSync(h264Path, patchAv1Encoder(editOnce(configured, 'eAVEncH264VProfile_Base, "output-type-profile"', 'eAVEncH264VProfile_ConstrainedBase, "output-type-profile"')));
    for (const [file, patch] of [
        ['capture_output.h', patchAv1CaptureHeader],
        ['h264_encoder.h', patchAv1EncoderHeader],
        ['adaptive_encoder.cpp', patchAv1AdaptiveEncoder],
    ]) {
        writeFileSync(join(directory, file), patch(readFileSync(join(native, file), 'utf8').replaceAll('\r\n', '\n')));
    }
    // Reuse upstream SDK discovery, compiler, libraries and checks unchanged.
    const quote = path => `'${path.replaceAll("'", "''")}'`;
    let script = readFileSync(join(native, 'build.ps1'), 'utf8').replaceAll('\r\n', '\n');
    const edits = [
        ['$helperDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path', `$helperDirectory = ${quote(native)}`],
        ["$source = Join-Path $helperDirectory ($name + '.cpp')", `$source = if ($name -eq 'audio_applications') { ${quote(join(import.meta.dirname, 'piik-share/audio-applications.cpp'))} } else { Join-Path ${quote(directory)} ($name + '.cpp') }`],
        ["$source = Join-Path $helperDirectory ($name + '.test.cpp')", `$source = Join-Path ${quote(directory)} ($name + '.test.cpp')`],
        ["$source = Join-Path $helperDirectory 'frame_converter.probe.cpp'", `$source = Join-Path ${quote(directory)} 'frame_converter.probe.cpp'`],
        ["$systemLibraries = '", `$compileFlags += ' /I "${native}"'\n$systemLibraries = '`],
        ["@('h264_encoder', 'process_audio', 'capture_target')", "@('h264_encoder', 'audio_applications', 'process_audio', 'capture_target')"],
    ];
    for (const [before, after] of edits) {
        if (script.split(before).length !== 2)
            throw Error('Piik native build overlay context changed');
        script = script.replace(before, after);
    }
    script = editOnce(script, "@('main', 'process_audio', 'capture_target', 'h264_encoder', 'adaptive_encoder')", "@('main', 'audio_applications', 'process_audio', 'capture_target', 'h264_encoder', 'adaptive_encoder')");
    const path = join(directory, 'build.ps1');
    writeFileSync(path, script);
    return path;
}
