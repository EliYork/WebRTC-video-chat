package nativecapture

import (
	"errors"
	"strings"
	"time"
)

type PlatformError string

func (err PlatformError) Error() string { return string(err) }
func PlatformFailureReason(err error) string {
	var failure PlatformError
	if errors.As(err, &failure) {
		return string(failure)
	}
	return "capture-unconfirmed"
}
func classifyPlatformCaptureFailure(stderr []byte) error {
	for _, line := range strings.Split(string(stderr), "\n") {
		stage, ok := strings.CutPrefix(strings.TrimSpace(line), "stage=")
		if !ok {
			continue
		}
		if stage == "mft-hardware-enumeration" {
			return PlatformError("hardware-unavailable")
		}
		if strings.HasPrefix(stage, "mft-") || strings.HasPrefix(stage, "codec-") || strings.HasPrefix(stage, "bitstream-") {
			return PlatformError("encoder-failed")
		}
		if strings.HasPrefix(stage, "capture-") || strings.HasPrefix(stage, "wgc-") || strings.HasPrefix(stage, "target-") {
			return PlatformError("media-capture-failed")
		}
	}
	return nil
}
func (stream *Stream) platformReadFailure(original error) error {
	if stream.platformExited == nil {
		return original
	}
	select {
	case <-stream.platformExited:
	case <-time.After(250 * time.Millisecond):
		return original
	}
	if stream.platformFailure != nil {
		return stream.platformFailure
	}
	return original
}
