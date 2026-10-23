package nativecontrol

import (
	"context"
	"errors"
	"github.com/TNTcraftHIM/Piik/internal/app/nativecapture"
	"github.com/TNTcraftHIM/Piik/internal/app/nativehost"
	"runtime"
	"strings"
)

func (session *Session) platformRequest(ctx context.Context, envelope requestEnvelope, payload []byte) (any, error) {
	if runtime.GOOS != "windows" || !session.capabilities.IndependentAudio {
		return nil, errors.New("Windows audio extension unavailable")
	}
	if envelope.Type == "platform-audio-sources" {
		var request requestEnvelope
		if decodeStrict(payload, &request) != nil {
			return nil, protocolViolation("invalid audio sources request")
		}
		sources, err := nativecapture.ListAudioApplications(ctx, session.captureProcess)
		if err != nil {
			return nil, err
		}
		return struct {
			responseEnvelope
			Sources    []nativecapture.AudioApplication `json:"sources"`
			SystemSafe bool                             `json:"systemSafe"`
		}{
			response(envelope, "platform-audio-sources"), sources, nativecapture.PlatformAudioHost() != nil && session.capabilities.ProcessAudioExclusion}, nil
	}
	var request stopShareRequest
	if decodeStrict(payload, &request) != nil || !validIdentities(request.ShareID) {
		return nil, protocolViolation("invalid share status request")
	}
	host := session.current(request.ShareID)
	if host == nil {
		return nil, errors.New("native share does not exist")
	}
	return struct {
		responseEnvelope
		ShareID string `json:"shareId"`
		nativehost.PlatformStatus
	}{
		response(envelope, "platform-share-status"), request.ShareID, host.PlatformStatus()}, nil
}
func (session *Session) validatePlatformAudio(ctx context.Context, request *startShareRequest) error {
	if request.Type != "platform-start-share" {
		if request.AudioMode != "" || request.AudioTarget != nil {
			return protocolViolation("extension fields require platform-start-share")
		}
		return nil
	}
	if runtime.GOOS != "windows" || !session.capabilities.IndependentAudio || request.Codec != "h264" || request.MicrophoneMixing || request.ExcludeAudio != nil {
		return nativecapture.PlatformError("audio-target-invalid")
	}
	switch request.AudioMode {
	case "none":
		if request.Audio || request.AudioTarget != nil {
			return nativecapture.PlatformError("audio-target-invalid")
		}
	case "system":
		if !request.Audio || request.AudioTarget != nil || !session.capabilities.ProcessAudioExclusion || nativecapture.PlatformAudioHost() == nil {
			return nativecapture.PlatformError("system-exclusion-unavailable")
		}
	case "application":
		if !request.Audio || !session.capabilities.ProcessAudio || request.AudioTarget == nil || !request.AudioTarget.Valid() {
			return nativecapture.PlatformError("audio-target-invalid")
		}
		// Re-read the list at acceptance: stale lifetimes, own-client descendants
		// and PID reuse cannot acquire an unrelated application.
		sources, err := nativecapture.ListAudioApplications(ctx, session.captureProcess)
		if err != nil {
			return nativecapture.PlatformError("audio-target-invalid")
		}
		found := false
		for _, source := range sources {
			if source.ProcessAudioTarget == *request.AudioTarget {
				found = true
				break
			}
		}
		if !found {
			return nativecapture.PlatformError("audio-target-invalid")
		}
	default:
		return nativecapture.PlatformError("audio-target-invalid")
	}
	return nil
}
func platformFailureReason(operation string, causes []error) string {
	if !strings.HasPrefix(operation, "platform-") {
		return ""
	}
	if len(causes) > 0 {
		return nativecapture.PlatformFailureReason(causes[0])
	}
	return "capture-unconfirmed"
}
