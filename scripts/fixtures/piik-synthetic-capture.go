// Test input only. No desktop, audio, network or encoder implementation.
// Replays WebCodecs-generated motion through Piik's capture-v7 envelope so
// the real App, shared source and Pion fanout can be checked without WGC.
package main

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strconv"
	"time"
)

type output struct {
	Width   uint32 `json:"width"`
	Height  uint32 `json:"height"`
	FPS     uint32 `json:"fps"`
	Bitrate uint32 `json:"bitrate"`
}
type chunk struct {
	Key  bool   `json:"key"`
	Data string `json:"data"`
}
type clip struct {
	Width  uint32  `json:"width"`
	Height uint32  `json:"height"`
	Frames []chunk `json:"frames"`
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run() error {
	args := os.Args[1:]
	if len(args) == 0 {
		return fmt.Errorf("fixture requires an explicit command")
	}
	switch args[0] {
	case "--probe":
		fmt.Print(`{"protocol":7,"platform":"windows","platformBuild":"synthetic-fixture","videoCapture":true,"processAudio":false,"systemAudio":false,"softwareVP8":false,"adapters":[{"index":0,"name":"Synthetic fixture; no GPU evidence","identity":"fixture","hardwareH264":[{"index":0,"name":"Prerecorded H264; not a hardware encoder","identity":"fixture"}]}]}`)
		return nil
	case "--list":
		fmt.Print(`[{"kind":"display","sourceId":"1","title":"Synthetic motion; no desktop capture"}]`)
		return nil
	case "--capture-video":
		// Continue below. Other modes fail rather than touching a real device.
	default:
		return fmt.Errorf("unsupported synthetic command")
	}
	var outputs []output
	for i := 0; i < len(args); i++ {
		if args[i] == "--output" && i+4 < len(args) {
			values := make([]uint32, 4)
			for j := range values {
				n, err := strconv.ParseUint(args[i+1+j], 10, 32)
				if err != nil {
					return err
				}
				values[j] = uint32(n)
			}
			outputs = append(outputs, output{values[0], values[1], values[2], values[3]})
			i += 4
		}
	}
	if len(outputs) < 2 {
		return fmt.Errorf("expected Piik's shared output profiles")
	}
	bytes, err := os.ReadFile(os.Getenv("PIIK_SYNTHETIC_CLIPS"))
	if err != nil {
		return err
	}
	var clips []clip
	if err = json.Unmarshal(bytes, &clips); err != nil {
		return err
	}
	samples := make([][][]byte, len(outputs))
	keys := make([][]bool, len(outputs))
	for layer, out := range outputs {
		for _, clip := range clips {
			if clip.Width == out.Width && clip.Height == out.Height {
				for _, frame := range clip.Frames {
					data, e := base64.StdEncoding.DecodeString(frame.Data)
					if e != nil {
						return e
					}
					samples[layer] = append(samples[layer], data)
					keys[layer] = append(keys[layer], frame.Key)
				}
			}
		}
		if len(samples[layer]) == 0 {
			return fmt.Errorf("no synthetic clip for %dx%d", out.Width, out.Height)
		}
	}
	if log := os.Getenv("PIIK_SYNTHETIC_LAUNCHES"); log != "" {
		f, e := os.OpenFile(log, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
		if e != nil {
			return e
		}
		fmt.Fprintln(f, os.Getpid())
		f.Close()
	}
	state := map[string]any{"state": "starting", "hardwareOnly": true, "codec": "h264", "adapterIndex": 0, "encoderIndex": 0, "adapterName": "Synthetic fixture", "adapterIdentity": "fixture", "encoderName": "Prerecorded input; no GPU evidence", "encoderIdentity": "fixture", "outputs": outputs}
	status, _ := json.Marshal(state)
	if err = frame(3, 0, false, 0, 0, 0, 0, status); err != nil {
		return err
	}
	original := outputs[1]
	state["state"] = "active"
	state["profileLevelId"] = "42e01f"
	state["width"] = original.Width
	state["height"] = original.Height
	state["fps"] = original.FPS
	status, _ = json.Marshal(state)
	if err = frame(3, 0, false, 0, 0, 0, 0, status); err != nil {
		return err
	}
	// Drain keyframe/rate controls; every loop has frequent IDRs. This fixture
	// validates source reuse, not real encoder rate-control or throughput.
	go func() { _, _ = io.Copy(io.Discard, os.Stdin); os.Exit(0) }()
	ticker := time.NewTicker(time.Second / time.Duration(original.FPS))
	defer ticker.Stop()
	for index := 0; ; index++ {
		<-ticker.C
		duration := uint64(10000000 / original.FPS)
		if err = frame(5, 0, false, uint64(index)*duration, duration, 0, 0, nil); err != nil { return err }
		for layer, out := range outputs {
			sample := index % len(samples[layer])
			duration := uint64(10000000 / original.FPS)
			if err = frame(2, layer, keys[layer][sample], uint64(index)*duration, duration, out.Width, out.Height, samples[layer][sample]); err != nil {
				return err
			}
		}
	}
}
func frame(kind byte, layer int, key bool, timestamp, duration uint64, width, height uint32, data []byte) error {
	var header [32]byte
	copy(header[:], "SMED")
	header[4] = 2
	header[5] = kind
	header[7] = byte(layer)
	if key {
		header[6] = 1
	}
	binary.BigEndian.PutUint64(header[8:16], timestamp)
	binary.BigEndian.PutUint64(header[16:24], duration)
	binary.BigEndian.PutUint16(header[24:26], uint16(width))
	binary.BigEndian.PutUint16(header[26:28], uint16(height))
	binary.BigEndian.PutUint32(header[28:32], uint32(len(data)))
	if _, err := os.Stdout.Write(header[:]); err != nil {
		return err
	}
	_, err := os.Stdout.Write(data)
	return err
}
