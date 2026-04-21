package capture

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// testLogger is a no-op logger for tests.
type testLogger struct{}

func (l *testLogger) Debug(_ string, _ ...map[string]any) {}
func (l *testLogger) Info(_ string, _ ...map[string]any)  {}
func (l *testLogger) Warn(_ string, _ ...map[string]any)  {}
func (l *testLogger) Error(_ string, _ ...map[string]any) {}

func TestEventWriterWritesSingleEvent(t *testing.T) {
	dir := t.TempDir()
	ch := make(chan CaptureEvent, 1)
	w := NewEventWriter(dir, ch, &testLogger{})

	if err := w.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}

	now := time.Now().UTC()
	event := CaptureEvent{
		ID:        "test-id-1",
		Timestamp: now.Format(time.RFC3339),
		Source:    "git",
		Type:      "commit",
		Content: EventContent{
			Summary: "test commit",
			Project: "test-project",
		},
	}

	ch <- event
	// Give writer time to process.
	time.Sleep(100 * time.Millisecond)
	w.Stop()

	// Read the file.
	date := now.Format("2006-01-02")
	data, err := os.ReadFile(filepath.Join(dir, date+".jsonl"))
	if err != nil {
		t.Fatalf("read: %v", err)
	}

	var parsed CaptureEvent
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if parsed.ID != "test-id-1" {
		t.Errorf("got id %q, want test-id-1", parsed.ID)
	}
	if parsed.Content.Summary != "test commit" {
		t.Errorf("got summary %q, want 'test commit'", parsed.Content.Summary)
	}
}

func TestEventWriterMultipleEvents(t *testing.T) {
	dir := t.TempDir()
	ch := make(chan CaptureEvent, 10)
	w := NewEventWriter(dir, ch, &testLogger{})

	if err := w.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}

	now := time.Now().UTC()
	for i := 0; i < 5; i++ {
		ch <- CaptureEvent{
			ID:        "id-" + string(rune('a'+i)),
			Timestamp: now.Format(time.RFC3339),
			Source:    "git",
			Type:      "commit",
			Content:   EventContent{Summary: "commit"},
		}
	}

	time.Sleep(200 * time.Millisecond)
	w.Stop()

	if w.TodayCount() != 5 {
		t.Errorf("count = %d, want 5", w.TodayCount())
	}

	date := now.Format("2006-01-02")
	data, err := os.ReadFile(filepath.Join(dir, date+".jsonl"))
	if err != nil {
		t.Fatalf("read: %v", err)
	}

	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != 5 {
		t.Errorf("got %d lines, want 5", len(lines))
	}
}

func TestEventWriterDrainsOnStop(t *testing.T) {
	dir := t.TempDir()
	ch := make(chan CaptureEvent, 10)
	w := NewEventWriter(dir, ch, &testLogger{})

	if err := w.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}

	now := time.Now().UTC()
	// Queue events and stop immediately.
	for i := 0; i < 3; i++ {
		ch <- CaptureEvent{
			ID:        "drain-id",
			Timestamp: now.Format(time.RFC3339),
			Source:    "git",
			Type:      "commit",
			Content:   EventContent{Summary: "drain test"},
		}
	}

	w.Stop()

	// All events should have been drained.
	if w.TodayCount() < 1 {
		t.Error("expected at least 1 event written during drain")
	}
}

func TestExtractDate(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"2026-04-15T10:30:00Z", "2026-04-15"},
		{"2026-01-01T00:00:00+05:30", "2026-01-01"}, // Preserves parsed timezone date
		{"invalid", time.Now().UTC().Format("2006-01-02")},
	}

	for _, tt := range tests {
		got := extractDate(tt.input)
		if got != tt.want {
			t.Errorf("extractDate(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestTruncateDetail(t *testing.T) {
	short := "short string"
	if TruncateDetail(short, 100) != short {
		t.Error("short string should not be truncated")
	}

	long := strings.Repeat("a", 300)
	result := TruncateDetail(long, 200)
	if len(result) > 200 {
		t.Errorf("truncated length %d > 200", len(result))
	}
	if !strings.HasSuffix(result, "... [truncated]") {
		t.Error("expected truncation suffix")
	}
}

func TestFilterBlankStrings(t *testing.T) {
	input := []string{"a", "", "b", "  ", "c"}
	result := FilterBlankStrings(input)
	if len(result) != 3 {
		t.Errorf("got %d, want 3", len(result))
	}
}

func TestFormatFilesChanged(t *testing.T) {
	// Under limit — pass through.
	small := []string{"a.go", "b.go"}
	if len(FormatFilesChanged(small)) != 2 {
		t.Error("small list should pass through")
	}

	// Over limit — truncate.
	big := make([]string, 30)
	for i := range big {
		big[i] = "file.go"
	}
	result := FormatFilesChanged(big)
	if len(result) != 21 {
		t.Errorf("got %d, want 21", len(result))
	}
	if !strings.Contains(result[20], "10 more") {
		t.Error("expected '10 more' suffix")
	}
}

// T-320: Large events (>4KB) are written intact without truncation.
func TestLargeEventWrittenIntact(t *testing.T) {
	dir := t.TempDir()
	ch := make(chan CaptureEvent, 1)
	w := NewEventWriter(dir, ch, &testLogger{})

	if err := w.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}

	now := time.Now().UTC()
	largeDetail := strings.Repeat("x", 10000) // 10KB detail
	event := CaptureEvent{
		ID:        "large-evt-1",
		Timestamp: now.Format(time.RFC3339),
		Source:    "ai-session",
		Type:      "ai-conversation",
		Content: EventContent{
			Summary: "large event test",
			Detail:  largeDetail,
		},
	}

	ch <- event
	time.Sleep(100 * time.Millisecond)
	w.Stop()

	date := now.Format("2006-01-02")
	data, err := os.ReadFile(filepath.Join(dir, date+".jsonl"))
	if err != nil {
		t.Fatalf("read: %v", err)
	}

	var parsed CaptureEvent
	if err := json.Unmarshal(bytes.TrimSpace(data), &parsed); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if parsed.Content.Detail != largeDetail {
		t.Errorf("detail was modified: got len %d, want %d", len(parsed.Content.Detail), len(largeDetail))
	}
}

// T-321: Events with many files are written without file list truncation.
func TestManyFilesWrittenIntact(t *testing.T) {
	dir := t.TempDir()
	ch := make(chan CaptureEvent, 1)
	w := NewEventWriter(dir, ch, &testLogger{})

	if err := w.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}

	now := time.Now().UTC()
	files := make([]string, 100)
	for i := range files {
		files[i] = "src/pkg/module/file_" + strings.Repeat("a", 50) + ".go"
	}

	event := CaptureEvent{
		ID:        "many-files-evt",
		Timestamp: now.Format(time.RFC3339),
		Source:    "git",
		Type:      "commit",
		Content: EventContent{
			Summary: "commit with many files",
			Files:   files,
		},
	}

	ch <- event
	time.Sleep(100 * time.Millisecond)
	w.Stop()

	date := now.Format("2006-01-02")
	data, err := os.ReadFile(filepath.Join(dir, date+".jsonl"))
	if err != nil {
		t.Fatalf("read: %v", err)
	}

	var parsed CaptureEvent
	if err := json.Unmarshal(bytes.TrimSpace(data), &parsed); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if len(parsed.Content.Files) != 100 {
		t.Errorf("files list truncated: got %d, want 100", len(parsed.Content.Files))
	}
}
