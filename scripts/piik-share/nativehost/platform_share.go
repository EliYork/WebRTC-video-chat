package nativehost

import "github.com/TNTcraftHIM/Piik/internal/app/nativecapture"

func (session *Session) PlatformEndReason(err error) string {
	if session.platformMode == "" || err == nil {
		return ""
	}
	return nativecapture.PlatformFailureReason(err)
}

func validatePlatformHostAudio(options Options) error {
	switch options.PlatformAudioMode {
	case "":
		return nil
	case "none":
		if options.AudioEnabled {
			return nativecapture.PlatformError("audio-capture-failed")
		}
	case "application":
		if options.PlatformAudioTarget == nil || !options.PlatformAudioTarget.Valid() {
			return nativecapture.PlatformError("audio-target-invalid")
		}
	case "system":
		if nativecapture.PlatformAudioHost() == nil {
			return nativecapture.PlatformError("system-exclusion-unavailable")
		}
	default:
		return nativecapture.PlatformError("audio-target-invalid")
	}
	if options.MicrophoneMixing || options.ExcludeAudio != nil {
		return nativecapture.PlatformError("audio-target-invalid")
	}
	return nil
}
func platformAudioTarget(options Options) nativecapture.CaptureTarget {
	if options.PlatformAudioMode == "application" && options.PlatformAudioTarget != nil {
		return options.PlatformAudioTarget.CaptureTarget()
	}
	return options.Video.Target
}
func platformAudioExclusion(options Options) *nativecapture.CaptureTarget {
	if options.PlatformAudioMode == "system" {
		return nativecapture.PlatformAudioHost()
	}
	return options.ExcludeAudio
}

// Called under session.mu. Keep starting facts until active output confirms
// this capture generation. Enumeration alone never confirms hardware use.
func (session *Session) platformObserve(state CaptureState) {
	previous := session.platformCapture
	if state.EncoderName == "" {
		state.EncoderName = previous.EncoderName
	}
	if state.AdapterName == "" {
		state.AdapterName = previous.AdapterName
	}
	session.platformCapture = state
}

type PlatformStatus struct {
	Codec    string `json:"codec"`
	Hardware bool   `json:"hardware"`
	State    string `json:"state"`
	Encoder  string `json:"encoder"`
	Adapter  string `json:"adapter"`
	Audio    string `json:"audio"`
}

func (session *Session) PlatformStatus() PlatformStatus {
	session.mu.Lock()
	defer session.mu.Unlock()
	state := session.platformCapture
	status := PlatformStatus{Codec: state.Codec, Hardware: state.HardwareOnly && state.State == "active" && state.Codec == "h264",
		State: state.State, Encoder: state.EncoderName, Adapter: state.AdapterName, Audio: "none"}
	if status.State == "" {
		status.State = "unknown"
	}
	if session.audioStream != nil {
		status.Audio = "active"
	}
	if session.platformAudioFailed {
		status.Audio = "failed"
	}
	return status
}
