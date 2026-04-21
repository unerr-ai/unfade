package capture

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/unfade-io/unfade-cli/daemon/internal/capture/parsers"
)

const (
	ingestRateLimit   = 100 // max events per second
	ingestTickerDelay = time.Second / time.Duration(ingestRateLimit)
)

// HistoricalIngestor processes past AI session data in a background goroutine.
// It calls each parser's Parse(since) method, classifies conversations, and
// emits CaptureEvents through the shared event channel. Rate-limited to
// prevent I/O spikes. Progress is tracked via IngestStateManager.
type HistoricalIngestor struct {
	parsers   []parsers.AIToolParser
	eventCh   chan<- CaptureEvent
	state     *IngestStateManager
	logger    CaptureSourceLogger
	eventsDir string // For ingest lock file management
	done      chan struct{}
	wg        sync.WaitGroup
	mu        sync.Mutex
	running   bool
}

// NewHistoricalIngestor creates an ingestor wired to the given event channel
// and state manager. It does not start automatically — call Run().
func NewHistoricalIngestor(
	ps []parsers.AIToolParser,
	eventCh chan<- CaptureEvent,
	stateManager *IngestStateManager,
	logger CaptureSourceLogger,
	eventsDir string,
) *HistoricalIngestor {
	return &HistoricalIngestor{
		parsers:   ps,
		eventCh:   eventCh,
		state:     stateManager,
		logger:    logger,
		eventsDir: eventsDir,
		done:      make(chan struct{}),
	}
}

// Run starts historical ingest in a background goroutine. Non-blocking.
// Returns immediately if already running.
func (h *HistoricalIngestor) Run(since time.Time) {
	h.mu.Lock()
	if h.running {
		h.mu.Unlock()
		return
	}
	h.running = true
	h.mu.Unlock()

	h.wg.Add(1)
	go h.ingest(since)
}

// Stop cancels in-progress ingest and waits for the goroutine to exit.
func (h *HistoricalIngestor) Stop() {
	close(h.done)
	h.wg.Wait()
}

// IsRunning reports whether an ingest is currently in progress.
func (h *HistoricalIngestor) IsRunning() bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.running
}

func (h *HistoricalIngestor) ingest(since time.Time) {
	defer h.wg.Done()
	defer func() {
		h.mu.Lock()
		h.running = false
		h.mu.Unlock()
	}()

	// Write ingest lock — tells the materializer to defer processing
	lockPath := h.writeIngestLock()
	defer h.removeIngestLock(lockPath)

	until := time.Now().UTC()
	h.state.MarkRunning(since, until)

	h.logger.Info("historical ingest started", map[string]any{
		"since": since.Format(time.RFC3339),
	})

	// Phase 1: discover all data sources.
	type sourceWithParser struct {
		parser parsers.AIToolParser
		source parsers.DataSource
	}
	var allSources []sourceWithParser
	sourceProgress := make([]IngestSourceProgress, 0, len(h.parsers))

	for _, p := range h.parsers {
		discovered := p.Discover()
		sp := IngestSourceProgress{
			Tool:            p.Name(),
			FilesDiscovered: len(discovered),
		}
		sourceProgress = append(sourceProgress, sp)
		for _, src := range discovered {
			allSources = append(allSources, sourceWithParser{parser: p, source: src})
		}
	}
	h.state.SetSources(sourceProgress)

	h.logger.Info("historical ingest discovery complete", map[string]any{
		"total_sources": len(allSources),
	})

	// Phase 2: process each source, rate-limited.
	rateTicker := time.NewTicker(ingestTickerDelay)
	defer rateTicker.Stop()

	for _, sp := range allSources {
		if h.cancelled() {
			h.state.MarkFailed("cancelled")
			return
		}

		if h.state.IsProcessed(sp.source.Path) {
			continue
		}

		turns, err := sp.parser.Parse(sp.source, since)
		if err != nil {
			h.logger.Warn("historical ingest parse error", map[string]any{
				"tool":  sp.parser.Name(),
				"path":  sp.source.Path,
				"error": err.Error(),
			})
			h.state.RecordError(sp.parser.Name())
			continue
		}

		events := TurnsToEvents(turns, sp.parser.Name())

		emitted := 0
		for _, ev := range events {
			if h.cancelled() {
				h.state.MarkFailed("cancelled")
				return
			}

			select {
			case <-rateTicker.C:
			case <-h.done:
				h.state.MarkFailed("cancelled")
				return
			}

			select {
			case h.eventCh <- ev:
				emitted++
			case <-h.done:
				h.state.MarkFailed("cancelled")
				return
			}
		}

		h.state.RecordFileProcessed(sp.parser.Name(), sp.source.Path, emitted)
	}

	h.state.MarkCompleted()
	final := h.state.Get()
	h.logger.Info("historical ingest completed", map[string]any{
		"total_events": final.TotalEvents,
	})
}

func (h *HistoricalIngestor) cancelled() bool {
	select {
	case <-h.done:
		return true
	default:
		return false
	}
}

// writeIngestLock creates .ingest.lock in the events directory.
// The materializer checks for this file and defers processing while it exists.
func (h *HistoricalIngestor) writeIngestLock() string {
	if h.eventsDir == "" {
		return ""
	}
	lockPath := filepath.Join(h.eventsDir, ".ingest.lock")
	content := fmt.Sprintf("%d\n", os.Getpid())
	if err := os.WriteFile(lockPath, []byte(content), 0644); err != nil {
		h.logger.Warn("failed to write ingest lock", map[string]any{"error": err.Error()})
		return ""
	}
	h.logger.Debug("ingest lock acquired", map[string]any{"path": lockPath})
	return lockPath
}

// removeIngestLock removes the .ingest.lock file after ingest completes.
func (h *HistoricalIngestor) removeIngestLock(lockPath string) {
	if lockPath == "" {
		return
	}
	if err := os.Remove(lockPath); err != nil && !os.IsNotExist(err) {
		h.logger.Warn("failed to remove ingest lock", map[string]any{"error": err.Error()})
	} else {
		h.logger.Debug("ingest lock released", map[string]any{"path": lockPath})
	}
}
