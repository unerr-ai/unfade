package capture

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestIngestStateManagerLifecycle(t *testing.T) {
	dir := t.TempDir()
	m := NewIngestStateManager(dir)

	// Initial state is idle.
	state := m.Get()
	if state.Status != "idle" {
		t.Errorf("initial status = %q, want idle", state.Status)
	}

	// Mark running.
	since := time.Now().Add(-7 * 24 * time.Hour)
	until := time.Now()
	m.MarkRunning(since, until)

	state = m.Get()
	if state.Status != "running" {
		t.Errorf("status = %q, want running", state.Status)
	}
	if state.StartedAt == "" {
		t.Error("expected non-empty StartedAt")
	}

	// Set sources.
	m.SetSources([]IngestSourceProgress{
		{Tool: "claude-code", FilesDiscovered: 3},
		{Tool: "cursor", FilesDiscovered: 1},
	})

	// Record file processed.
	m.RecordFileProcessed("claude-code", "/tmp/session1.jsonl", 5)
	state = m.Get()
	if state.TotalEvents != 5 {
		t.Errorf("total events = %d, want 5", state.TotalEvents)
	}
	if !state.Processed["/tmp/session1.jsonl"] {
		t.Error("expected /tmp/session1.jsonl to be marked processed")
	}

	// Record error.
	m.RecordError("cursor")
	state = m.Get()
	for _, sp := range state.Sources {
		if sp.Tool == "cursor" && sp.Errors != 1 {
			t.Errorf("cursor errors = %d, want 1", sp.Errors)
		}
	}

	// Mark completed.
	m.MarkCompleted()
	state = m.Get()
	if state.Status != "completed" {
		t.Errorf("status = %q, want completed", state.Status)
	}
	if state.CompletedAt == "" {
		t.Error("expected non-empty CompletedAt")
	}
}

// T-102: Atomic write (temp → rename).
func TestIngestStateAtomicWrite(t *testing.T) {
	dir := t.TempDir()
	m := NewIngestStateManager(dir)
	m.MarkRunning(time.Now().Add(-24*time.Hour), time.Now())

	// Verify the file exists and is valid JSON.
	path := filepath.Join(dir, "ingest.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read state file: %v", err)
	}

	var state IngestState
	if err := json.Unmarshal(data, &state); err != nil {
		t.Fatalf("invalid JSON in state file: %v", err)
	}
	if state.Status != "running" {
		t.Errorf("status = %q, want running", state.Status)
	}

	// Temp file should NOT exist (was renamed).
	tmpPath := path + ".tmp"
	if _, err := os.Stat(tmpPath); !os.IsNotExist(err) {
		t.Error("temp file should not exist after atomic write")
	}
}

func TestIngestStateManagerPersistence(t *testing.T) {
	dir := t.TempDir()

	// Write state.
	m1 := NewIngestStateManager(dir)
	m1.MarkRunning(time.Now().Add(-24*time.Hour), time.Now())
	m1.RecordFileProcessed("test", "/tmp/a.jsonl", 3)

	// Create a new manager — should load from disk.
	m2 := NewIngestStateManager(dir)
	state := m2.Get()
	if state.Status != "running" {
		t.Errorf("loaded status = %q, want running", state.Status)
	}
	if state.TotalEvents != 3 {
		t.Errorf("loaded total_events = %d, want 3", state.TotalEvents)
	}
	if !state.Processed["/tmp/a.jsonl"] {
		t.Error("expected /tmp/a.jsonl to persist as processed")
	}
}

func TestIngestStateIsProcessed(t *testing.T) {
	dir := t.TempDir()
	m := NewIngestStateManager(dir)
	m.MarkRunning(time.Now().Add(-24*time.Hour), time.Now())
	m.SetSources([]IngestSourceProgress{{Tool: "test", FilesDiscovered: 1}})

	if m.IsProcessed("/tmp/file.jsonl") {
		t.Error("file should not be processed yet")
	}

	m.RecordFileProcessed("test", "/tmp/file.jsonl", 2)

	if !m.IsProcessed("/tmp/file.jsonl") {
		t.Error("file should be marked processed")
	}
}

func TestIngestStateMarkFailed(t *testing.T) {
	dir := t.TempDir()
	m := NewIngestStateManager(dir)
	m.MarkRunning(time.Now().Add(-24*time.Hour), time.Now())
	m.MarkFailed("test error")

	state := m.Get()
	if state.Status != "failed" {
		t.Errorf("status = %q, want failed", state.Status)
	}
	if state.Error != "test error" {
		t.Errorf("error = %q, want 'test error'", state.Error)
	}
}

// T-102: handles concurrent reads.
func TestIngestStateConcurrentAccess(t *testing.T) {
	dir := t.TempDir()
	m := NewIngestStateManager(dir)
	m.MarkRunning(time.Now().Add(-24*time.Hour), time.Now())
	m.SetSources([]IngestSourceProgress{{Tool: "test", FilesDiscovered: 100}})

	var wg sync.WaitGroup

	// Concurrent writes.
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			m.RecordFileProcessed("test", filepath.Join("/tmp", string(rune('a'+n))+".jsonl"), 1)
		}(i)
	}

	// Concurrent reads.
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = m.Get()
		}()
	}

	wg.Wait()

	state := m.Get()
	if state.TotalEvents != 20 {
		t.Errorf("total events = %d, want 20 (after 20 concurrent writes)", state.TotalEvents)
	}
}
