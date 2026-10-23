//go:build windows

package nativecapture

import (
	"golang.org/x/sys/windows"
	"os"
	"strconv"
)

// Electron supplies only its PID; verify it is the actual parent, then take a
// creation timestamp from its process handle. This is never page-controlled.
func PlatformAudioHost() *CaptureTarget {
	pid, err := strconv.ParseUint(os.Getenv("PIIK_SHARE_AUDIO_HOST_PID"), 10, 32)
	if err != nil || pid == 0 || uint32(pid) != uint32(os.Getppid()) {
		return nil
	}
	handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION|windows.SYNCHRONIZE, false, uint32(pid))
	if err != nil {
		return nil
	}
	defer windows.CloseHandle(handle)
	var created, exited, kernel, user windows.Filetime
	if windows.GetProcessTimes(handle, &created, &exited, &kernel, &user) != nil {
		return nil
	}
	timestamp := uint64(created.HighDateTime)<<32 | uint64(created.LowDateTime)
	if timestamp == 0 {
		return nil
	}
	return &CaptureTarget{Kind: "window", SourceID: "1", PID: uint32(pid), CreationTime: strconv.FormatUint(timestamp, 10), Title: "Voice client"}
}
