package capture

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// initTestRepo creates a temporary git repo with an initial commit.
// Returns the repo directory path.
func initTestRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()

	commands := [][]string{
		{"git", "init"},
		{"git", "config", "user.email", "test@test.com"},
		{"git", "config", "user.name", "Test"},
		{"git", "commit", "--allow-empty", "-m", "initial commit"},
	}

	for _, args := range commands {
		cmd := exec.Command(args[0], args[1:]...)
		cmd.Dir = dir
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git setup %v: %v\n%s", args, err, out)
		}
	}

	return dir
}

func TestNewGitWatcher(t *testing.T) {
	dir := initTestRepo(t)
	gw := NewGitWatcher(dir, &testLogger{})

	if gw.Name() != "git" {
		t.Errorf("Name() = %q, want git", gw.Name())
	}

	paths := gw.WatchedPaths()
	if len(paths) != 1 || !strings.HasSuffix(paths[0], ".git") {
		t.Errorf("WatchedPaths() = %v", paths)
	}
}

func TestGitWatcherStartStop(t *testing.T) {
	dir := initTestRepo(t)
	gw := NewGitWatcher(dir, &testLogger{})
	ch := make(chan CaptureEvent, 10)

	if err := gw.Start(ch); err != nil {
		t.Fatalf("Start: %v", err)
	}

	gw.Stop()
}

func TestGitWatcherNotGitRepo(t *testing.T) {
	dir := t.TempDir()
	gw := NewGitWatcher(dir, &testLogger{})
	ch := make(chan CaptureEvent, 10)

	err := gw.Start(ch)
	if err == nil {
		gw.Stop()
		t.Fatal("expected error for non-git directory")
	}
	if !strings.Contains(err.Error(), "not a git repository") {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestGitWatcherDetectsCommit(t *testing.T) {
	dir := initTestRepo(t)
	gw := NewGitWatcher(dir, &testLogger{})
	ch := make(chan CaptureEvent, 10)

	if err := gw.Start(ch); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer gw.Stop()

	// Make a commit.
	cmd := exec.Command("git", "commit", "--allow-empty", "-m", "test capture commit")
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git commit: %v\n%s", err, out)
	}

	// Wait for debounce + processing.
	var event CaptureEvent
	select {
	case event = <-ch:
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for commit event")
	}

	if event.Source != "git" {
		t.Errorf("source = %q, want git", event.Source)
	}
	if event.Type != "commit" {
		t.Errorf("type = %q, want commit", event.Type)
	}
	if event.Content.Summary != "test capture commit" {
		t.Errorf("summary = %q, want 'test capture commit'", event.Content.Summary)
	}
	if event.GitContext == nil {
		t.Fatal("gitContext is nil")
	}
	if event.GitContext.CommitHash == "" {
		t.Error("commitHash is empty")
	}
}

func TestGitWatcherDetectsBranchSwitch(t *testing.T) {
	dir := initTestRepo(t)
	gw := NewGitWatcher(dir, &testLogger{})
	ch := make(chan CaptureEvent, 10)

	if err := gw.Start(ch); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer gw.Stop()

	// Create and switch to a new branch.
	cmd := exec.Command("git", "checkout", "-b", "feature-test")
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git checkout: %v\n%s", err, out)
	}

	// Wait for event.
	var found bool
	timeout := time.After(3 * time.Second)
	for !found {
		select {
		case event := <-ch:
			if event.Type == "branch-switch" {
				found = true
				if !strings.Contains(event.Content.Summary, "feature-test") {
					t.Errorf("summary doesn't contain branch name: %q", event.Content.Summary)
				}
			}
		case <-timeout:
			t.Fatal("timed out waiting for branch-switch event")
		}
	}
}

func TestGitBackfill(t *testing.T) {
	dir := initTestRepo(t)

	// Add more commits for backfill.
	for i := 0; i < 3; i++ {
		cmd := exec.Command("git", "commit", "--allow-empty", "-m", "backfill commit")
		cmd.Dir = dir
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git commit: %v\n%s", err, out)
		}
	}

	gw := NewGitWatcher(dir, &testLogger{})
	ch := make(chan CaptureEvent, 100)

	// Start is needed to initialize state but not required for Backfill channel usage.
	// We can call Backfill directly since it uses its own eventCh param.
	since := time.Now().AddDate(0, 0, -30)
	count, err := gw.Backfill(since, ch)
	if err != nil {
		t.Fatalf("Backfill: %v", err)
	}

	// We expect at least 4 commits (initial + 3 backfill).
	if count < 4 {
		t.Errorf("backfill count = %d, want >= 4", count)
	}

	// Verify events in channel.
	for i := 0; i < count; i++ {
		event := <-ch
		if event.Source != "git" {
			t.Errorf("event[%d].source = %q", i, event.Source)
		}
		if event.Metadata == nil || event.Metadata["backfill"] != true {
			t.Errorf("event[%d] missing backfill metadata", i)
		}
	}
}

func TestBranchNameHelper(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"ref: refs/heads/main", "main"},
		{"ref: refs/heads/feature/cool", "feature/cool"},
		{"abc123deadbeef", "abc123deadbeef"},
	}

	for _, tt := range tests {
		got := branchName(tt.input)
		if got != tt.want {
			t.Errorf("branchName(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestNormalizeTimestamp(t *testing.T) {
	// Valid RFC3339.
	result := normalizeTimestamp("2026-04-15T10:30:00Z")
	if result != "2026-04-15T10:30:00Z" {
		t.Errorf("got %q", result)
	}

	// With timezone offset.
	result = normalizeTimestamp("2026-04-15T10:30:00+05:30")
	if result == "" {
		t.Error("expected non-empty result for timezone offset")
	}

	// Invalid — should return current time.
	result = normalizeTimestamp("not-a-timestamp")
	if result == "" {
		t.Error("expected fallback timestamp")
	}
}

func TestGitWatcherRefsStashDir(t *testing.T) {
	dir := initTestRepo(t)

	// Create refs/stash directory if it doesn't exist.
	stashDir := filepath.Join(dir, ".git", "refs", "stash")
	_ = os.MkdirAll(filepath.Dir(stashDir), 0o755)

	gw := NewGitWatcher(dir, &testLogger{})
	ch := make(chan CaptureEvent, 10)

	if err := gw.Start(ch); err != nil {
		t.Fatalf("Start: %v", err)
	}
	gw.Stop()
}
