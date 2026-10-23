package nativecontrol

import (
	"context"
	"github.com/TNTcraftHIM/Piik/internal/app/nativecapture"
	"os"
	"runtime"
	"testing"
)

func TestPlatformAudioValidationAndLegacyCompatibility(t *testing.T) {
	t.Setenv("PIIK_SHARE_AUDIO_HOST_PID", "")
	session := New("missing", nativecapture.Capabilities{}, false)
	defer session.Close()
	for _, request := range []startShareRequest{
		{Type: "platform-start-share", Codec: "h264", AudioMode: "bogus"},
		{Type: "platform-start-share", Codec: "h264", AudioMode: "application", Audio: true, AudioTarget: &nativecapture.ProcessAudioTarget{PID: 12, CreationTime: "1"}},
		{Type: "platform-start-share", Codec: "h264", AudioMode: "system", Audio: true},
		{Type: "platform-start-share", Codec: "h264", AudioMode: "none", Audio: true},
		{Type: "platform-start-share", Codec: "h264", AudioMode: "none", MicrophoneMixing: true},
		{Type: "platform-start-share", Codec: "vp8", AudioMode: "none"},
	} {
		if session.validatePlatformAudio(context.Background(), &request) == nil {
			t.Fatalf("invalid request accepted: %+v", request)
		}
	}
	legacy := startShareRequest{Type: "start-share", Audio: true}
	if err := session.validatePlatformAudio(context.Background(), &legacy); err != nil {
		t.Fatal(err)
	}
	legacy.AudioMode = "system"
	if session.validatePlatformAudio(context.Background(), &legacy) == nil {
		t.Fatal("legacy command accepted new fields")
	}
}
func TestPlatformAudioRejectsReusedPIDBeforeCapture(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows independent audio extension")
	}
	payload := `[{"pid":42,"creationTime":"222","name":"same.exe","active":false,"hasSession":false,"icon":""}]`
	path := t.TempDir() + "/audio.json"
	if err := os.WriteFile(path, []byte(payload), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PIIK_SOURCE_LIST_FIXTURE", path)
	executable, _ := os.Executable()
	session := New(executable, nativecapture.Capabilities{ProcessAudio: true, IndependentAudio: true}, false)
	defer session.Close()
	request := startShareRequest{Type: "platform-start-share", Codec: "h264", AudioMode: "application", Audio: true, AudioTarget: &nativecapture.ProcessAudioTarget{PID: 42, CreationTime: "111"}}
	if session.validatePlatformAudio(context.Background(), &request) == nil {
		t.Fatal("reused PID accepted")
	}
	request.AudioTarget.CreationTime = "222"
	if err := session.validatePlatformAudio(context.Background(), &request); err != nil {
		t.Fatal(err)
	}
}
