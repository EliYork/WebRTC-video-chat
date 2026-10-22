// Integration overlay for Piik 9925486 (MIT). Leave upstream sources untouched.
package diagnostics

import (
	"context"
	"log/slog"
	"os"
)

// A native media packet must not synchronously format/redact/write a route
// trace. Keep the App's bounded two-second media/encoder samples and errors.
// Explicit local troubleshooting can opt back into dependency traces.
func mediaLogHandler(next slog.Handler) slog.Handler {
	if os.Getenv("PIIK_MEDIA_TRACE") == "1" {
		return next
	}
	return mediaLogLevel{next}
}

type mediaLogLevel struct{ slog.Handler }

func (h mediaLogLevel) Enabled(ctx context.Context, level slog.Level) bool {
	return level >= slog.LevelInfo && h.Handler.Enabled(ctx, level)
}
func (h mediaLogLevel) WithAttrs(attrs []slog.Attr) slog.Handler {
	return mediaLogLevel{h.Handler.WithAttrs(attrs)}
}
func (h mediaLogLevel) WithGroup(name string) slog.Handler {
	return mediaLogLevel{h.Handler.WithGroup(name)}
}
