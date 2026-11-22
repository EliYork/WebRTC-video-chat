import { editOnce } from './piik-client-overlay.mjs';

const edit = (text, changes) => changes.reduce((value, [before, after]) => editOnce(value, before, after), text);

export function patchAv1CaptureHeader(text) {
    return edit(text, [
        ['unavailable = 6', 'unavailable = 6, av1 = 8'],
    ]);
}

export function patchAv1EncoderHeader(text) {
    return edit(text, [
        ['bool require_candidate = true);', 'bool require_candidate = true);\nActivationList EnumerateHardwareEncoders(const Adapter& adapter, bool require_candidate, OutputKind kind);'],
        ['VideoProfile profile = kDefaultVideoProfile);', 'VideoProfile profile = kDefaultVideoProfile);\n  LiveEncoder(SelectedTransform selected, VideoProfile profile, OutputKind kind);'],
        ['bool started_ = false;', 'bool started_ = false;\n  bool av1_has_key_frame_ = false;'],
    ]);
}

export function patchAv1Encoder(text) {
    return edit(text, [
        [`bool require_candidate) {\n  ComPtr<IMFAttributes>`, `bool require_candidate) {\n  return EnumerateHardwareEncoders(adapter, require_candidate, OutputKind::h264);\n}\n\nActivationList EnumerateHardwareEncoders(const Adapter& adapter, bool require_candidate, OutputKind kind) {\n  ComPtr<IMFAttributes>`],
        ['MFT_REGISTER_TYPE_INFO output = {MFMediaType_Video, MFVideoFormat_H264};', 'MFT_REGISTER_TYPE_INFO output = {MFMediaType_Video,\n      kind == OutputKind::av1 ? MFVideoFormat_AV1 : MFVideoFormat_H264};'],
        ['"selected adapter exposed no hardware NV12-to-H264 MFT"', '"selected adapter exposed no compatible hardware NV12 encoder"'],
        [`ComPtr<IMFMediaType> CreateOutputType(\n    const VideoProfile& profile) {`, `static ComPtr<IMFMediaType> CreateOutputType(\n    const VideoProfile& profile, OutputKind kind) {`],
        ['type->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_H264)', 'type->SetGUID(MF_MT_SUBTYPE, kind == OutputKind::av1 ? MFVideoFormat_AV1 : MFVideoFormat_H264)'],
        ['eAVEncH264VProfile_ConstrainedBase)', 'kind == OutputKind::av1 ? static_cast<UINT32>(eAVEncAV1VProfile_Main_420_8) : static_cast<UINT32>(eAVEncH264VProfile_ConstrainedBase))'],
        ['ComPtr<IMFMediaType> CreateInputType(', 'ComPtr<IMFMediaType> CreateOutputType(const VideoProfile& profile) {\n  return CreateOutputType(profile, OutputKind::h264);\n}\n\nComPtr<IMFMediaType> CreateInputType('],
        [`void ValidateMediaTypes(\n    IMFTransform* transform,\n    const VideoProfile& profile) {`, `static void ValidateMediaTypes(\n    IMFTransform* transform, const VideoProfile& profile, OutputKind kind) {`],
        ['if (subtype != MFVideoFormat_H264) {\n    Fail("output-type-subtype-weakened", "output is not H264");', 'if (subtype != (kind == OutputKind::av1 ? MFVideoFormat_AV1 : MFVideoFormat_H264)) {\n    Fail("output-type-subtype-weakened", "output differs from the requested codec");'],
        ['eAVEncH264VProfile_ConstrainedBase, "output-type-profile"', 'kind == OutputKind::av1 ? static_cast<UINT32>(eAVEncAV1VProfile_Main_420_8) : static_cast<UINT32>(eAVEncH264VProfile_ConstrainedBase), "output-type-profile"'],
        ['void ValidateCodecReadback(', 'void ValidateMediaTypes(IMFTransform* transform, const VideoProfile& profile) {\n  ValidateMediaTypes(transform, profile, OutputKind::h264);\n}\n\nvoid ValidateCodecReadback('],
        [`    VideoProfile profile)\n    : VideoEncoder(OutputKind::h264, selected.name, selected.clsid),`, `    VideoProfile profile)\n    : LiveEncoder(std::move(selected), profile, OutputKind::h264) {}\n\nLiveEncoder::LiveEncoder(SelectedTransform selected, VideoProfile profile, OutputKind kind)\n    : VideoEncoder(kind, selected.name, selected.clsid),`],
        ['CreateOutputType(profile_)', 'CreateOutputType(profile_, kind)'],
        ['ValidateMediaTypes(selected_.transform.Get(), profile_);', 'ValidateMediaTypes(selected_.transform.Get(), profile_, kind);'],
        [`    NalSummary nal = InspectAnnexB(bytes);`, `    if (kind == OutputKind::av1) {\n      const bool recovery = MFGetAttributeUINT32(output.Get(), MFSampleExtension_CleanPoint, FALSE) != FALSE;\n      if (!av1_has_key_frame_ && !recovery) {\n        Fail("bitstream-recovery-unit", "initial AV1 output is not a key frame");\n      }\n      av1_has_key_frame_ = av1_has_key_frame_ || recovery;\n      RequireEncoderTime(probe_deadline);\n      return EncodedAccessUnit{timestamp100ns, recovery, std::move(bytes)};\n    }\n    NalSummary nal = InspectAnnexB(bytes);`],
    ]);
}

export function patchAv1AdaptiveEncoder(text) {
    return edit(text, [
        ['class HardwareEncoder final', `webrtc::VideoCodecType CodecType(OutputKind kind) {\n  if (kind == OutputKind::av1) return webrtc::kVideoCodecAV1;\n  if (kind == OutputKind::h264) return webrtc::kVideoCodecH264;\n  return webrtc::kVideoCodecVP8;\n}\n\nclass HardwareEncoder final`],
        ['HardwareEncoder(const webrtc::Environment& env, VideoProfile ceiling,', 'HardwareEncoder(OutputKind kind, const webrtc::Environment& env, VideoProfile ceiling,'],
        [': env_(env), ceiling_(ceiling), create_(std::move(create)),', ': kind_(kind), env_(env), ceiling_(ceiling), create_(std::move(create)),'],
        ['config->codecType != webrtc::kVideoCodecH264', 'config->codecType != CodecType(kind_)'],
        ['config->H264().numberOfTemporalLayers > 1', '(kind_ == OutputKind::h264 && config->H264().numberOfTemporalLayers > 1)'],
        ['encoder_->kind != OutputKind::h264', 'encoder_->kind != kind_'],
        [`      info.codecType = webrtc::kVideoCodecH264;\n      info.codecSpecific.H264 = {};\n      info.codecSpecific.H264.packetization_mode = webrtc::H264PacketizationMode::NonInterleaved;\n      info.codecSpecific.H264.idr_frame = access_unit.key_frame;`, `      info.codecType = CodecType(kind_);\n      if (kind_ == OutputKind::h264) {\n        info.codecSpecific.H264 = {};\n        info.codecSpecific.H264.packetization_mode = webrtc::H264PacketizationMode::NonInterleaved;\n        info.codecSpecific.H264.idr_frame = access_unit.key_frame;\n      }`],
        ['info.implementation_name = "Windows Media Foundation H264";', 'info.implementation_name = kind_ == OutputKind::av1 ? "Windows Media Foundation AV1" : "Windows Media Foundation H264";'],
        ['info.has_trusted_rate_controller = false;', '// AV1 uses the hardware CBR controller configured and verified by LiveEncoder.\n    info.has_trusted_rate_controller = kind_ == OutputKind::av1;'],
        ['info.is_qp_trusted = true;\n    info.scaling_settings = ScalingSettings(24, 37);', 'info.is_qp_trusted = kind_ == OutputKind::h264;\n    if (info.is_qp_trusted) info.scaling_settings = ScalingSettings(24, 37);'],
        ['  const webrtc::Environment env_;\n  const VideoProfile ceiling_;', '  const OutputKind kind_;\n  const webrtc::Environment env_;\n  const VideoProfile ceiling_;'],
        ['kind_ == OutputKind::h264 ? webrtc::kVideoCodecH264 : webrtc::kVideoCodecVP8', 'CodecType(kind_)'],
        ['(kind_ == OutputKind::h264 ? "h264" : "vp8")', '(kind_ == OutputKind::av1 ? "av1" : kind_ == OutputKind::h264 ? "h264" : "vp8")'],
        ['if (kind_ == OutputKind::vp8) return {webrtc::SdpVideoFormat("VP8")};', 'if (kind_ == OutputKind::vp8) return {webrtc::SdpVideoFormat("VP8")};\n    if (kind_ == OutputKind::av1) return {webrtc::SdpVideoFormat("AV1", {{"profile", "0"}})};'],
        ['std::make_unique<HardwareEncoder>(env,', 'std::make_unique<HardwareEncoder>(kind_, env,'],
        ['(kind != OutputKind::vp8 && kind != OutputKind::h264)', '(kind != OutputKind::vp8 && kind != OutputKind::h264 && kind != OutputKind::av1)'],
        ['(kind == OutputKind::h264 && !create)', '(kind != OutputKind::vp8 && !create)'],
    ]);
}

export function patchAv1Capture(text) {
    const start = text.indexOf('VideoEncoderSelection SelectVideoEncoder(');
    const end = text.indexOf('struct CaptureInput final', start);
    if (start < 0 || end <= start) throw Error('Piik hardware selection context changed');
    const selection = edit(text.slice(start, end), [
        ['  const auto deadline', '  const auto kind = arguments.codec == "av1" ? OutputKind::av1 : OutputKind::h264;\n  const auto deadline'],
        ['EnumerateHardwareEncoders(adapter, false)', 'EnumerateHardwareEncoders(adapter, false, kind)'],
        ['const auto encoders = EnumerateHardwareEncoders(adapter);', 'const auto encoders = EnumerateHardwareEncoders(adapter, true, kind);'],
        ['std::move(selected), arguments.profile);', 'std::move(selected), arguments.profile, kind);'],
        ['return {OutputKind::h264, std::move(hardware)};', 'return {kind, std::move(hardware)};'],
        ['if (arguments.codec == "h264") throw;', 'if (arguments.codec != "auto") throw;'],
    ]);
    text = text.slice(0, start) + selection + text.slice(end);
    return edit(text, [
        ['codec != L"auto" && codec != L"h264" && codec != L"vp8"', 'codec != L"auto" && codec != L"h264" && codec != L"vp8" && codec != L"av1"'],
        ['    ActivationList encoders = EnumerateHardwareEncoders(adapter, false);\n    output <<', '    output <<'],
        ['           << ",\\"hardwareH264\\":[";\n    for (UINT32 encoder_index', '           ;\n    for (auto kind : {OutputKind::h264, OutputKind::av1}) {\n    const auto encoders = EnumerateHardwareEncoders(adapter, false, kind);\n    output << (kind == OutputKind::h264 ? ",\\"hardwareH264\\":[" : ",\\"hardwareAv1\\":[");\n    for (UINT32 encoder_index'],
        ['    output << "]}";\n  }\n  output << "]}";', '    output << \']\';\n    }\n    output << \'}\';\n  }\n  output << "]}";'],
        ['"no usable hardware H264 encoder was found"', '"no usable hardware video encoder was found"'],
        ['void WriteVideoStarting(', 'const char* VideoCodecName(OutputKind kind) {\n  if (kind == OutputKind::av1) return "av1";\n  if (kind == OutputKind::h264) return "h264";\n  return "vp8";\n}\n\nvoid WriteVideoStarting('],
        [`  const bool hardware = encoder.kind == OutputKind::h264;\n  std::ostringstream status;`, `  const bool hardware = encoder.kind != OutputKind::vp8;\n  std::ostringstream status;`],
        ['JSONString(hardware ? "h264" : "vp8")\n         << ",\\"adapterIndex\\":', 'JSONString(VideoCodecName(encoder.kind))\n         << ",\\"adapterIndex\\":'],
        ['bool hardware, const EncodedAccessUnit& output) {\n  std::ostringstream status;', 'OutputKind kind, const EncodedAccessUnit& output) {\n  const bool hardware = kind != OutputKind::vp8;\n  std::ostringstream status;'],
        ['JSONString(hardware ? "h264" : "vp8");\n  if (hardware) {', 'JSONString(VideoCodecName(kind));\n  if (kind == OutputKind::h264) {'],
        ['  const bool hardware = encoder.kind == OutputKind::h264;\n  const UINT encoder_index', '  const auto kind = encoder.kind;\n  const bool hardware = kind != OutputKind::vp8;\n  const UINT encoder_index'],
        ['[&adapter, &device, encoder_index](const VideoProfile& selected_profile)', '[&adapter, &device, encoder_index, kind](const VideoProfile& selected_profile)'],
        ['auto activations = EnumerateHardwareEncoders(adapter);\n        auto selected', 'auto activations = EnumerateHardwareEncoders(adapter, true, kind);\n        auto selected'],
        ['std::move(selected), selected_profile);', 'std::move(selected), selected_profile, kind);'],
        ['if (!active.exchange(true)) WriteVideoActive(writer, arguments, hardware, output);', 'if (!active.exchange(true)) WriteVideoActive(writer, arguments, hardware ? OutputKind::h264 : OutputKind::vp8, output);'],
        ['const bool hardware = encoder.kind == OutputKind::h264;\n  piik::capture::CapturePresentation', 'const auto kind = encoder.kind;\n  piik::capture::CapturePresentation'],
        ['WriteVideoActive(writer, arguments, hardware, output);', 'WriteVideoActive(writer, arguments, kind, output);'],
    ]);
}
