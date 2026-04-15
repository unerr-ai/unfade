// FILE: daemon/internal/capture/source.go
// CaptureSource is the interface all event producers implement.
// Each source watches a specific signal (git, AI sessions, terminal)
// and emits CaptureEvents to a shared channel consumed by EventWriter.

package capture

// CaptureSourceLogger is the logging interface used by capture sources.
type CaptureSourceLogger interface {
	Debug(msg string, fields ...map[string]any)
	Info(msg string, fields ...map[string]any)
	Warn(msg string, fields ...map[string]any)
	Error(msg string, fields ...map[string]any)
}

// CaptureSource is the interface for all event-producing watchers.
// Each source sends CaptureEvents on the provided channel.
type CaptureSource interface {
	// Name returns the human-readable source identifier (e.g., "git", "ai-session").
	Name() string

	// Start begins watching and sending events to eventCh.
	// Must be non-blocking — starts goroutines internally.
	// Returns an error only if startup fails fatally.
	Start(eventCh chan<- CaptureEvent) error

	// Stop gracefully shuts down the watcher.
	// Must block until all internal goroutines have exited.
	Stop()

	// WatchedPaths returns the paths this source is watching (for health reporting).
	WatchedPaths() []string
}
