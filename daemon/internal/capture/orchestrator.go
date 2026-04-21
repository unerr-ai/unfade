package capture

import (
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/unfade-io/unfade-cli/daemon/internal/capture/parsers"
)

const (
	eventChannelBuffer = 256
	defaultIngestDays  = 7
)

// OrchestratorConfig holds configuration for the WatcherOrchestrator.
type OrchestratorConfig struct {
	ProjectDir     string
	EventsDir      string
	StateDir       string // For ingest state persistence. Empty = ingest disabled.
	Logger         CaptureSourceLogger
	TerminalSocket string // Path to terminal receiver Unix socket (empty = disabled).
}

// WatcherOrchestrator manages capture sources and routes events to a single EventWriter.
type WatcherOrchestrator struct {
	cfg            OrchestratorConfig
	sources        []CaptureSource
	writer         *EventWriter
	ingestCh       chan CaptureEvent
	writerCh       chan CaptureEvent
	debugDetector  *DebuggingDetector
	historical     *HistoricalIngestor
	ingestState    *IngestStateManager
	aiParsers      []parsers.AIToolParser
	middlewareWg   sync.WaitGroup
	middlewareDone chan struct{}
	mu             sync.Mutex
	running        bool
}

// NewOrchestrator creates a WatcherOrchestrator with git, AI session, and terminal sources.
func NewOrchestrator(cfg OrchestratorConfig) *WatcherOrchestrator {
	ingestCh := make(chan CaptureEvent, eventChannelBuffer)
	writerCh := make(chan CaptureEvent, eventChannelBuffer)

	projectPaths := []string{}
	if cfg.ProjectDir != "" {
		projectPaths = append(projectPaths, cfg.ProjectDir)
	}

	sources := []CaptureSource{
		NewGitWatcher(cfg.ProjectDir, cfg.Logger),
		NewAISessionWatcher(cfg.Logger, projectPaths),
	}

	if cfg.TerminalSocket != "" {
		sources = append(sources, NewTerminalReceiver(cfg.TerminalSocket, cfg.Logger))
	}

	writer := NewEventWriter(cfg.EventsDir, writerCh, cfg.Logger)
	debugDetector := NewDebuggingDetector(writerCh)

	home, _ := os.UserHomeDir()
	aiParsers := []parsers.AIToolParser{
		parsers.NewClaudeCodeParser(home),
		parsers.NewCursorParser(home),
		parsers.NewCodexParser(home),
		parsers.NewAiderParser(projectPaths),
	}

	var ingestStateMgr *IngestStateManager
	if cfg.StateDir != "" {
		ingestStateMgr = NewIngestStateManager(cfg.StateDir)
	}

	return &WatcherOrchestrator{
		cfg:            cfg,
		sources:        sources,
		writer:         writer,
		ingestCh:       ingestCh,
		writerCh:       writerCh,
		debugDetector:  debugDetector,
		aiParsers:      aiParsers,
		ingestState:    ingestStateMgr,
		middlewareDone: make(chan struct{}),
	}
}

// Start initializes the EventWriter, middleware, and all capture sources.
// Automatically triggers a 1-week historical ingest in the background.
func (o *WatcherOrchestrator) Start() error {
	o.mu.Lock()
	defer o.mu.Unlock()

	if o.running {
		return fmt.Errorf("orchestrator already running")
	}

	if err := o.writer.Start(); err != nil {
		return fmt.Errorf("start event writer: %w", err)
	}

	o.middlewareWg.Add(1)
	go o.middlewareLoop()

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

	if o.ingestState != nil {
		state := o.ingestState.Get()
		if state.Status != "running" && state.Status != "completed" {
			o.startIngestLocked(time.Now().AddDate(0, 0, -defaultIngestDays))
		}
	}

	return nil
}

func (o *WatcherOrchestrator) middlewareLoop() {
	defer o.middlewareWg.Done()

	for {
		select {
		case <-o.middlewareDone:
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
			o.writerCh <- event
			if event.Source == "terminal" {
				o.debugDetector.ProcessEvent(event)
			}
		}
	}
}

// Stop gracefully shuts down all sources, the historical ingestor, middleware, and the writer.
func (o *WatcherOrchestrator) Stop() {
	o.mu.Lock()
	defer o.mu.Unlock()

	if !o.running {
		return
	}

	if o.historical != nil {
		o.historical.Stop()
		o.historical = nil
	}

	for _, src := range o.sources {
		o.cfg.Logger.Debug("stopping capture source", map[string]any{"source": src.Name()})
		src.Stop()
	}

	close(o.middlewareDone)
	o.middlewareWg.Wait()

	o.writer.Stop()

	o.running = false
	o.cfg.Logger.Info("orchestrator stopped")
}

// EventsToday returns the count of events written since writer started.
func (o *WatcherOrchestrator) EventsToday() int {
	return o.writer.TodayCount()
}

// InjectEvent feeds a single event into the capture pipeline from external sources
// (e.g., terminal-event IPC command from shell hooks).
func (o *WatcherOrchestrator) InjectEvent(event CaptureEvent) {
	select {
	case o.ingestCh <- event:
	default:
		// Channel full — drop silently to avoid blocking IPC
	}
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
func (o *WatcherOrchestrator) Backfill(since time.Time) (int, error) {
	o.mu.Lock()
	running := o.running
	o.mu.Unlock()

	if !running {
		return 0, fmt.Errorf("orchestrator not running")
	}

	for _, src := range o.sources {
		if gw, ok := src.(*GitWatcher); ok {
			return gw.Backfill(since, o.ingestCh)
		}
	}

	return 0, fmt.Errorf("git watcher not found")
}

// StartIngest launches a historical AI session ingest in the background.
func (o *WatcherOrchestrator) StartIngest(since time.Time) error {
	o.mu.Lock()
	defer o.mu.Unlock()

	if !o.running {
		return fmt.Errorf("orchestrator not running")
	}
	if o.ingestState == nil {
		return fmt.Errorf("ingest state tracking not configured")
	}
	if o.historical != nil && o.historical.IsRunning() {
		return fmt.Errorf("historical ingest already running")
	}

	o.startIngestLocked(since)
	return nil
}

func (o *WatcherOrchestrator) startIngestLocked(since time.Time) {
	o.historical = NewHistoricalIngestor(o.aiParsers, o.ingestCh, o.ingestState, o.cfg.Logger, o.cfg.EventsDir)
	o.historical.Run(since)
}

// IngestStatus returns the current historical ingest state, or nil if not configured.
func (o *WatcherOrchestrator) IngestStatus() *IngestState {
	if o.ingestState == nil {
		return nil
	}
	s := o.ingestState.Get()
	return &s
}
