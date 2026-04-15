package capture

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestOrchestratorStartStop(t *testing.T) {
	dir := initTestRepo(t)
	eventsDir := filepath.Join(dir, ".unfade", "events")

	orch := NewOrchestrator(OrchestratorConfig{
		ProjectDir: dir,
		EventsDir:  eventsDir,
		Logger:     &testLogger{},
	})

	if err := orch.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}

	// Verify events directory was created.
	if _, err := os.Stat(eventsDir); os.IsNotExist(err) {
		t.Error("events directory not created")
	}

	orch.Stop()
}

func TestOrchestratorDoubleStart(t *testing.T) {
	dir := initTestRepo(t)
	eventsDir := filepath.Join(dir, ".unfade", "events")

	orch := NewOrchestrator(OrchestratorConfig{
		ProjectDir: dir,
		EventsDir:  eventsDir,
		Logger:     &testLogger{},
	})

	if err := orch.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer orch.Stop()

	err := orch.Start()
	if err == nil {
		t.Error("expected error on double start")
	}
}

func TestOrchestratorWatcherStatus(t *testing.T) {
	dir := initTestRepo(t)
	eventsDir := filepath.Join(dir, ".unfade", "events")

	orch := NewOrchestrator(OrchestratorConfig{
		ProjectDir: dir,
		EventsDir:  eventsDir,
		Logger:     &testLogger{},
	})

	if err := orch.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer orch.Stop()

	status := orch.WatcherStatus()
	if _, ok := status["git"]; !ok {
		t.Error("expected git in watcher status")
	}
	if _, ok := status["ai-session"]; !ok {
		t.Error("expected ai-session in watcher status")
	}
}

func TestOrchestratorEventsToday(t *testing.T) {
	dir := initTestRepo(t)
	eventsDir := filepath.Join(dir, ".unfade", "events")

	orch := NewOrchestrator(OrchestratorConfig{
		ProjectDir: dir,
		EventsDir:  eventsDir,
		Logger:     &testLogger{},
	})

	if err := orch.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer orch.Stop()

	// Initially 0.
	if orch.EventsToday() != 0 {
		t.Errorf("events today = %d, want 0", orch.EventsToday())
	}
}

func TestOrchestratorBackfill(t *testing.T) {
	dir := initTestRepo(t)

	// Add extra commits.
	for i := 0; i < 2; i++ {
		cmd := exec.Command("git", "commit", "--allow-empty", "-m", "orch backfill")
		cmd.Dir = dir
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git commit: %v\n%s", err, out)
		}
	}

	eventsDir := filepath.Join(dir, ".unfade", "events")
	orch := NewOrchestrator(OrchestratorConfig{
		ProjectDir: dir,
		EventsDir:  eventsDir,
		Logger:     &testLogger{},
	})

	if err := orch.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer orch.Stop()

	since := time.Now().AddDate(0, 0, -30)
	count, err := orch.Backfill(since)
	if err != nil {
		t.Fatalf("Backfill: %v", err)
	}

	if count < 3 {
		t.Errorf("backfill count = %d, want >= 3", count)
	}

	// Give writer time to flush.
	time.Sleep(200 * time.Millisecond)

	if orch.EventsToday() < 3 {
		t.Errorf("events today = %d after backfill, want >= 3", orch.EventsToday())
	}
}

func TestOrchestratorBackfillNotRunning(t *testing.T) {
	dir := initTestRepo(t)
	eventsDir := filepath.Join(dir, ".unfade", "events")

	orch := NewOrchestrator(OrchestratorConfig{
		ProjectDir: dir,
		EventsDir:  eventsDir,
		Logger:     &testLogger{},
	})

	_, err := orch.Backfill(time.Now().AddDate(0, 0, -30))
	if err == nil {
		t.Error("expected error when not running")
	}
}
