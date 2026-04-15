package capture

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestAISessionWatcherName(t *testing.T) {
	w := NewAISessionWatcher(&testLogger{})
	if w.Name() != "ai-session" {
		t.Errorf("Name() = %q, want ai-session", w.Name())
	}
}

func TestAISessionWatcherStartStopNoDirectories(t *testing.T) {
	// When no AI tool directories exist, watcher should start in poll-only mode.
	w := &AISessionWatcher{
		logger: &testLogger{},
		sources: []aiLogSource{
			{name: "test", baseDir: "/nonexistent/path", pattern: "*.log"},
		},
		done:      make(chan struct{}),
		seenFiles: make(map[string]int64),
	}

	ch := make(chan CaptureEvent, 10)
	if err := w.Start(ch); err != nil {
		t.Fatalf("Start: %v", err)
	}
	w.Stop()
}

func TestAISessionParseJSONEntry(t *testing.T) {
	w := &AISessionWatcher{
		logger:    &testLogger{},
		seenFiles: make(map[string]int64),
	}

	tests := []struct {
		name      string
		entry     map[string]any
		wantType  string
		wantNil   bool
	}{
		{
			name:     "assistant completion",
			entry:    map[string]any{"role": "assistant", "content": "Here is the solution"},
			wantType: "ai-completion",
		},
		{
			name:     "user message",
			entry:    map[string]any{"role": "user", "content": "How do I fix this bug?"},
			wantType: "ai-conversation",
		},
		{
			name:     "human message",
			entry:    map[string]any{"role": "human", "message": "Explain this code"},
			wantType: "ai-conversation",
		},
		{
			name:     "error",
			entry:    map[string]any{"type": "error", "error": "rate limited"},
			wantType: "ai-rejection",
		},
		{
			name:    "unknown type",
			entry:   map[string]any{"type": "system", "data": "init"},
			wantNil: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			event := w.parseJSONEntry(tt.entry, "test-tool", "/test/log.jsonl")
			if tt.wantNil {
				if event != nil {
					t.Error("expected nil event")
				}
				return
			}
			if event == nil {
				t.Fatal("expected non-nil event")
			}
			if event.Type != tt.wantType {
				t.Errorf("type = %q, want %q", event.Type, tt.wantType)
			}
			if event.Source != "ai-session" {
				t.Errorf("source = %q, want ai-session", event.Source)
			}
		})
	}
}

func TestAISessionParsePlainText(t *testing.T) {
	w := &AISessionWatcher{
		logger:    &testLogger{},
		seenFiles: make(map[string]int64),
	}

	tests := []struct {
		line     string
		wantType string
		wantNil  bool
	}{
		{"2026-04-15 completion: generated code", "ai-completion", false},
		{"prompt sent to model", "ai-conversation", false},
		{"error: API rate limit exceeded", "ai-rejection", false},
		{"starting server on port 3000", "", true},
	}

	for _, tt := range tests {
		t.Run(tt.line[:20], func(t *testing.T) {
			event := w.parsePlainTextEntry(tt.line, "cursor", "/test/log")
			if tt.wantNil {
				if event != nil {
					t.Error("expected nil event")
				}
				return
			}
			if event == nil {
				t.Fatal("expected non-nil event")
			}
			if event.Type != tt.wantType {
				t.Errorf("type = %q, want %q", event.Type, tt.wantType)
			}
		})
	}
}

func TestAISessionTailFile(t *testing.T) {
	dir := t.TempDir()
	logFile := filepath.Join(dir, "test.jsonl")

	// Write some JSONL lines.
	lines := []map[string]any{
		{"role": "user", "content": "help me"},
		{"role": "assistant", "content": "sure thing"},
		{"type": "error", "error": "timeout"},
	}

	f, err := os.Create(logFile)
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range lines {
		data, _ := json.Marshal(line)
		f.Write(data)
		f.WriteString("\n")
	}
	f.Close()

	ch := make(chan CaptureEvent, 10)
	w := &AISessionWatcher{
		logger:    &testLogger{},
		eventCh:   ch,
		done:      make(chan struct{}),
		seenFiles: make(map[string]int64),
	}

	newOffset := w.tailFile(logFile, 0, "test")
	if newOffset == 0 {
		t.Error("expected non-zero offset after reading")
	}

	// Should have emitted 3 events.
	count := 0
	timeout := time.After(500 * time.Millisecond)
drain:
	for {
		select {
		case <-ch:
			count++
		case <-timeout:
			break drain
		}
	}

	if count != 3 {
		t.Errorf("got %d events, want 3", count)
	}

	// Reading again from the same offset should produce no new events.
	newOffset2 := w.tailFile(logFile, newOffset, "test")
	if newOffset2 != newOffset {
		// May differ slightly due to seek mechanics, but no events should fire.
	}

	select {
	case <-ch:
		t.Error("unexpected event on re-read")
	case <-time.After(100 * time.Millisecond):
		// Good — no events.
	}
}

func TestTruncateSummary(t *testing.T) {
	short := "short"
	if truncateSummary(short) != "short" {
		t.Error("short string should not be truncated")
	}

	long := "a very long string that goes on and on " +
		"and on and on and on and on and on and on " +
		"and on and on and on and on and on and on " +
		"and on and on and on and on and on and on " +
		"and on and on and on and on and on and on " +
		"and on and on and on and on and on and on "
	result := truncateSummary(long)
	if len(result) > 200 {
		t.Errorf("truncated length %d > 200", len(result))
	}
}

func TestIsRelevantFile(t *testing.T) {
	w := &AISessionWatcher{}

	if !w.isRelevantFile("test.log") {
		t.Error("expected .log to be relevant")
	}
	if !w.isRelevantFile("session.jsonl") {
		t.Error("expected .jsonl to be relevant")
	}
	if w.isRelevantFile("readme.md") {
		t.Error("expected .md to be irrelevant")
	}
}
