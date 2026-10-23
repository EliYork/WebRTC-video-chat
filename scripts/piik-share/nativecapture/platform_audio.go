package nativecapture

import (
	"context"
	"errors"
	"os/exec"
	"strings"
	"time"
)

// Process identity is deliberately separate from a video/window target.
type ProcessAudioTarget struct {
	PID          uint32 `json:"pid"`
	CreationTime string `json:"creationTime"`
}

func (target ProcessAudioTarget) Valid() bool {
	return target.PID > 0 && positiveDecimal(target.CreationTime)
}
func (target ProcessAudioTarget) CaptureTarget() CaptureTarget {
	// StartAudio uses only PID/lifetime, never this synthetic window ID.
	return CaptureTarget{Kind: "window", SourceID: "1", PID: target.PID, CreationTime: target.CreationTime, Title: "Application audio"}
}

type AudioApplication struct {
	ProcessAudioTarget
	Name       string `json:"name"`
	HasSession bool   `json:"hasSession"`
	Active     bool   `json:"active"`
	Icon       string `json:"icon"`
}

func ListAudioApplications(parent context.Context, executable string) ([]AudioApplication, error) {
	ctx, cancel := context.WithTimeout(parent, 8*time.Second)
	defer cancel()
	stdout := &boundedBuffer{limit: 512 * 1024}
	command := exec.CommandContext(ctx, executable, "--list-audio-applications")
	command.Stdout = stdout
	hideWindow(command)
	if err := command.Run(); err != nil {
		return nil, errors.New("audio application list unavailable")
	}
	var sources []AudioApplication
	if err := decodeStrictJSON(stdout.Bytes(), &sources); err != nil || sources == nil || len(sources) > 1024 {
		return nil, errors.New("invalid audio application list")
	}
	seen := map[ProcessAudioTarget]bool{}
	for _, source := range sources {
		if !source.Valid() || seen[source.ProcessAudioTarget] || source.Name == "" || len(source.Name) > 512 || len(source.Icon) > 24000 ||
			(source.Icon != "" && !strings.HasPrefix(source.Icon, "data:image/bmp;base64,")) {
			return nil, errors.New("invalid audio application identity")
		}
		seen[source.ProcessAudioTarget] = true
	}
	return sources, nil
}
