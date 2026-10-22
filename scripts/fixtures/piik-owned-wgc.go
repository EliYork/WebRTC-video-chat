// Test scope restriction only: delegate real Piik WGC/MFT to our own window.
// The production capture binary, encoder and media protocol are unchanged.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"syscall"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run() error {
	var identity struct {
		HWND         string `json:"hwnd"`
		PID          int    `json:"pid"`
		CreationTime string `json:"creationTime"`
	}
	if err := json.Unmarshal([]byte(os.Getenv("PIIK_WGC_IDENTITY")), &identity); err != nil {
		return err
	}
	if identity.HWND == "" || identity.PID <= 0 || identity.CreationTime == "" {
		return fmt.Errorf("owned window identity required")
	}
	args := os.Args[1:]
	if len(args) == 0 {
		return fmt.Errorf("explicit command required")
	}
	switch args[0] {
	case "--list":
		return json.NewEncoder(os.Stdout).Encode([]any{map[string]any{"kind": "window", "sourceId": identity.HWND,
			"pid": identity.PID, "creationTime": identity.CreationTime, "title": "Piik isolated motion test"}})
	case "--probe":
	case "--preview", "--capture-video":
		if len(args) < 5 || args[1] != "window" || args[2] != identity.HWND || args[3] != strconv.Itoa(identity.PID) || args[4] != identity.CreationTime {
			return fmt.Errorf("refusing capture outside owned silent motion window")
		}
	default:
		return fmt.Errorf("audio and other capture modes disabled")
	}
	child := exec.Command(os.Getenv("PIIK_PERF_CAPTURE"), args...)
	child.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000}
	child.Stdin, child.Stdout, child.Stderr = os.Stdin, os.Stdout, os.Stderr
	if err := child.Start(); err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "event=owned-wgc-child pid=%d mode=%s\n", child.Process.Pid, args[0])
	return child.Wait()
}
