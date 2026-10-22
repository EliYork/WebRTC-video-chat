package diagnostics

import (
	"log/slog"
	"os"
	"strings"
	"testing"
)

// Same dependency logger and rotated synchronous file sink as the App. Each
// benchmark iteration represents one transport's packet-level route trace.
func BenchmarkMediaRouteLog(b *testing.B) {
	b.Setenv("PIIK_MEDIA_TRACE", "")
	r, err := Open(b.TempDir(), "client", "performance-fixture")
	if err != nil {
		b.Fatal(err)
	}
	defer r.Close()
	previous := slog.Default()
	slog.SetDefault(r.Logger())
	defer slog.SetDefault(previous)
	l := MediaLogger("transport").WithValues("connectionId", "fixture-connection")
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		l.Debugw("stream: get next higher layer", "available", false,
			"availableLayers", []int{0, 1}, "bitrates", [2]int{3750000, 15000000})
	}
	b.StopTimer()
	b.ReportMetric(float64(r.log.size)/float64(b.N), "log-B/op")
}

func TestMediaLogErrorsAndSampleSurvive(t *testing.T) {
	r, err := Open(t.TempDir(), "client", "fixture")
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	previous := slog.Default()
	slog.SetDefault(r.Logger())
	defer slog.SetDefault(previous)
	l := MediaLogger("transport").WithValues("connectionId", "fixture").WithName("child")
	l.Infow("media-information")
	l.Warnw("media-warning", nil)
	l.Errorw("media-error", nil)
	r.Logger().Debug("media-sample", "fps", 60)
	data, err := os.ReadFile(r.LogPath())
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"media-information", "media-warning", "media-error", "media-sample"} {
		if !strings.Contains(string(data), want) {
			t.Fatalf("lost %s", want)
		}
	}
}

func TestMediaTraceOptInStillRedactsSecrets(t *testing.T) {
	t.Setenv("PIIK_MEDIA_TRACE", "1")
	r, err := Open(t.TempDir(), "client", "fixture")
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	previous := slog.Default()
	slog.SetDefault(r.Logger())
	defer slog.SetDefault(previous)
	l := MediaLogger("transport").WithValues("token", "fixture-secret-token").WithName("child")
	l.Debugw("opt-in-trace", "detail", "Bearer fixture-secret-bearer")
	data, err := os.ReadFile(r.LogPath())
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "opt-in-trace") {
		t.Fatal("explicit trace was filtered")
	}
	for _, secret := range []string{"fixture-secret-token", "fixture-secret-bearer"} {
		if strings.Contains(string(data), secret) {
			t.Fatal("trace bypassed credential redaction")
		}
	}
}
