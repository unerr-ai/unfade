package capture

import (
	"testing"
	"time"

	"github.com/unfade-io/unfade-cli/daemon/internal/capture/parsers"
)

func TestHistoricalIngestorProcessesTurns(t *testing.T) {
	mock := &mockParser{
		name: "test-tool",
		sources: []parsers.DataSource{
			{Tool: "test", Path: "/tmp/hist-session1.jsonl", Format: "jsonl"},
		},
		tailTurns: []parsers.ConversationTurn{
			{ConversationID: "hist-conv-1", TurnIndex: 0, Role: "user", Content: "Add error handling to the API", Timestamp: time.Now()},
			{ConversationID: "hist-conv-1", TurnIndex: 1, Role: "assistant", Content: "I'll add try-catch blocks.", Timestamp: time.Now()},
			{ConversationID: "hist-conv-2", TurnIndex: 0, Role: "user", Content: "Refactor the database layer", Timestamp: time.Now()},
			{ConversationID: "hist-conv-2", TurnIndex: 1, Role: "assistant", Content: "I'll restructure it.", Timestamp: time.Now()},
		},
		tailOff: 1000,
	}

	stateDir := t.TempDir()
	ch := make(chan CaptureEvent, 100)
	stateMgr := NewIngestStateManager(stateDir)

	ingestor := NewHistoricalIngestor(
		[]parsers.AIToolParser{mock},
		ch,
		stateMgr,
		&testLogger{},
		t.TempDir(),
	)

	since := time.Now().Add(-7 * 24 * time.Hour)
	ingestor.Run(since)

	// Wait for completion.
	timeout := time.After(5 * time.Second)
	for {
		state := stateMgr.Get()
		if state.Status == "completed" || state.Status == "failed" {
			break
		}
		select {
		case <-timeout:
			t.Fatal("ingest timed out")
		case <-time.After(50 * time.Millisecond):
		}
	}

	ingestor.Stop()

	// Drain events.
	var events []CaptureEvent
drain:
	for {
		select {
		case ev := <-ch:
			events = append(events, ev)
		default:
			break drain
		}
	}

	// 2 conversations → 2 events.
	if len(events) != 2 {
		t.Errorf("got %d events, want 2", len(events))
	}

	for _, ev := range events {
		if ev.Source != "ai-session" {
			t.Errorf("source = %q, want ai-session", ev.Source)
		}
		if _, ok := ev.Metadata["direction_signals"]; !ok {
			t.Error("expected direction_signals in metadata")
		}
	}

	// State should be completed.
	state := stateMgr.Get()
	if state.Status != "completed" {
		t.Errorf("status = %q, want completed", state.Status)
	}
	if state.TotalEvents != 2 {
		t.Errorf("total_events = %d, want 2", state.TotalEvents)
	}
}

// T-101: Progress tracked in state file.
func TestHistoricalIngestorTracksProgress(t *testing.T) {
	mock := &mockParser{
		name: "progress-test",
		sources: []parsers.DataSource{
			{Tool: "test", Path: "/tmp/progress-a.jsonl", Format: "jsonl"},
			{Tool: "test", Path: "/tmp/progress-b.jsonl", Format: "jsonl"},
		},
		tailTurns: []parsers.ConversationTurn{
			{ConversationID: "c1", TurnIndex: 0, Role: "user", Content: "hello", Timestamp: time.Now()},
		},
		tailOff: 50,
	}

	stateDir := t.TempDir()
	ch := make(chan CaptureEvent, 100)
	stateMgr := NewIngestStateManager(stateDir)

	ingestor := NewHistoricalIngestor(
		[]parsers.AIToolParser{mock},
		ch,
		stateMgr,
		&testLogger{},
		t.TempDir(),
	)

	ingestor.Run(time.Now().Add(-24 * time.Hour))

	timeout := time.After(5 * time.Second)
	for {
		state := stateMgr.Get()
		if state.Status == "completed" {
			break
		}
		select {
		case <-timeout:
			t.Fatal("ingest timed out")
		case <-time.After(50 * time.Millisecond):
		}
	}

	ingestor.Stop()

	state := stateMgr.Get()
	if len(state.Sources) == 0 {
		t.Fatal("expected source progress entries")
	}
	if state.Sources[0].FilesDiscovered != 2 {
		t.Errorf("files_discovered = %d, want 2", state.Sources[0].FilesDiscovered)
	}
	if state.Sources[0].FilesProcessed != 2 {
		t.Errorf("files_processed = %d, want 2", state.Sources[0].FilesProcessed)
	}
}

func TestHistoricalIngestorSkipsAlreadyProcessed(t *testing.T) {
	mock := &mockParser{
		name: "resume-test",
		sources: []parsers.DataSource{
			{Tool: "test", Path: "/tmp/resume-a.jsonl", Format: "jsonl"},
			{Tool: "test", Path: "/tmp/resume-b.jsonl", Format: "jsonl"},
		},
		tailTurns: []parsers.ConversationTurn{
			{ConversationID: "c1", TurnIndex: 0, Role: "user", Content: "Add comprehensive error handling to the service", Timestamp: time.Now()},
		},
		tailOff: 50,
	}

	stateDir := t.TempDir()
	ch := make(chan CaptureEvent, 100)
	stateMgr := NewIngestStateManager(stateDir)

	// Directly pre-seed the Processed map (same package, can access field).
	stateMgr.mu.Lock()
	stateMgr.state.Processed["/tmp/resume-a.jsonl"] = true
	stateMgr.mu.Unlock()

	if !stateMgr.IsProcessed("/tmp/resume-a.jsonl") {
		t.Fatal("expected resume-a to be marked processed")
	}

	ingestor := NewHistoricalIngestor(
		[]parsers.AIToolParser{mock},
		ch,
		stateMgr,
		&testLogger{},
		t.TempDir(),
	)

	ingestor.Run(time.Now().Add(-24 * time.Hour))

	timeout := time.After(5 * time.Second)
	for {
		state := stateMgr.Get()
		if state.Status == "completed" || state.Status == "failed" {
			break
		}
		select {
		case <-timeout:
			t.Fatal("ingest timed out")
		case <-time.After(50 * time.Millisecond):
		}
	}

	ingestor.Stop()

	// Drain events.
	var events []CaptureEvent
	for {
		select {
		case ev := <-ch:
			events = append(events, ev)
		default:
			goto check
		}
	}
check:
	// resume-a was skipped, resume-b was processed → 1 new event.
	if len(events) != 1 {
		state := stateMgr.Get()
		t.Errorf("got %d events, want 1 (skipped already-processed file). state: status=%s total=%d err=%s processed=%v",
			len(events), state.Status, state.TotalEvents, state.Error, state.Processed)
	}
}

func TestHistoricalIngestorCancellation(t *testing.T) {
	// Create a parser that returns many turns to ensure we have time to cancel.
	turns := make([]parsers.ConversationTurn, 100)
	for i := range turns {
		turns[i] = parsers.ConversationTurn{
			ConversationID: "cancel-conv", TurnIndex: i, Role: "user",
			Content: "turn content", Timestamp: time.Now(),
		}
	}

	mock := &mockParser{
		name:      "cancel-test",
		sources:   []parsers.DataSource{{Tool: "test", Path: "/tmp/cancel.jsonl", Format: "jsonl"}},
		tailTurns: turns,
		tailOff:   10000,
	}

	stateDir := t.TempDir()
	ch := make(chan CaptureEvent, 10) // small buffer to force blocking
	stateMgr := NewIngestStateManager(stateDir)

	ingestor := NewHistoricalIngestor(
		[]parsers.AIToolParser{mock},
		ch,
		stateMgr,
		&testLogger{},
		t.TempDir(),
	)

	ingestor.Run(time.Now().Add(-24 * time.Hour))

	// Let it start, then cancel.
	time.Sleep(50 * time.Millisecond)
	ingestor.Stop()

	state := stateMgr.Get()
	if state.Status != "completed" && state.Status != "failed" {
		t.Errorf("status = %q after cancel, want completed or failed", state.Status)
	}
}

func TestHistoricalIngestorDoubleRun(t *testing.T) {
	mock := &mockParser{name: "double"}
	stateDir := t.TempDir()
	ch := make(chan CaptureEvent, 10)
	stateMgr := NewIngestStateManager(stateDir)

	ingestor := NewHistoricalIngestor(
		[]parsers.AIToolParser{mock},
		ch,
		stateMgr,
		&testLogger{},
		t.TempDir(),
	)

	ingestor.Run(time.Now().Add(-24 * time.Hour))
	ingestor.Run(time.Now().Add(-24 * time.Hour)) // Should be a no-op.

	// Wait for first run to finish.
	timeout := time.After(5 * time.Second)
	for {
		if !ingestor.IsRunning() {
			break
		}
		select {
		case <-timeout:
			t.Fatal("timed out waiting for ingest to finish")
		case <-time.After(50 * time.Millisecond):
		}
	}

	ingestor.Stop()
}
