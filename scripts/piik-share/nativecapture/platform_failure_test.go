package nativecapture

import (
	"bytes"
	"testing"
	"time"
)

func TestPlatformAV1FrameUsesSeparateWireKind(t *testing.T) {
	var stream bytes.Buffer
	for _, frame := range []Frame{
		{Kind: FrameAV1, KeyFrame: true, Layer: 1, Width: 1920, Height: 1080,
			Timestamp: time.Second, Duration: time.Second / 60, Data: []byte{0x12, 0x00}},
		{Kind: FrameControl, Data: []byte("Q")},
	} {
		if err := writeFrame(&stream, frame); err != nil {
			t.Fatal(err)
		}
	}
	video, err := readFrame(&stream)
	if err != nil || !video.MatchesVideoCodec("av1") || video.MatchesVideoCodec("h264") || !video.KeyFrame || video.Layer != 1 {
		t.Fatalf("invalid AV1 round trip: %+v, %v", video, err)
	}
	control, err := readFrame(&stream)
	if err != nil || control.Kind != FrameControl || string(control.Data) != "Q" {
		t.Fatalf("invalid control round trip: %+v, %v", control, err)
	}
}

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
