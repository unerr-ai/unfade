package health

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type testLogger struct{}

func (l *testLogger) Debug(msg string, fields ...map[string]any) {}
func (l *testLogger) Error(msg string, fields ...map[string]any) {}

func TestReporter_WritesHealthJSON(t *testing.T) {
	dir := t.TempDir()

	r := NewReporter(ReporterConfig{
		StateDir: dir,
		Version:  "0.1.0-test",
		Logger:   &testLogger{},
	})

	r.WriteOnce("running")

	data, err := os.ReadFile(filepath.Join(dir, "health.json"))
	if err != nil {
		t.Fatalf("read health.json: %v", err)
	}

	var h HealthStatus
	if err := json.Unmarshal(data, &h); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if h.Status != "running" {
		t.Errorf("status = %q, want running", h.Status)
	}
	if h.PID != os.Getpid() {
		t.Errorf("pid = %d, want %d", h.PID, os.Getpid())
	}
	if h.Version != "0.1.0-test" {
		t.Errorf("version = %q, want 0.1.0-test", h.Version)
	}
}

func TestReporter_AtomicWrite_NeverPartial(t *testing.T) {
	dir := t.TempDir()

	r := NewReporter(ReporterConfig{
		StateDir: dir,
		Version:  "0.1.0",
		Logger:   &testLogger{},
	})

	// Write multiple times rapidly — health.json should always be valid.
	for i := 0; i < 20; i++ {
		r.WriteOnce("running")

		data, err := os.ReadFile(filepath.Join(dir, "health.json"))
		if err != nil {
			t.Fatalf("read health.json on iteration %d: %v", i, err)
		}

		var h HealthStatus
		if err := json.Unmarshal(data, &h); err != nil {
			t.Fatalf("invalid JSON on iteration %d: %v\ncontent: %s", i, err, string(data))
		}
	}
}

func TestReporter_PeriodicWriting(t *testing.T) {
	dir := t.TempDir()

	r := NewReporter(ReporterConfig{
		StateDir: dir,
		Version:  "0.1.0",
		Logger:   &testLogger{},
		Interval: 50 * time.Millisecond,
	})

	r.Start(50 * time.Millisecond)
	time.Sleep(150 * time.Millisecond)

	// Read before stopping — Stop doesn't remove health.json but timing matters.
	data, err := os.ReadFile(filepath.Join(dir, "health.json"))
	if err != nil {
		t.Fatalf("read health.json: %v", err)
	}

	r.Stop()
	// Clean up tmp file if it exists (atomic write artifact).
	RemoveHealthFile(dir)

	var h HealthStatus
	if err := json.Unmarshal(data, &h); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if h.Status != "running" {
		t.Errorf("status = %q, want running", h.Status)
	}
}

func TestReporter_IncludesBudgetData(t *testing.T) {
	dir := t.TempDir()

	r := NewReporter(ReporterConfig{
		StateDir: dir,
		Version:  "0.1.0",
		Logger:   &testLogger{},
		GetBudget: func() BudgetStatus {
			return BudgetStatus{MemoryMB: 25.5, HeapMB: 10.0}
		},
		CountEvents: func() int { return 42 },
	})

	r.WriteOnce("running")

	data, _ := os.ReadFile(filepath.Join(dir, "health.json"))
	var h HealthStatus
	json.Unmarshal(data, &h)

	if h.MemoryMB != 25.5 {
		t.Errorf("memory_mb = %f, want 25.5", h.MemoryMB)
	}
	if h.EventsToday != 42 {
		t.Errorf("events_today = %d, want 42", h.EventsToday)
	}
}

func TestReporter_WriteOnceWithStoppedStatus(t *testing.T) {
	dir := t.TempDir()

	r := NewReporter(ReporterConfig{
		StateDir: dir,
		Version:  "0.1.0",
		Logger:   &testLogger{},
	})

	r.WriteOnce("stopped")

	data, _ := os.ReadFile(filepath.Join(dir, "health.json"))
	var h HealthStatus
	json.Unmarshal(data, &h)

	if h.Status != "stopped" {
		t.Errorf("status = %q, want stopped", h.Status)
	}
}

func TestRemoveHealthFile(t *testing.T) {
	dir := t.TempDir()
	healthPath := filepath.Join(dir, "health.json")
	os.WriteFile(healthPath, []byte("{}"), 0o644)

	RemoveHealthFile(dir)

	if _, err := os.Stat(healthPath); !os.IsNotExist(err) {
		t.Error("health.json should be removed")
	}
}
