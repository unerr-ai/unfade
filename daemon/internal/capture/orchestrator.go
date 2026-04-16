// FILE: daemon/internal/capture/orchestrator.go
// WatcherOrchestrator manages all CaptureSource instances, routes their events
// through a single channel to the EventWriter goroutine.
// Provides start/stop lifecycle, source health reporting, and backfill coordination.
// Terminal events also pass through DebuggingDetector for pattern detection.

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
	ProjectDir     string
	EventsDir      string
	Logger         CaptureSourceLogger
	TerminalSocket string // Path to terminal receiver Unix socket (empty = disabled).
}

// WatcherOrchestrator manages capture sources and routes events to a single EventWriter.
type WatcherOrchestrator struct {
	cfg           OrchestratorConfig
	sources       []CaptureSource
	writer        *EventWriter
	ingestCh      chan CaptureEvent // Sources write here.
	writerCh      chan CaptureEvent // Writer reads here.
	debugDetector *DebuggingDetector
	middlewareWg  sync.WaitGroup
	middlewareDone chan struct{}
	mu            sync.Mutex
	running       bool
}

// NewOrchestrator creates a WatcherOrchestrator with git, AI session, and terminal sources.
// Terminal events pass through DebuggingDetector which may emit synthetic events.
func NewOrchestrator(cfg OrchestratorConfig) *WatcherOrchestrator {
	// Two-channel pipeline: sources → ingestCh → middleware → writerCh → EventWriter.
	// The middleware calls DebuggingDetector for terminal events.
	// Synthetic debugging_session events go directly to writerCh.
	ingestCh := make(chan CaptureEvent, eventChannelBuffer)
	writerCh := make(chan CaptureEvent, eventChannelBuffer)

	sources := []CaptureSource{
		NewGitWatcher(cfg.ProjectDir, cfg.Logger),
		NewAISessionWatcher(cfg.Logger),
	}

	// Add terminal receiver if socket path is configured.
	if cfg.TerminalSocket != "" {
		sources = append(sources, NewTerminalReceiver(cfg.TerminalSocket, cfg.Logger))
	}

	writer := NewEventWriter(cfg.EventsDir, writerCh, cfg.Logger)

	// DebuggingDetector writes synthetic events directly to writerCh,
	// bypassing the middleware to avoid infinite loops.
	debugDetector := NewDebuggingDetector(writerCh)

	return &WatcherOrchestrator{
		cfg:            cfg,
		sources:        sources,
		writer:         writer,
		ingestCh:       ingestCh,
		writerCh:       writerCh,
		debugDetector:  debugDetector,
		middlewareDone: make(chan struct{}),
	}
}

// Start initializes the EventWriter, middleware, and all capture sources.
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

	// Start the middleware goroutine that routes events through the detector.
	o.middlewareWg.Add(1)
	go o.middlewareLoop()

	// Start each source. Non-fatal failures are logged.
	started := 0
	for _, src := range o.sources {
		if err := src.Start(o.ingestCh); err != nil {
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

// middlewareLoop reads from ingestCh, calls DebuggingDetector for terminal events,
// and forwards all events to writerCh.
func (o *WatcherOrchestrator) middlewareLoop() {
	defer o.middlewareWg.Done()

	for {
		select {
		case <-o.middlewareDone:
			// Drain remaining events.
			for {
				select {
				case event, ok := <-o.ingestCh:
					if !ok {
						return
					}
					o.writerCh <- event
				default:
					return
				}
			}
		case event, ok := <-o.ingestCh:
			if !ok {
				return
			}
			// Forward to writer.
			o.writerCh <- event
			// Feed terminal events to the debugging detector.
			if event.Source == "terminal" {
				o.debugDetector.ProcessEvent(event)
			}
		}
	}
}

// Stop gracefully shuts down all sources, middleware, and the writer.
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

	// Stop middleware — let it drain.
	close(o.middlewareDone)
	o.middlewareWg.Wait()

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
// Writes events through the ingest channel. Blocks until complete.
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
			return gw.Backfill(since, o.ingestCh)
		}
	}

	return 0, fmt.Errorf("git watcher not found")
}
