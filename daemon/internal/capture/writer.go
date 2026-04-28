// FILE: daemon/internal/capture/writer.go
// EventWriter is the single goroutine that writes CaptureEvents to daily JSONL files.
// Uses O_APPEND for concurrent-safe writes. Events are written at full fidelity — no size caps.
// File naming: .unfade/events/YYYY-MM-DD.jsonl

package capture

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// EventWriter consumes CaptureEvents from a channel and writes them
// as JSON lines to daily .unfade/events/YYYY-MM-DD.jsonl files.
type EventWriter struct {
	eventsDir    string
	logger       CaptureSourceLogger
	eventCh      <-chan CaptureEvent
	done         chan struct{}
	wg           sync.WaitGroup
	count        atomic.Int64
	epochWritten map[string]bool
}

// NewEventWriter creates a writer that reads from eventCh and appends to daily JSONL files.
func NewEventWriter(eventsDir string, eventCh <-chan CaptureEvent, logger CaptureSourceLogger) *EventWriter {
	return &EventWriter{
		eventsDir:    eventsDir,
		logger:       logger,
		eventCh:      eventCh,
		done:         make(chan struct{}),
		epochWritten: make(map[string]bool),
	}
}

// Start begins the writer goroutine. Non-blocking.
// Seeds the counter from today's existing JSONL file so events_today is accurate.
func (w *EventWriter) Start() error {
	if err := os.MkdirAll(w.eventsDir, 0o755); err != nil {
		return fmt.Errorf("create events directory: %w", err)
	}

	// Seed counter from pre-existing events in today's file
	today := time.Now().Format("2006-01-02")
	todayFile := filepath.Join(w.eventsDir, today+".jsonl")
	if f, err := os.Open(todayFile); err == nil {
		scanner := bufio.NewScanner(f)
		var lines int64
		for scanner.Scan() {
			if len(scanner.Bytes()) > 0 {
				lines++
			}
		}
		f.Close()
		w.count.Store(lines)
		w.logger.Debug("seeded events_today from existing file", map[string]any{
			"file": today + ".jsonl", "count": lines,
		})
	}

	w.wg.Add(1)
	go w.loop()

	w.logger.Info("event writer started", map[string]any{"dir": w.eventsDir})
	return nil
}

// Stop signals the writer to drain remaining events and exit.
func (w *EventWriter) Stop() {
	close(w.done)
	w.wg.Wait()
	w.logger.Info("event writer stopped", map[string]any{"total_written": w.count.Load()})
}

// TodayCount returns the number of events written since start.
func (w *EventWriter) TodayCount() int {
	return int(w.count.Load())
}

func (w *EventWriter) loop() {
	defer w.wg.Done()

	for {
		select {
		case <-w.done:
			// Drain remaining events before exiting.
			w.drain()
			return
		case event, ok := <-w.eventCh:
			if !ok {
				return
			}
			w.writeEvent(event)
		}
	}
}

func (w *EventWriter) drain() {
	for {
		select {
		case event, ok := <-w.eventCh:
			if !ok {
				return
			}
			w.writeEvent(event)
		default:
			return
		}
	}
}

func (w *EventWriter) writeEvent(event CaptureEvent) {
	// Determine target date from event timestamp.
	date := extractDate(event.Timestamp)
	filePath := filepath.Join(w.eventsDir, date+".jsonl")

	data, err := json.Marshal(event)
	if err != nil {
		w.logger.Error("failed to marshal event", map[string]any{
			"error":  err.Error(),
			"source": event.Source,
			"type":   event.Type,
		})
		return
	}
	data = append(data, '\n')

	// O_APPEND ensures atomic appends with a single writer.
	f, err := os.OpenFile(filePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		w.logger.Error("failed to open events file", map[string]any{
			"error": err.Error(),
			"path":  filePath,
		})
		return
	}

	if _, err := f.Write(data); err != nil {
		w.logger.Error("failed to write event", map[string]any{
			"error": err.Error(),
			"path":  filePath,
		})
	} else {
		w.count.Add(1)
		w.logger.Debug("event written", map[string]any{
			"source": event.Source,
			"type":   event.Type,
			"file":   filepath.Base(filePath),
		})
	}

	_ = f.Close()

	if !w.epochWritten[filePath] {
		if err := WriteEpoch(filePath); err != nil {
			w.logger.Warn("failed to write epoch", map[string]any{"error": err.Error(), "path": filePath})
		}
		w.epochWritten[filePath] = true
	}
}

// extractDate returns the YYYY-MM-DD portion of an RFC3339 timestamp
// in the local timezone. Falls back to today's local date if parsing fails.
func extractDate(timestamp string) string {
	t, err := time.Parse(time.RFC3339, timestamp)
	if err != nil {
		t, err = time.Parse(time.RFC3339Nano, timestamp)
		if err != nil {
			return time.Now().Format("2006-01-02")
		}
	}
	return t.In(time.Now().Location()).Format("2006-01-02")
}

// TruncateDetail is exported for use by backfill and other producers
// that need to ensure detail strings fit within the line limit.
func TruncateDetail(detail string, maxLen int) string {
	if len(detail) <= maxLen {
		return detail
	}
	if maxLen < 20 {
		return detail[:maxLen]
	}
	return detail[:maxLen-15] + "... [truncated]"
}

// FormatFilesChanged formats a slice of changed file paths,
// trimming to keep under a sensible display limit.
func FormatFilesChanged(files []string) []string {
	if len(files) <= 20 {
		return files
	}
	result := make([]string, 21)
	copy(result, files[:20])
	result[20] = fmt.Sprintf("... and %d more files", len(files)-20)
	return result
}

// FilterBlankStrings removes empty strings from a slice.
func FilterBlankStrings(ss []string) []string {
	out := make([]string, 0, len(ss))
	for _, s := range ss {
		if strings.TrimSpace(s) != "" {
			out = append(out, s)
		}
	}
	return out
}
