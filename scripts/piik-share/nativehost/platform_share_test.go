package nativehost

import (
	"context"
	"encoding/json"
	"github.com/TNTcraftHIM/Piik/internal/app/nativecapture"
	"io"
	"os"
	"runtime"
	"strconv"
	"testing"
	"time"
)

// Invoked only from the test binary's TestMain. No Windows audio/video device.
func runPlatformAudioFixture() {
	if len(os.Args) > 1 && os.Args[1] == "--capture-audio" {
		if os.Getenv("PIIK_PLATFORM_AUDIO_FAIL") == "1" {
			os.Exit(2)
		}
		if marker := os.Getenv("PIIK_PLATFORM_AUDIO_ARGUMENTS"); marker != "" {
			value, _ := json.Marshal(os.Args[1:])
			_ = os.WriteFile(marker, value, 0600)
		}
		writeCaptureFixtureFrame(nativecapture.Frame{Kind: nativecapture.FrameStatus, Data: []byte(`{"state":"active","audio":true}`)})
		writeCaptureFixtureFrame(nativecapture.Frame{Kind: nativecapture.FramePCM, Duration: 20 * time.Millisecond, Data: make([]byte, 3840)})
		if os.Getenv("PIIK_PLATFORM_AUDIO_EOF") == "1" {
			return
		}
		_, _ = io.Copy(io.Discard, os.Stdin)
		return // An indefinitely quiet app is valid.
	}
	runAudioRecoveryCapture()
}
func TestPlatformAudioIndependentSilenceFailureAndRetirement(t *testing.T) {
	t.Setenv("PIIK_NATIVEHOST_PIPE_FIXTURE", "platform-audio")
	exe, _ := os.Executable()
	target := nativecapture.ProcessAudioTarget{PID: 234, CreationTime: "123456"}
	profile := audioRecoveryProfile()
	for _, mode := range []string{"none", "application", "system", "failed", "eof"} {
		t.Run(mode, func(t *testing.T) {
			if mode == "system" && runtime.GOOS != "windows" {
				t.Skip("Windows parent lifetime")
			}
			if mode == "system" {
				t.Setenv("PIIK_SHARE_AUDIO_HOST_PID", strconv.Itoa(os.Getppid()))
			}
			t.Setenv("PIIK_PLATFORM_AUDIO_FAIL", "")
			t.Setenv("PIIK_PLATFORM_AUDIO_EOF", "")
			marker := t.TempDir() + "/arguments.json"
			t.Setenv("PIIK_PLATFORM_AUDIO_ARGUMENTS", marker)
			audioMode := mode
			if mode == "failed" || mode == "eof" {
				audioMode = "application"
			}
			if mode == "failed" {
				t.Setenv("PIIK_PLATFORM_AUDIO_FAIL", "1")
			}
			if mode == "eof" {
				t.Setenv("PIIK_PLATFORM_AUDIO_EOF", "1")
			}
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			options := Options{ShareID: "platform_fixture", CaptureProcess: exe, EdgeCapacity: 1, BindAddress: "127.0.0.1:0",
				Profile:           QualityProfile{Video: profile, AudioBitrate: 64000},
				Video:             nativecapture.VideoOptions{Target: nativecapture.CaptureTarget{Kind: "display", SourceID: "7", Title: "Screen A"}, Codec: "vp8", Profile: profile},
				PlatformAudioMode: audioMode, AudioEnabled: mode != "none"}
			if mode != "none" && mode != "system" {
				options.PlatformAudioTarget = &target
			}
			session, err := Start(ctx, options)
			if mode == "failed" {
				if err == nil {
					session.Close()
					t.Fatal("failed app audio must not silently start")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			defer session.Close()
			if mode == "none" {
				if session.HasAudio() {
					t.Fatal("no audio mode produced a track")
				}
			} else {
				bytes, err := os.ReadFile(marker)
				if err != nil {
					t.Fatal(err)
				}
				var arguments []string
				if json.Unmarshal(bytes, &arguments) != nil || len(arguments) != 4 {
					t.Fatalf("wrong independent target %s", bytes)
				}
				if mode == "system" {
					if arguments[1] != "exclude" || arguments[2] != strconv.Itoa(os.Getppid()) {
						t.Fatalf("system audio did not exclude host tree: %s", bytes)
					}
				} else if arguments[1] != "window" || arguments[2] != "234" || arguments[3] != "123456" {
					t.Fatalf("wrong app lifetime: %s", bytes)
				}
				if session.mixer != nil {
					t.Fatal("share microphone must remain independent")
				}
				if mode == "eof" {
					deadline := time.Now().Add(time.Second)
					for session.PlatformStatus().Audio != "failed" && time.Now().Before(deadline) {
						time.Sleep(5 * time.Millisecond)
					}
					if session.PlatformStatus().Audio != "failed" {
						t.Fatal("audio failure was hidden")
					}
				} else {
					time.Sleep(100 * time.Millisecond)
					if session.PlatformStatus().Audio != "active" {
						t.Fatal("quiet app was treated as failure")
					}
				}
			}
			cancel()
			session.Close()
			select {
			case <-session.Done():
			case <-time.After(2 * time.Second):
				t.Fatal("capture leaked after parent cancellation")
			}
		})
	}
}
func TestPlatformEncoderFactsAreNotEnumerationPreferences(t *testing.T) {
	session := &Session{}
	if session.PlatformStatus().Hardware {
		t.Fatal("unknown is not hardware")
	}
	session.platformObserve(CaptureState{State: "starting", Codec: "h264", HardwareOnly: true, EncoderName: "Actual MFT", AdapterName: "Actual GPU"})
	if session.PlatformStatus().Hardware {
		t.Fatal("starting is not confirmed output")
	}
	session.platformObserve(CaptureState{State: "active", Codec: "h264", HardwareOnly: true})
	state := session.PlatformStatus()
	if !state.Hardware || state.Encoder != "Actual MFT" || state.Adapter != "Actual GPU" {
		t.Fatal(state)
	}
}
