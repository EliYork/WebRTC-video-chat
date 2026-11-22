import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { editOnce } from './piik-client-overlay.mjs';

export function preparePiikShareOverlay(source, out, Replace) {
    const directory = join(out, 'share-overlay');
    mkdirSync(directory, { recursive: true });
    const patch = (file, edits) => {
        let text = readFileSync(join(source, file), 'utf8').replaceAll('\r\n', '\n');
        for (const [before, after] of edits) text = editOnce(text, before, after);
        const generated = join(directory, file.replaceAll('/', '_'));
        writeFileSync(generated, text);
        Replace[join(source, file)] = generated;
    };
    for (const [pkg, name] of [['nativecapture', 'platform_audio.go'], ['nativecapture', 'platform_failure.go'],
        ['nativecapture', 'platform_host_windows.go'], ['nativecapture', 'platform_host_other.go'],
        ['nativehost', 'platform_share.go'], ['nativecontrol', 'platform_share.go']]) {
        Replace[join(source, 'internal/app', pkg, name)] = resolve(import.meta.dirname, 'piik-share', pkg, name);
    }
    for (const [pkg, name] of [['nativehost', 'platform_share_test.go'], ['nativecapture', 'platform_failure_test.go'], ['nativecontrol', 'platform_share_test.go']]) {
        Replace[join(source, 'internal/app', pkg, name)] = resolve(import.meta.dirname, 'piik-share', pkg, name);
    }
    patch('internal/app/nativehost/session_test.go', [['func TestMain(tests *testing.M) {', 'func TestMain(tests *testing.M) {\n\tif os.Getenv("PIIK_NATIVEHOST_PIPE_FIXTURE") == "platform-audio" { runPlatformAudioFixture(); os.Exit(0) }']]);
    patch('internal/app/loopback/server.go', [[
        'type NativeMediaCapabilities struct {', 'type NativeMediaCapabilities struct {\n\tIndependentAudio bool `json:"independentAudio,omitempty"`',
    ]]);
    patch('internal/app/nativecapture/probe.go', [
        ['type Capabilities struct {', 'type Capabilities struct {\n\tIndependentAudio bool `json:"independentAudio,omitempty"`'],
        ['HardwareH264 []Encoder', 'HardwareAV1 []Encoder `json:"hardwareAv1,omitempty"`\n\tHardwareH264 []Encoder'],
        ['len(adapter.HardwareH264) > maxEncoders {', 'len(adapter.HardwareH264) > maxEncoders || len(adapter.HardwareAV1) > maxEncoders {'],
        ['encoderIndexes := make(map[uint32]struct{}, len(adapter.HardwareH264))\n\t\tfor _, encoder := range adapter.HardwareH264 {', 'for _, encoders := range [][]Encoder{adapter.HardwareH264, adapter.HardwareAV1} {\n\t\tencoderIndexes := make(map[uint32]struct{}, len(encoders))\n\t\tfor _, encoder := range encoders {'],
        ['encoderIndexes[encoder.Index] = struct{}{}\n\t\t}\n\t}', 'encoderIndexes[encoder.Index] = struct{}{}\n\t\t}\n\t\t}\n\t}'],
    ]);
    patch('internal/app/app.go', [['Video:                        summary.Video,',
        'IndependentAudio:             capabilities.Platform == "windows" && capabilities.IndependentAudio,\n\t\t\tVideo:                        summary.Video,']]);
    patch('internal/app/nativecontrol/wire.go', [[
        'type startShareRequest struct {', 'type startShareRequest struct {\n\tAudioMode string `json:"audioMode,omitempty"`\n\tAudioTarget *nativecapture.ProcessAudioTarget `json:"audioTarget,omitempty"`',
    ], ['Code string `json:"code"`', 'Code string `json:"code"`\n\tReason string `json:"reason,omitempty"`'],
    ['type shareEndedEvent struct {', 'type shareEndedEvent struct {\n\tReason string `json:"reason,omitempty"`']]);
    patch('internal/app/nativecontrol/session.go', [
        ['case "capture-options":', 'case "platform-audio-sources", "platform-share-status":\n\t\treturn session.platformRequest(ctx, envelope, payload)\n\tcase "capture-options":'],
        ['case "start-share":', 'case "start-share", "platform-start-share":'],
        ['request.Codec != "h264" && request.Codec != "vp8"', 'request.Codec != "h264" && request.Codec != "vp8" && request.Codec != "av1"'],
        ['host, err := nativehost.Start(ctx, nativehost.Options{', 'if err := session.validatePlatformAudio(ctx, &request); err != nil { return nil, err }\n\thost, err := nativehost.Start(ctx, nativehost.Options{'],
        ['MicrophoneMixing: request.MicrophoneMixing && session.capabilities.Microphone,', 'PlatformAudioMode: request.AudioMode,\n\t\tPlatformAudioTarget: request.AudioTarget,\n\t\tMicrophoneMixing: request.MicrophoneMixing && session.capabilities.Microphone,'],
        ['AudioEnabled: request.Audio && session.capabilities.Summary().AudioFor(\n\t\t\trequest.Source.Kind,\n\t\t),', 'AudioEnabled: request.Audio && (request.AudioMode != "" || session.capabilities.Summary().AudioFor(request.Source.Kind)),'],
        ['Code:             "operation-failed",', 'Code:             "operation-failed",\n\t\tReason: platformFailureReason(request.Type, causes),'],
        ['ShareID: host.ShareID(),\n\t\t\tFailed:  err != nil,', 'ShareID: host.ShareID(),\n\t\t\tFailed:  err != nil,\n\t\t\tReason: host.PlatformEndReason(err),'],
    ]);
    patch('internal/app/nativehost/session.go', [
        ['type Options struct {', 'type Options struct {\n\tPlatformAudioMode string\n\tPlatformAudioTarget *nativecapture.ProcessAudioTarget'],
        ['type Session struct {', 'type Session struct {\n\tplatformMode string\n\tplatformCapture CaptureState\n\tplatformAudioFailed bool'],
        ['case nativecapture.FrameH264, nativecapture.FrameVP8:', 'case nativecapture.FrameH264, nativecapture.FrameVP8, nativecapture.FrameAV1:'],
        ['(frame.Kind == nativecapture.FrameH264) != (session.source.Codec() == "h264")', '!frame.MatchesVideoCodec(session.source.Codec())'],
        ['state.Codec != "h264" && state.Codec != "vp8"', 'state.Codec != "h264" && state.Codec != "vp8" && state.Codec != "av1"'],
        ['state.HardwareOnly != (state.Codec == "h264")', 'state.HardwareOnly != (state.Codec != "vp8")'],
        ['(state.Codec == "h264" && state.EncoderIndex == nil)', '(state.HardwareOnly && state.EncoderIndex == nil)'],
        ['(state.Codec == "vp8" && state.ProfileLevelID != "")', '(state.Codec != "h264" && state.ProfileLevelID != "")'],
        ['options.Video.Target,\n\t\t\toptions.ExcludeAudio,', 'platformAudioTarget(options),\n\t\t\taudioExclusion,'],
        ['var audioStream *nativecapture.Stream\n\tif options.AudioEnabled', 'if err := validatePlatformHostAudio(options); err != nil { _ = stream.Close(); _ = engine.Close(); return nil, err }\n\taudioExclusion := platformAudioExclusion(options)\n\tif options.PlatformAudioMode == "system" && audioExclusion == nil { _ = stream.Close(); _ = engine.Close(); return nil, nativecapture.PlatformError("system-exclusion-unavailable") }\n\tvar audioStream *nativecapture.Stream\n\tif options.AudioEnabled'],
        ['if audioErr != nil {\n\t\t\tslog.DebugContext(parent,', 'if audioErr != nil {\n\t\t\tif options.PlatformAudioMode != "" { _ = stream.Close(); _ = engine.Close(); return nil, nativecapture.PlatformError("audio-capture-failed") }\n\t\t\tslog.DebugContext(parent,'],
        ['shareID:        options.ShareID,', 'platformMode: options.PlatformAudioMode,\n\t\tshareID:        options.ShareID,'],
        ['if options.MicrophoneMixing {\n\t\tif session.audioSource == nil', 'if options.PlatformAudioMode != "" && options.AudioEnabled && session.audioSource == nil { cancel(); _ = stream.Close(); _ = engine.Close(); return nil, nativecapture.PlatformError("audio-capture-failed") }\n\tif options.MicrophoneMixing {\n\t\tif session.audioSource == nil'],
        ['status.applyBackend(&session.videoOptions)', 'session.platformObserve(status)\n\t\t\tstatus.applyBackend(&session.videoOptions)'],
        ['state.applyBackend(&options)\n\t\tsession.stream', 'session.platformCapture = CaptureState{}\n\t\tsession.platformObserve(state)\n\t\tstate.applyBackend(&options)\n\t\tsession.stream'],
        ['state.AdapterIndex, state.EncoderIndex = starting.AdapterIndex, starting.EncoderIndex', 'state.AdapterName, state.EncoderName = starting.AdapterName, starting.EncoderName\n\t\t\t\tstate.AdapterIndex, state.EncoderIndex = starting.AdapterIndex, starting.EncoderIndex'],
        ['"eof", errors.Is(err, io.EOF), diagnostics.Error(err))\n\t\t\treturn fail(errors.New("native capture process stopped unexpectedly"))', '"eof", errors.Is(err, io.EOF), diagnostics.Error(err))\n\t\t\treturn fail(err)'],
        ['slog.DebugContext(session.ctx, "piik-client", "event", "capture-audio-stream-ended",', 'session.mu.Lock(); session.platformAudioFailed = true; session.mu.Unlock()\n\t\tslog.DebugContext(session.ctx, "piik-client", "event", "capture-audio-stream-ended",'],
        ['audioEnabled bool,\n\texcludeAudio *nativecapture.CaptureTarget,\n) error {', 'audioEnabled bool,\n\texcludeAudio *nativecapture.CaptureTarget,\n) error {\n\tif session.platformMode != "" && session.platformMode != "none" { return errors.New("independent audio requires restarting the share") }'],
    ]);
    patch('internal/app/nativecapture/stream.go', [
        ['options.Codec != "auto" && options.Codec != "h264" && options.Codec != "vp8"', 'options.Codec != "auto" && options.Codec != "h264" && options.Codec != "vp8" && options.Codec != "av1"'],
        ['frame.Kind != FrameH264 && frame.Kind != FrameVP8', 'frame.Kind != FrameH264 && frame.Kind != FrameVP8 && frame.Kind != FrameAV1'],
        ['type Stream struct {', 'type Stream struct {\n\tplatformExited chan struct{}\n\tplatformFailure error'],
        ['stream := &Stream{\n\t\tcancel:', 'stream := &Stream{\n\t\tplatformExited: make(chan struct{}),\n\t\tcancel:'],
        ['stream.done <- waitErr', 'stream.platformFailure = classifyPlatformCaptureFailure(stderr.Bytes())\n\t\tclose(stream.platformExited)\n\t\tstream.done <- waitErr'],
        ['return frame, err\n}', 'if err != nil { err = stream.platformReadFailure(err) }\n\treturn frame, err\n}'],
        ['ready <- errors.New("native audio capture did not become ready")', 'ready <- readErr'],
    ]);
    patch('internal/app/nativecapture/protocol.go', [
        ['FrameControl          FrameKind = 7', 'FrameControl          FrameKind = 7\n\tFrameAV1              FrameKind = 8'],
        ['kind > FrameControl', 'kind > FrameAV1'],
        ['isVideo := kind == FrameH264 || kind == FrameVP8', 'isVideo := kind == FrameH264 || kind == FrameVP8 || kind == FrameAV1'],
        ['type Frame struct {', 'func (frame Frame) MatchesVideoCodec(codec string) bool {\n\treturn frame.Kind == FrameH264 && codec == "h264" || frame.Kind == FrameVP8 && codec == "vp8" || frame.Kind == FrameAV1 && codec == "av1"\n}\n\ntype Frame struct {'],
    ]);
    patch('internal/app/mediaedge/engine.go', [
        ['var videoCodecs = map[string]webrtc.RTPCodecParameters{', 'var videoCodecs = map[string]webrtc.RTPCodecParameters{\n\t"av1": {RTPCodecCapability: webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeAV1, ClockRate: videoClockRate, SDPFmtpLine: "profile=0;level-idx=13;tier=0", RTCPFeedback: h264Capability.RTCPFeedback}, PayloadType: 104},'],
        ['[]string{"h264", "vp8"}', '[]string{"h264", "vp8", "av1"}'],
    ]);
    // AV1 forwarding is supported from a native capture source. The native
    // relay's optional decode/resize path still accepts its existing codecs.
    patch('internal/app/mediaedge/receiver.go', [
        ['if _, supported := videoCodecs[name]; !supported {', 'if _, supported := videoCodecs[name]; !supported || name == "av1" {'],
    ]);
    patch('internal/media/forwarding/source.go', [
        ['!strings.EqualFold(options.Codec.MimeType, webrtc.MimeTypeVP8))', '!strings.EqualFold(options.Codec.MimeType, webrtc.MimeTypeVP8) &&\n\t\t\t!strings.EqualFold(options.Codec.MimeType, webrtc.MimeTypeAV1))'],
    ]);
    patch('internal/media/forwarding/encoded_source.go', [
        ['payloader = &codecs.VP8Payloader{EnablePictureID: true}\n\t\t}', 'payloader = &codecs.VP8Payloader{EnablePictureID: true}\n\t\t} else if options.Codec.MimeType == webrtc.MimeTypeAV1 {\n\t\t\tpayloader = &codecs.AV1Payloader{}\n\t\t}'],
    ]);
}
