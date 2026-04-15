// FILE: daemon/internal/capture/git.go
// GitWatcher implements CaptureSource — watches .git/ for commits,
// branch switches, reverts, stashes, and merge conflicts via fsnotify.
// Also provides Backfill() to ingest historical git log into CaptureEvents.

package capture

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/google/uuid"
)

const (
	gitDebounceDelay = 500 * time.Millisecond
	gitLogFormat     = "%H|%s|%an|%ae|%aI"
	maxDetailLen     = 2000
	backfillDays     = 30
)

// GitWatcher watches .git/ for repository events.
type GitWatcher struct {
	projectDir string
	logger     CaptureSourceLogger
	watcher    *fsnotify.Watcher
	eventCh    chan<- CaptureEvent
	done       chan struct{}
	wg         sync.WaitGroup

	// Track state for deduplication.
	lastCommitHash string
	lastHEADRef    string
}

// NewGitWatcher creates a git watcher for the given project directory.
func NewGitWatcher(projectDir string, logger CaptureSourceLogger) *GitWatcher {
	return &GitWatcher{
		projectDir: projectDir,
		logger:     logger,
		done:       make(chan struct{}),
	}
}

func (g *GitWatcher) Name() string { return "git" }

func (g *GitWatcher) Start(eventCh chan<- CaptureEvent) error {
	gitDir := filepath.Join(g.projectDir, ".git")
	if _, err := os.Stat(gitDir); os.IsNotExist(err) {
		return fmt.Errorf("not a git repository: %s", g.projectDir)
	}

	w, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("create fsnotify watcher: %w", err)
	}
	g.watcher = w
	g.eventCh = eventCh

	// Watch .git/ directory and key subdirectories.
	watchPaths := []string{
		gitDir,
		filepath.Join(gitDir, "refs"),
		filepath.Join(gitDir, "refs", "heads"),
		filepath.Join(gitDir, "refs", "stash"),
	}

	for _, p := range watchPaths {
		if _, err := os.Stat(p); err == nil {
			if err := w.Add(p); err != nil {
				g.logger.Warn("failed to watch git path", map[string]any{"path": p, "error": err.Error()})
			}
		}
	}

	// Capture initial state.
	g.lastHEADRef = g.readHEADRef()
	g.lastCommitHash = g.getLatestCommitHash()

	g.wg.Add(1)
	go g.watchLoop()

	g.logger.Info("git watcher started", map[string]any{"project": g.projectDir})
	return nil
}

func (g *GitWatcher) Stop() {
	close(g.done)
	if g.watcher != nil {
		_ = g.watcher.Close()
	}
	g.wg.Wait()
	g.logger.Info("git watcher stopped")
}

func (g *GitWatcher) WatchedPaths() []string {
	return []string{filepath.Join(g.projectDir, ".git")}
}

func (g *GitWatcher) watchLoop() {
	defer g.wg.Done()

	var debounceTimer *time.Timer
	var debounceCh <-chan time.Time

	for {
		select {
		case <-g.done:
			if debounceTimer != nil {
				debounceTimer.Stop()
			}
			return

		case event, ok := <-g.watcher.Events:
			if !ok {
				return
			}

			// Filter for relevant events.
			if !g.isRelevantEvent(event) {
				continue
			}

			g.logger.Debug("git fs event", map[string]any{
				"name": event.Name,
				"op":   event.Op.String(),
			})

			// Debounce: reset the timer on each event.
			if debounceTimer != nil {
				debounceTimer.Stop()
			}
			debounceTimer = time.NewTimer(gitDebounceDelay)
			debounceCh = debounceTimer.C

		case <-debounceCh:
			debounceCh = nil
			g.processGitChange()

		case err, ok := <-g.watcher.Errors:
			if !ok {
				return
			}
			g.logger.Error("fsnotify error", map[string]any{"error": err.Error()})
		}
	}
}

func (g *GitWatcher) isRelevantEvent(event fsnotify.Event) bool {
	name := filepath.Base(event.Name)

	// HEAD changes = branch switches or commits.
	if name == "HEAD" {
		return true
	}

	// refs/heads/* changes = new commits pushed/created.
	if strings.Contains(event.Name, filepath.Join("refs", "heads")) {
		return true
	}

	// refs/stash changes.
	if strings.Contains(event.Name, "stash") {
		return true
	}

	// MERGE_HEAD or MERGE_MSG = merge conflict.
	if name == "MERGE_HEAD" || name == "MERGE_MSG" {
		return true
	}

	return false
}

func (g *GitWatcher) processGitChange() {
	currentHEADRef := g.readHEADRef()
	currentCommitHash := g.getLatestCommitHash()

	// Branch switch detection.
	if currentHEADRef != g.lastHEADRef && g.lastHEADRef != "" {
		g.emitBranchSwitch(g.lastHEADRef, currentHEADRef)
		g.lastHEADRef = currentHEADRef
	} else {
		g.lastHEADRef = currentHEADRef
	}

	// Merge conflict detection.
	mergeHead := filepath.Join(g.projectDir, ".git", "MERGE_HEAD")
	if _, err := os.Stat(mergeHead); err == nil {
		g.emitMergeConflict()
	}

	// New commit detection.
	if currentCommitHash != g.lastCommitHash && currentCommitHash != "" {
		g.emitLatestCommit(currentCommitHash)
		g.lastCommitHash = currentCommitHash
	}

	// Stash detection.
	stashRef := filepath.Join(g.projectDir, ".git", "refs", "stash")
	if info, err := os.Stat(stashRef); err == nil {
		// If the stash file was very recently modified, emit a stash event.
		if time.Since(info.ModTime()) < 2*time.Second {
			g.emitStash()
		}
	}
}

func (g *GitWatcher) emitLatestCommit(hash string) {
	output := g.gitExec("log", "-1", fmt.Sprintf("--format=%s", gitLogFormat), hash)
	if output == "" {
		return
	}

	parts := strings.SplitN(output, "|", 5)
	if len(parts) < 5 {
		g.logger.Warn("unexpected git log format", map[string]any{"output": output})
		return
	}

	commitHash := parts[0]
	subject := parts[1]
	// parts[2] = author name, parts[3] = author email
	timestamp := parts[4]

	// Detect revert from commit message.
	eventType := "commit"
	if strings.HasPrefix(subject, "Revert ") {
		eventType = "revert"
	}

	// Get changed files.
	filesOutput := g.gitExec("diff-tree", "--no-commit-id", "--name-only", "-r", commitHash)
	files := FilterBlankStrings(strings.Split(filesOutput, "\n"))
	files = FormatFilesChanged(files)

	// Get diff stat for detail.
	detail := g.gitExec("diff-tree", "--stat", "--no-commit-id", commitHash)
	detail = TruncateDetail(detail, maxDetailLen)

	branch := g.currentBranch()
	repoName := filepath.Base(g.projectDir)

	event := CaptureEvent{
		ID:        uuid.New().String(),
		Timestamp: normalizeTimestamp(timestamp),
		Source:    "git",
		Type:      eventType,
		Content: EventContent{
			Summary: subject,
			Detail:  detail,
			Files:   files,
			Branch:  branch,
			Project: repoName,
		},
		GitContext: &GitContext{
			Repo:       repoName,
			Branch:     branch,
			CommitHash: commitHash,
		},
	}

	g.emit(event)
}

func (g *GitWatcher) emitBranchSwitch(from, to string) {
	repoName := filepath.Base(g.projectDir)
	event := CaptureEvent{
		ID:        uuid.New().String(),
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Source:    "git",
		Type:      "branch-switch",
		Content: EventContent{
			Summary: fmt.Sprintf("Switched branch: %s → %s", branchName(from), branchName(to)),
			Branch:  branchName(to),
			Project: repoName,
		},
		GitContext: &GitContext{
			Repo:   repoName,
			Branch: branchName(to),
		},
	}
	g.emit(event)
}

func (g *GitWatcher) emitMergeConflict() {
	repoName := filepath.Base(g.projectDir)
	branch := g.currentBranch()
	event := CaptureEvent{
		ID:        uuid.New().String(),
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Source:    "git",
		Type:      "merge-conflict",
		Content: EventContent{
			Summary: fmt.Sprintf("Merge conflict on branch %s", branch),
			Branch:  branch,
			Project: repoName,
		},
		GitContext: &GitContext{
			Repo:   repoName,
			Branch: branch,
		},
	}
	g.emit(event)
}

func (g *GitWatcher) emitStash() {
	repoName := filepath.Base(g.projectDir)
	branch := g.currentBranch()
	event := CaptureEvent{
		ID:        uuid.New().String(),
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Source:    "git",
		Type:      "stash",
		Content: EventContent{
			Summary: fmt.Sprintf("Stashed changes on %s", branch),
			Branch:  branch,
			Project: repoName,
		},
		GitContext: &GitContext{
			Repo:   repoName,
			Branch: branch,
		},
	}
	g.emit(event)
}

func (g *GitWatcher) emit(event CaptureEvent) {
	select {
	case g.eventCh <- event:
		g.logger.Debug("git event emitted", map[string]any{
			"type":    event.Type,
			"summary": event.Content.Summary,
		})
	case <-g.done:
		// Shutting down, discard.
	}
}

// Backfill walks git log since the given time and emits events for each commit.
// Blocks until complete. Events are sent on eventCh.
func (g *GitWatcher) Backfill(since time.Time, eventCh chan<- CaptureEvent) (int, error) {
	sinceStr := since.Format("2006-01-02")
	repoName := filepath.Base(g.projectDir)

	output := g.gitExec("log", "--format="+gitLogFormat, "--after="+sinceStr, "--reverse")
	if output == "" {
		g.logger.Info("backfill: no commits found", map[string]any{"since": sinceStr})
		return 0, nil
	}

	lines := strings.Split(strings.TrimSpace(output), "\n")
	count := 0

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		parts := strings.SplitN(line, "|", 5)
		if len(parts) < 5 {
			continue
		}

		commitHash := parts[0]
		subject := parts[1]
		timestamp := parts[4]

		eventType := "commit"
		if strings.HasPrefix(subject, "Revert ") {
			eventType = "revert"
		}

		// Get changed files for this commit.
		filesOutput := g.gitExec("diff-tree", "--no-commit-id", "--name-only", "-r", commitHash)
		files := FilterBlankStrings(strings.Split(filesOutput, "\n"))
		files = FormatFilesChanged(files)

		// Get diff stat.
		detail := g.gitExec("diff-tree", "--stat", "--no-commit-id", commitHash)
		detail = TruncateDetail(detail, maxDetailLen)

		// Determine the branch at commit time (best effort — use current branch).
		branch := g.currentBranch()

		event := CaptureEvent{
			ID:        uuid.New().String(),
			Timestamp: normalizeTimestamp(timestamp),
			Source:    "git",
			Type:      eventType,
			Content: EventContent{
				Summary: subject,
				Detail:  detail,
				Files:   files,
				Branch:  branch,
				Project: repoName,
			},
			GitContext: &GitContext{
				Repo:       repoName,
				Branch:     branch,
				CommitHash: commitHash,
			},
			Metadata: map[string]any{
				"backfill": true,
			},
		}

		select {
		case eventCh <- event:
			count++
		case <-g.done:
			return count, fmt.Errorf("backfill interrupted")
		}
	}

	g.logger.Info("backfill complete", map[string]any{"commits": count, "since": sinceStr})
	return count, nil
}

// --- Helper methods ---

func (g *GitWatcher) gitExec(args ...string) string {
	cmd := exec.Command("git", args...)
	cmd.Dir = g.projectDir
	out, err := cmd.Output()
	if err != nil {
		g.logger.Debug("git command failed", map[string]any{
			"args":  strings.Join(args, " "),
			"error": err.Error(),
		})
		return ""
	}
	return strings.TrimSpace(string(out))
}

func (g *GitWatcher) readHEADRef() string {
	headPath := filepath.Join(g.projectDir, ".git", "HEAD")
	data, err := os.ReadFile(headPath)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

func (g *GitWatcher) getLatestCommitHash() string {
	return g.gitExec("rev-parse", "HEAD")
}

func (g *GitWatcher) currentBranch() string {
	branch := g.gitExec("rev-parse", "--abbrev-ref", "HEAD")
	if branch == "" || branch == "HEAD" {
		return "detached"
	}
	return branch
}

// branchName extracts the branch name from a HEAD ref string.
// "ref: refs/heads/main" → "main", anything else passes through.
func branchName(headRef string) string {
	const prefix = "ref: refs/heads/"
	if strings.HasPrefix(headRef, prefix) {
		return strings.TrimPrefix(headRef, prefix)
	}
	return headRef
}

// normalizeTimestamp converts a git timestamp to RFC3339.
func normalizeTimestamp(ts string) string {
	// Git --format=%aI produces RFC3339-like timestamps.
	t, err := time.Parse(time.RFC3339, ts)
	if err != nil {
		// Try common git date format.
		t, err = time.Parse("2006-01-02T15:04:05-07:00", ts)
		if err != nil {
			return time.Now().UTC().Format(time.RFC3339)
		}
	}
	return t.Format(time.RFC3339)
}
