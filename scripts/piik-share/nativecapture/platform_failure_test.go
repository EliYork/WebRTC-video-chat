package nativecapture

import "testing"

func TestPlatformFixedErrorReasons(t *testing.T) {
	for _, item := range []struct{ stage, reason string }{
		{"mft-hardware-enumeration", "hardware-unavailable"}, {"mft-process-output", "encoder-failed"},
		{"codec-output-type", "encoder-failed"}, {"capture-window", "media-capture-failed"}, {"unknown-driver-code", "capture-unconfirmed"},
	} {
		if got := PlatformFailureReason(classifyPlatformCaptureFailure([]byte("stage=" + item.stage + "\n"))); got != item.reason {
			t.Fatalf("%s: %s", item.stage, got)
		}
	}
}
func TestPlatformProcessIdentityBounds(t *testing.T) {
	for _, target := range []ProcessAudioTarget{{PID: 0, CreationTime: "1"}, {PID: 1, CreationTime: "0"}, {PID: 1, CreationTime: "18446744073709551616"}, {PID: 1, CreationTime: "bad"}} {
		if target.Valid() {
			t.Fatal("invalid process lifetime accepted")
		}
	}
	target := ProcessAudioTarget{PID: 34, CreationTime: "123456"}
	if !target.Valid() || target.CaptureTarget().PID != 34 {
		t.Fatal("valid independent identity lost")
	}
}
