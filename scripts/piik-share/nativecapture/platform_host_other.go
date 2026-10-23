//go:build !windows

package nativecapture

func PlatformAudioHost() *CaptureTarget { return nil }
