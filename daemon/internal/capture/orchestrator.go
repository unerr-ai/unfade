// FILE: daemon/internal/capture/orchestrator.go
// WatcherOrchestrator manages all CaptureSource instances, routes their events
// through a single channel to the EventWriter goroutine.
// Provides start/stop lifecycle, source health reporting, and backfill coordination.

package capture

import (
	"fmt"
	"sync"
	"time"
)

const (
	eventChannelBuffer = 256
)

// OrchestratorConfig holds configuration for the WatcherOrchestrator.
type OrchestratorConfig struct {
	ProjectDir string
	EventsDir  string
	Logger     CaptureSourceLogger
}

// WatcherOrchestrator manages capture sources and routes events to a single EventWriter.
type WatcherOrchestrator struct {
	cfg     OrchestratorConfig
	sources []CaptureSource
	writer  *EventWriter
	eventCh chan CaptureEvent
	mu      sync.Mutex
	running bool
}

// NewOrchestrator creates a WatcherOrchestrator with git and AI session sources.
func NewOrchestrator(cfg OrchestratorConfig) *WatcherOrchestrator {
	eventCh := make(chan CaptureEvent, eventChannelBuffer)

	sources := []CaptureSource{
		NewGitWatcher(cfg.ProjectDir, cfg.Logger),
		NewAISessionWatcher(cfg.Logger),
	}

	writer := NewEventWriter(cfg.EventsDir, eventCh, cfg.Logger)

	return &WatcherOrchestrator{
		cfg:     cfg,
		sources: sources,
		writer:  writer,
		eventCh: eventCh,
	}
}

// Start initializes the EventWriter and starts all capture sources.
// Sources that fail to start are logged but don't prevent other sources from running.
func (o *WatcherOrchestrator) Start() error {
	o.mu.Lock()
	defer o.mu.Unlock()

	if o.running {
		return fmt.Errorf("orchestrator already running")
	}

	// Start the writer first — sources need somewhere to send events.
	if err := o.writer.Start(); err != nil {
		return fmt.Errorf("start event writer: %w", err)
	}

	// Start each source. Non-fatal failures are logged.
	started := 0
	for _, src := range o.sources {
		if err := src.Start(o.eventCh); err != nil {
			o.cfg.Logger.Warn("capture source failed to start", map[string]any{
				"source": src.Name(),
				"error":  err.Error(),
			})
			continue
		}
		started++
		o.cfg.Logger.Info("capture source started", map[string]any{"source": src.Name()})
	}

	o.running = true
	o.cfg.Logger.Info("orchestrator started", map[string]any{
		"sources_started": started,
		"sources_total":   len(o.sources),
	})

	return nil
}

// Stop gracefully shuts down all sources and the writer.
func (o *WatcherOrchestrator) Stop() {
	o.mu.Lock()
	defer o.mu.Unlock()

	if !o.running {
		return
	}

	// Stop sources first — they produce events.
	for _, src := range o.sources {
		o.cfg.Logger.Debug("stopping capture source", map[string]any{"source": src.Name()})
		src.Stop()
	}

	// Then stop the writer — it consumes events and drains the channel.
	o.writer.Stop()

	o.running = false
	o.cfg.Logger.Info("orchestrator stopped")
}

// EventsToday returns the count of events written since writer started.
func (o *WatcherOrchestrator) EventsToday() int {
	return o.writer.TodayCount()
}

// WatcherStatus returns a map of source names to their watched paths.
func (o *WatcherOrchestrator) WatcherStatus() map[string][]string {
	o.mu.Lock()
	defer o.mu.Unlock()

	status := make(map[string][]string, len(o.sources))
	for _, src := range o.sources {
		status[src.Name()] = src.WatchedPaths()
	}
	return status
}

// Backfill triggers git history backfill since the given time.
// Writes events through the same EventWriter channel. Blocks until complete.
func (o *WatcherOrchestrator) Backfill(since time.Time) (int, error) {
	o.mu.Lock()
	running := o.running
	o.mu.Unlock()

	if !running {
		return 0, fmt.Errorf("orchestrator not running")
	}

	// Find the git source.
	for _, src := range o.sources {
		if gw, ok := src.(*GitWatcher); ok {
			return gw.Backfill(since, o.eventCh)
		}
	}

	return 0, fmt.Errorf("git watcher not found")
}
