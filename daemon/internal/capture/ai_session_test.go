package capture

import (
	"testing"
	"time"

	"github.com/unfade-io/unfade-cli/daemon/internal/capture/parsers"
)

// mockParser implements parsers.AIToolParser for testing.
type mockParser struct {
	name      string
	sources   []parsers.DataSource
	tailTurns []parsers.ConversationTurn
	tailOff   int64
}

func (m *mockParser) Name() string                   { return m.name }
func (m *mockParser) Discover() []parsers.DataSource { return m.sources }
func (m *mockParser) Parse(src parsers.DataSource, since time.Time) ([]parsers.ConversationTurn, error) {
	return m.tailTurns, nil
}
func (m *mockParser) Tail(src parsers.DataSource, offset int64) ([]parsers.ConversationTurn, int64, error) {
	if offset >= m.tailOff {
		return nil, offset, nil
	}
	return m.tailTurns, m.tailOff, nil
}

func TestAISessionWatcherV2Name(t *testing.T) {
	w := NewAISessionWatcher(&testLogger{}, nil)
	if w.Name() != "ai-session" {
		t.Errorf("Name() = %q, want ai-session", w.Name())
	}
}

func TestAISessionWatcherV2StartStopNoDirs(t *testing.T) {
	w := &AISessionWatcher{
		logger:  &testLogger{},
		parsers: []parsers.AIToolParser{&mockParser{name: "mock"}},
		done:    make(chan struct{}),
		offsets: make(map[string]int64),
	}

	ch := make(chan CaptureEvent, 10)
	if err := w.Start(ch); err != nil {
		t.Fatalf("Start: %v", err)
	}
	w.Stop()
}

// T-100: AISessionWatcher V2 emits events with direction_signals metadata.
func TestAISessionWatcherV2EmitsClassifiedEvents(t *testing.T) {
	mock := &mockParser{
		name: "test-tool",
		sources: []parsers.DataSource{
			{Tool: "test", Path: "/tmp/nonexistent-test-file.jsonl", Format: "jsonl"},
		},
		tailTurns: []parsers.ConversationTurn{
			{
				ConversationID: "conv-1", TurnIndex: 0, Role: "user",
				Content:   "No, don't use a singleton — use dependency injection instead of singletons for testability",
				Timestamp: time.Now(), SessionID: "sess-1",
			},
			{
				ConversationID: "conv-1", TurnIndex: 1, Role: "assistant",
				Content:   "I'll switch to dependency injection as you suggested.",
				Timestamp: time.Now(), SessionID: "sess-1",
			},
		},
		tailOff: 500,
	}

	ch := make(chan CaptureEvent, 10)
	w := &AISessionWatcher{
		logger:  &testLogger{},
		parsers: []parsers.AIToolParser{mock},
		done:    make(chan struct{}),
		offsets: make(map[string]int64),
		eventCh: ch,
	}

	w.scanAndEmit()

	select {
	case event := <-ch:
		if event.Source != "ai-session" {
			t.Errorf("source = %q, want ai-session", event.Source)
		}
		if event.Type != "ai-conversation" {
			t.Errorf("type = %q, want ai-conversation", event.Type)
		}
		if event.Metadata == nil {
			t.Fatal("expected metadata")
		}
		if _, ok := event.Metadata["direction_signals"]; !ok {
			t.Error("expected direction_signals in metadata")
		}
		if event.Metadata["ai_tool"] != "test-tool" {
			t.Errorf("ai_tool = %q, want test-tool", event.Metadata["ai_tool"])
		}
		turnCount, _ := event.Metadata["turn_count"].(int)
		if turnCount != 2 {
			t.Errorf("turn_count = %d, want 2", turnCount)
		}
	case <-time.After(1 * time.Second):
		t.Error("no event emitted")
	}
}

func TestAISessionWatcherV2OffsetTracking(t *testing.T) {
	mock := &mockParser{
		name:    "test",
		sources: []parsers.DataSource{{Tool: "test", Path: "/tmp/test-offset.jsonl", Format: "jsonl"}},
		tailTurns: []parsers.ConversationTurn{
			{ConversationID: "c1", TurnIndex: 0, Role: "user", Content: "hello", Timestamp: time.Now()},
		},
		tailOff: 100,
	}

	ch := make(chan CaptureEvent, 10)
	w := &AISessionWatcher{
		logger:  &testLogger{},
		parsers: []parsers.AIToolParser{mock},
		done:    make(chan struct{}),
		offsets: make(map[string]int64),
		eventCh: ch,
	}

	w.scanAndEmit()

	// Offset should be updated.
	w.mu.Lock()
	off := w.offsets["/tmp/test-offset.jsonl"]
	w.mu.Unlock()
	if off != 100 {
		t.Errorf("offset = %d, want 100", off)
	}

	// Second scan — no new data (offset already at 100).
	w.scanAndEmit()

	select {
	case <-ch:
		// First scan's event — drain it.
	default:
	}
	select {
	case <-ch:
		t.Error("unexpected second event (no new data)")
	case <-time.After(100 * time.Millisecond):
		// Good.
	}
}

func TestAISessionWatcherV2MultipleConversations(t *testing.T) {
	mock := &mockParser{
		name:    "multi",
		sources: []parsers.DataSource{{Tool: "multi", Path: "/tmp/multi.jsonl", Format: "jsonl"}},
		tailTurns: []parsers.ConversationTurn{
			{ConversationID: "conv-A", TurnIndex: 0, Role: "user", Content: "question A", Timestamp: time.Now()},
			{ConversationID: "conv-A", TurnIndex: 1, Role: "assistant", Content: "answer A", Timestamp: time.Now()},
			{ConversationID: "conv-B", TurnIndex: 0, Role: "user", Content: "question B", Timestamp: time.Now()},
			{ConversationID: "conv-B", TurnIndex: 1, Role: "assistant", Content: "answer B", Timestamp: time.Now()},
		},
		tailOff: 400,
	}

	ch := make(chan CaptureEvent, 10)
	w := &AISessionWatcher{
		logger:  &testLogger{},
		parsers: []parsers.AIToolParser{mock},
		done:    make(chan struct{}),
		offsets: make(map[string]int64),
		eventCh: ch,
	}

	w.scanAndEmit()

	// Should emit 2 events (one per conversation).
	count := 0
	timeout := time.After(1 * time.Second)
	for {
		select {
		case <-ch:
			count++
			if count == 2 {
				goto done
			}
		case <-timeout:
			goto done
		}
	}
done:
	if count != 2 {
		t.Errorf("got %d events, want 2 (one per conversation)", count)
	}
}

func TestTurnsToEventsDirectionSignals(t *testing.T) {
	turns := []parsers.ConversationTurn{
		{ConversationID: "c1", TurnIndex: 0, Role: "user", Content: "Refactor auth to use DI instead of singletons", Timestamp: time.Now()},
		{ConversationID: "c1", TurnIndex: 1, Role: "assistant", Content: "I'll use a singleton pattern for AuthService.", Timestamp: time.Now()},
		{ConversationID: "c1", TurnIndex: 2, Role: "user", Content: "No, don't use singletons — we need DI because our test framework uses isolated containers", Timestamp: time.Now()},
		{ConversationID: "c1", TurnIndex: 3, Role: "assistant", Content: "Switching to dependency injection.", Timestamp: time.Now()},
	}

	events := TurnsToEvents(turns, "claude-code")
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}

	ev := events[0]
	signals, ok := ev.Metadata["direction_signals"].(parsers.DirectionSignals)
	if !ok {
		t.Fatal("direction_signals not found or wrong type")
	}
	if signals.HumanDirectionScore <= 0 {
		t.Errorf("HDS = %.3f, want > 0", signals.HumanDirectionScore)
	}
	if signals.RejectionCount == 0 {
		t.Error("expected rejection count > 0")
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

func TestIsRelevantAIFile(t *testing.T) {
	tests := []struct {
		name string
		want bool
	}{
		{"test.jsonl", true},
		{"test.log", true},
		{"test.db", true},
		{"test.md", true},
		{"test.go", false},
		{"readme.txt", false},
	}
	for _, tt := range tests {
		if got := isRelevantAIFile(tt.name); got != tt.want {
			t.Errorf("isRelevantAIFile(%q) = %v, want %v", tt.name, got, tt.want)
		}
	}
}
