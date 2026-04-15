// FILE: daemon/internal/capture/ai_session.go
// AISessionWatcher implements CaptureSource — scans Cursor and Claude Code
// log directories for AI conversation/completion/rejection events.
// Gracefully handles missing directories and unknown log formats.

package capture

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/google/uuid"
)

const (
	aiPollInterval   = 10 * time.Second
	aiDebounceDelay  = 1 * time.Second
	maxSessionDetail = 1500
)

// aiLogSource describes a known AI tool's log location and parser.
type aiLogSource struct {
	name    string
	baseDir string // Resolved at runtime from home directory.
	pattern string // Glob pattern for log files within baseDir.
}

// AISessionWatcher watches AI tool log directories for session activity.
type AISessionWatcher struct {
	logger    CaptureSourceLogger
	sources   []aiLogSource
	watcher   *fsnotify.Watcher
	eventCh   chan<- CaptureEvent
	done      chan struct{}
	wg        sync.WaitGroup
	seenFiles map[string]int64 // filepath → last-read offset
	mu        sync.Mutex
}

// NewAISessionWatcher creates a watcher that monitors known AI tool log directories.
func NewAISessionWatcher(logger CaptureSourceLogger) *AISessionWatcher {
	home, _ := os.UserHomeDir()

	sources := []aiLogSource{
		{
			name:    "cursor",
			baseDir: filepath.Join(home, ".cursor", "logs"),
			pattern: "**/*.log",
		},
		{
			name:    "claude-code",
			baseDir: filepath.Join(home, ".claude", "projects"),
			pattern: "**/*.jsonl",
		},
	}

	return &AISessionWatcher{
		logger:    logger,
		sources:   sources,
		done:      make(chan struct{}),
		seenFiles: make(map[string]int64),
	}
}

func (a *AISessionWatcher) Name() string { return "ai-session" }

func (a *AISessionWatcher) Start(eventCh chan<- CaptureEvent) error {
	a.eventCh = eventCh

	w, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("create fsnotify watcher: %w", err)
	}
	a.watcher = w

	// Watch each source's base directory if it exists.
	watchCount := 0
	for _, src := range a.sources {
		if _, err := os.Stat(src.baseDir); os.IsNotExist(err) {
			a.logger.Debug("ai session dir not found, skipping", map[string]any{
				"source": src.name,
				"dir":    src.baseDir,
			})
			continue
		}

		if err := a.watchRecursive(src.baseDir); err != nil {
			a.logger.Warn("failed to watch ai session dir", map[string]any{
				"source": src.name,
				"dir":    src.baseDir,
				"error":  err.Error(),
			})
			continue
		}
		watchCount++
		a.logger.Info("watching ai session dir", map[string]any{
			"source": src.name,
			"dir":    src.baseDir,
		})
	}

	if watchCount == 0 {
		_ = w.Close()
		a.watcher = nil
		a.logger.Info("no ai session directories found — running in poll-only mode")
	}

	a.wg.Add(1)
	go a.watchLoop()

	a.logger.Info("ai session watcher started")
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
	paths := make([]string, 0, len(a.sources))
	for _, src := range a.sources {
		if _, err := os.Stat(src.baseDir); err == nil {
			paths = append(paths, src.baseDir)
		}
	}
	return paths
}

func (a *AISessionWatcher) watchLoop() {
	defer a.wg.Done()

	// Periodic poll for new files in case fsnotify misses them.
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

			if !a.isRelevantFile(event.Name) {
				continue
			}

			// Debounce rapid writes.
			if debounceTimer != nil {
				debounceTimer.Stop()
			}
			debounceTimer = time.NewTimer(aiDebounceDelay)
			debounceCh = debounceTimer.C

		case <-debounceCh:
			debounceCh = nil
			a.scanAllSources()

		case <-pollTicker.C:
			a.scanAllSources()
		}
	}
}

// watcherEvents returns the fsnotify events channel, or a nil channel if no watcher.
func (a *AISessionWatcher) watcherEvents() <-chan fsnotify.Event {
	if a.watcher != nil {
		return a.watcher.Events
	}
	// Return a channel that never fires — poll ticker will drive scanning.
	return make(chan fsnotify.Event)
}

func (a *AISessionWatcher) watchRecursive(dir string) error {
	return filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil // Skip inaccessible paths.
		}
		if d.IsDir() {
			if watchErr := a.watcher.Add(path); watchErr != nil {
				a.logger.Debug("cannot watch dir", map[string]any{"path": path, "error": watchErr.Error()})
			}
		}
		return nil
	})
}

func (a *AISessionWatcher) isRelevantFile(name string) bool {
	ext := filepath.Ext(name)
	return ext == ".log" || ext == ".jsonl"
}

func (a *AISessionWatcher) scanAllSources() {
	for _, src := range a.sources {
		if _, err := os.Stat(src.baseDir); os.IsNotExist(err) {
			continue
		}
		a.scanSource(src)
	}
}

func (a *AISessionWatcher) scanSource(src aiLogSource) {
	_ = filepath.WalkDir(src.baseDir, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}

		if !a.isRelevantFile(path) {
			return nil
		}

		info, err := d.Info()
		if err != nil {
			return nil
		}

		// Skip files older than 24 hours.
		if time.Since(info.ModTime()) > 24*time.Hour {
			return nil
		}

		a.mu.Lock()
		lastOffset := a.seenFiles[path]
		a.mu.Unlock()

		// Skip if file hasn't grown.
		if info.Size() <= lastOffset {
			return nil
		}

		newOffset := a.tailFile(path, lastOffset, src.name)

		a.mu.Lock()
		a.seenFiles[path] = newOffset
		a.mu.Unlock()

		return nil
	})
}

// tailFile reads new lines from the given file starting at offset,
// parses them, and emits events. Returns the new offset.
func (a *AISessionWatcher) tailFile(path string, offset int64, sourceName string) int64 {
	f, err := os.Open(path)
	if err != nil {
		return offset
	}
	defer f.Close()

	if offset > 0 {
		if _, err := f.Seek(offset, 0); err != nil {
			return offset
		}
	}

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), 256*1024)

	linesRead := 0
	for scanner.Scan() {
		line := scanner.Text()
		if strings.TrimSpace(line) == "" {
			continue
		}

		event := a.parseLine(line, sourceName, path)
		if event != nil {
			select {
			case a.eventCh <- *event:
			case <-a.done:
				break
			}
		}
		linesRead++
	}

	// Get current position.
	pos, err := f.Seek(0, 1) // Seek relative to current.
	if err != nil {
		// Fallback: estimate from scanner.
		return offset + int64(linesRead*100)
	}
	return pos
}

// parseLine attempts to parse a log line into a CaptureEvent.
// Returns nil for lines that don't match known patterns.
func (a *AISessionWatcher) parseLine(line, sourceName, filePath string) *CaptureEvent {
	// Try JSON parsing first (Claude Code JSONL format).
	var jsonEntry map[string]any
	if err := json.Unmarshal([]byte(line), &jsonEntry); err == nil {
		return a.parseJSONEntry(jsonEntry, sourceName, filePath)
	}

	// Try plain text patterns (Cursor logs).
	return a.parsePlainTextEntry(line, sourceName, filePath)
}

func (a *AISessionWatcher) parseJSONEntry(entry map[string]any, sourceName, filePath string) *CaptureEvent {
	// Look for conversation/completion indicators.
	msgType, _ := entry["type"].(string)
	role, _ := entry["role"].(string)

	var eventType string
	var summary string

	switch {
	case msgType == "assistant" || role == "assistant":
		eventType = "ai-completion"
		if content, ok := entry["content"].(string); ok {
			summary = truncateSummary(content)
		} else if message, ok := entry["message"].(string); ok {
			summary = truncateSummary(message)
		} else {
			summary = "AI completion"
		}

	case msgType == "human" || role == "user" || role == "human":
		eventType = "ai-conversation"
		if content, ok := entry["content"].(string); ok {
			summary = truncateSummary(content)
		} else if message, ok := entry["message"].(string); ok {
			summary = truncateSummary(message)
		} else {
			summary = "User prompt"
		}

	case msgType == "error" || msgType == "rejection":
		eventType = "ai-rejection"
		if errMsg, ok := entry["error"].(string); ok {
			summary = truncateSummary(errMsg)
		} else if message, ok := entry["message"].(string); ok {
			summary = truncateSummary(message)
		} else {
			summary = "AI rejection"
		}

	default:
		// Unknown format — skip silently.
		return nil
	}

	// Extract timestamp if present.
	timestamp := time.Now().UTC().Format(time.RFC3339)
	if ts, ok := entry["timestamp"].(string); ok && ts != "" {
		if _, err := time.Parse(time.RFC3339, ts); err == nil {
			timestamp = ts
		}
	}

	detail := ""
	if d, err := json.Marshal(entry); err == nil {
		detail = TruncateDetail(string(d), maxSessionDetail)
	}

	return &CaptureEvent{
		ID:        uuid.New().String(),
		Timestamp: timestamp,
		Source:    "ai-session",
		Type:      eventType,
		Content: EventContent{
			Summary: summary,
			Detail:  detail,
		},
		Metadata: map[string]any{
			"ai_tool":  sourceName,
			"log_file": filepath.Base(filePath),
		},
	}
}

func (a *AISessionWatcher) parsePlainTextEntry(line, sourceName, filePath string) *CaptureEvent {
	// Cursor logs often contain timestamped entries with conversation markers.
	lower := strings.ToLower(line)

	var eventType string
	var summary string

	switch {
	case strings.Contains(lower, "completion") || strings.Contains(lower, "response"):
		eventType = "ai-completion"
		summary = truncateSummary(line)

	case strings.Contains(lower, "prompt") || strings.Contains(lower, "request"):
		eventType = "ai-conversation"
		summary = truncateSummary(line)

	case strings.Contains(lower, "error") || strings.Contains(lower, "reject") || strings.Contains(lower, "refused"):
		eventType = "ai-rejection"
		summary = truncateSummary(line)

	default:
		// Not a recognizable AI session entry.
		return nil
	}

	return &CaptureEvent{
		ID:        uuid.New().String(),
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Source:    "ai-session",
		Type:      eventType,
		Content: EventContent{
			Summary: summary,
		},
		Metadata: map[string]any{
			"ai_tool":  sourceName,
			"log_file": filepath.Base(filePath),
		},
	}
}

// truncateSummary shortens a string for use as an event summary.
func truncateSummary(s string) string {
	s = strings.TrimSpace(s)
	// Remove newlines.
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.ReplaceAll(s, "\r", "")

	if len(s) > 200 {
		return s[:197] + "..."
	}
	return s
}
