package capture

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/google/uuid"
	"github.com/unfade-io/unfade-cli/daemon/internal/capture/classifier"
	"github.com/unfade-io/unfade-cli/daemon/internal/capture/parsers"
)

const (
	aiPollInterval  = 10 * time.Second
	aiDebounceDelay = 1 * time.Second
)

// AISessionWatcher implements CaptureSource — discovers AI tool data on disk
// via pluggable parsers, tails new data, classifies conversations with the
// heuristic Human Direction Score, and emits enriched CaptureEvents.
type AISessionWatcher struct {
	logger  CaptureSourceLogger
	parsers []parsers.AIToolParser
	watcher *fsnotify.Watcher
	eventCh chan<- CaptureEvent
	done    chan struct{}
	wg      sync.WaitGroup
	offsets map[string]int64 // DataSource.Path → last byte/rowid offset
	mu      sync.Mutex
}

// NewAISessionWatcher creates a watcher with default parsers for all
// supported AI tools (Claude Code, Cursor, Codex CLI, Aider).
func NewAISessionWatcher(logger CaptureSourceLogger, projectPaths []string) *AISessionWatcher {
	home, _ := os.UserHomeDir()
	if home == "" {
		home = "/tmp"
	}

	return &AISessionWatcher{
		logger: logger,
		parsers: []parsers.AIToolParser{
			parsers.NewClaudeCodeParser(home),
			parsers.NewCursorParser(home),
			parsers.NewCodexParser(home),
			parsers.NewAiderParser(projectPaths),
		},
		done:    make(chan struct{}),
		offsets: make(map[string]int64),
	}
}

func (a *AISessionWatcher) Name() string { return "ai-session" }

func (a *AISessionWatcher) Start(eventCh chan<- CaptureEvent) error {
	a.eventCh = eventCh

	// Initialize offsets to current file/db positions so the live watcher
	// only picks up NEW data. Historical data is handled by the ingestor.
	a.initializeOffsets()

	// Discover base directories for fsnotify watches.
	watchDirs := a.discoverWatchDirs()

	if len(watchDirs) > 0 {
		w, err := fsnotify.NewWatcher()
		if err != nil {
			return fmt.Errorf("create fsnotify watcher: %w", err)
		}
		a.watcher = w

		for _, dir := range watchDirs {
			if err := watchRecursive(w, dir); err != nil {
				a.logger.Warn("failed to watch ai session dir", map[string]any{
					"dir":   dir,
					"error": err.Error(),
				})
			} else {
				a.logger.Info("watching ai session dir", map[string]any{"dir": dir})
			}
		}
	} else {
		a.logger.Info("no ai session directories found — running in poll-only mode")
	}

	a.wg.Add(1)
	go a.watchLoop()

	a.logger.Info("ai session watcher started", map[string]any{
		"parsers": len(a.parsers),
	})
	return nil
}

func (a *AISessionWatcher) Stop() {
	close(a.done)
	if a.watcher != nil {
		_ = a.watcher.Close()
	}
	a.wg.Wait()
	a.logger.Info("ai session watcher stopped")
}

func (a *AISessionWatcher) WatchedPaths() []string {
	return a.discoverWatchDirs()
}

// initializeOffsets fast-forwards to the current end of every known data
// source so subsequent Tail() calls only return newly appended data.
func (a *AISessionWatcher) initializeOffsets() {
	for _, p := range a.parsers {
		for _, src := range p.Discover() {
			switch src.Format {
			case "jsonl", "markdown":
				info, err := os.Stat(src.Path)
				if err == nil {
					a.offsets[src.Path] = info.Size()
				}
			case "sqlite":
				// For SQLite we need to query the current max rowid.
				_, newOffset, _ := p.Tail(src, 0)
				a.offsets[src.Path] = newOffset
			}
		}
	}
}

// discoverWatchDirs collects the unique parent directories of all discovered
// data sources for fsnotify registration.
func (a *AISessionWatcher) discoverWatchDirs() []string {
	dirSet := make(map[string]bool)
	for _, p := range a.parsers {
		for _, src := range p.Discover() {
			dir := filepath.Dir(src.Path)
			dirSet[dir] = true
		}
	}
	dirs := make([]string, 0, len(dirSet))
	for d := range dirSet {
		dirs = append(dirs, d)
	}
	return dirs
}

func (a *AISessionWatcher) watchLoop() {
	defer a.wg.Done()

	pollTicker := time.NewTicker(aiPollInterval)
	defer pollTicker.Stop()

	var debounceTimer *time.Timer
	var debounceCh <-chan time.Time

	for {
		select {
		case <-a.done:
			if debounceTimer != nil {
				debounceTimer.Stop()
			}
			return

		case event, ok := <-a.watcherEvents():
			if !ok {
				return
			}
			if !isRelevantAIFile(event.Name) {
				continue
			}
			if debounceTimer != nil {
				debounceTimer.Stop()
			}
			debounceTimer = time.NewTimer(aiDebounceDelay)
			debounceCh = debounceTimer.C

		case <-debounceCh:
			debounceCh = nil
			a.scanAndEmit()

		case <-pollTicker.C:
			a.scanAndEmit()
		}
	}
}

func (a *AISessionWatcher) watcherEvents() <-chan fsnotify.Event {
	if a.watcher != nil {
		return a.watcher.Events
	}
	return make(chan fsnotify.Event)
}

// scanAndEmit iterates every parser, tails each data source for new turns,
// groups by conversation, classifies with the heuristic engine, and emits
// enriched CaptureEvents.
func (a *AISessionWatcher) scanAndEmit() {
	for _, p := range a.parsers {
		for _, src := range p.Discover() {
			a.mu.Lock()
			lastOffset := a.offsets[src.Path]
			a.mu.Unlock()

			turns, newOffset, err := p.Tail(src, lastOffset)
			if err != nil {
				a.logger.Debug("tail error", map[string]any{
					"tool":  p.Name(),
					"path":  src.Path,
					"error": err.Error(),
				})
				continue
			}
			if newOffset == lastOffset || len(turns) == 0 {
				if newOffset != lastOffset {
					a.mu.Lock()
					a.offsets[src.Path] = newOffset
					a.mu.Unlock()
				}
				continue
			}

			a.mu.Lock()
			a.offsets[src.Path] = newOffset
			a.mu.Unlock()

			events := TurnsToEvents(turns, p.Name())
			for _, ev := range events {
				select {
				case a.eventCh <- ev:
				case <-a.done:
					return
				}
			}
		}
	}
}

// --- Shared event conversion (used by both watcher and historical ingestor) ---

// TurnsToEvents groups ConversationTurns by ConversationID, classifies each
// conversation, and produces CaptureEvents with direction_signals metadata.
func TurnsToEvents(turns []parsers.ConversationTurn, toolName string) []CaptureEvent {
	if len(turns) == 0 {
		return nil
	}

	convMap := make(map[string][]parsers.ConversationTurn)
	for _, t := range turns {
		convMap[t.ConversationID] = append(convMap[t.ConversationID], t)
	}

	events := make([]CaptureEvent, 0, len(convMap))
	for convID, convTurns := range convMap {
		for i := range convTurns {
			convTurns[i].TotalTurns = len(convTurns)
		}

		signals := classifier.Classify(convTurns)
		events = append(events, conversationToEvent(convID, convTurns, signals, toolName))
	}

	return events
}

func conversationToEvent(convID string, turns []parsers.ConversationTurn, signals parsers.DirectionSignals, toolName string) CaptureEvent {
	summary := "AI conversation"
	for _, t := range turns {
		if t.Role == "user" && len(strings.TrimSpace(t.Content)) > 5 {
			summary = truncateSummary(t.Content)
			break
		}
	}
	if summary == "AI conversation" {
		for _, t := range turns {
			if t.Role == "summary" && t.Content != "" {
				summary = truncateSummary(t.Content)
				break
			}
		}
	}

	ts := time.Now().UTC()
	for _, t := range turns {
		if !t.Timestamp.IsZero() {
			ts = t.Timestamp
			break
		}
	}

	branch := ""
	project := ""
	sessionID := ""
	for _, t := range turns {
		if t.GitBranch != "" && branch == "" {
			branch = t.GitBranch
		}
		if t.ProjectPath != "" && project == "" {
			project = t.ProjectPath
		}
		if t.SessionID != "" && sessionID == "" {
			sessionID = t.SessionID
		}
	}

	detail := buildConversationDetail(turns)

	return CaptureEvent{
		ID:        uuid.New().String(),
		Timestamp: ts.UTC().Format(time.RFC3339),
		Source:    "ai-session",
		Type:      "ai-conversation",
		Content: EventContent{
			Summary: summary,
			Detail:  detail,
			Branch:  branch,
			Project: project,
		},
		Metadata: map[string]any{
			"ai_tool":           toolName,
			"session_id":        sessionID,
			"conversation_id":   convID,
			"turn_count":        len(turns),
			"direction_signals": signals,
		},
	}
}

func buildConversationDetail(turns []parsers.ConversationTurn) string {
	var b strings.Builder
	for i, t := range turns {
		if i > 0 {
			b.WriteString(" | ")
		}
		b.WriteString(t.Role)
		b.WriteString(": ")
		content := strings.TrimSpace(t.Content)
		if len(content) > 100 {
			content = content[:97] + "..."
		}
		content = strings.ReplaceAll(content, "\n", " ")
		b.WriteString(content)
		if b.Len() > 1500 {
			b.WriteString(" | ...")
			break
		}
	}
	return b.String()
}

// --- Helpers ---

func isRelevantAIFile(name string) bool {
	switch filepath.Ext(name) {
	case ".jsonl", ".log", ".db", ".md":
		return true
	}
	return false
}

func watchRecursive(w *fsnotify.Watcher, dir string) error {
	return filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if watchErr := w.Add(path); watchErr != nil {
				// Skip silently — non-critical.
			}
		}
		return nil
	})
}

// truncateSummary shortens a string for use as an event summary.
func truncateSummary(s string) string {
	s = strings.TrimSpace(s)
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.ReplaceAll(s, "\r", "")
	if len(s) > 200 {
		return s[:197] + "..."
	}
	return s
}

// marshalSignals converts DirectionSignals to a JSON-safe map.
func marshalSignals(s parsers.DirectionSignals) map[string]any {
	data, err := json.Marshal(s)
	if err != nil {
		return nil
	}
	var m map[string]any
	_ = json.Unmarshal(data, &m)
	return m
}
