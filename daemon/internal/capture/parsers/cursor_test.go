package parsers

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestCursorParserName(t *testing.T) {
	p := NewCursorParser("/fake/home")
	if p.Name() != "cursor" {
		t.Errorf("Name() = %q, want cursor", p.Name())
	}
}

func TestCursorDiscoverMissingDB(t *testing.T) {
	p := NewCursorParser("/nonexistent/path")
	sources := p.Discover()
	if len(sources) != 0 {
		t.Errorf("expected 0 sources for missing DB, got %d", len(sources))
	}
}

func TestCursorDiscoverFindsDB(t *testing.T) {
	home := t.TempDir()
	dbDir := filepath.Join(home, ".cursor", "ai-tracking")
	if err := os.MkdirAll(dbDir, 0o755); err != nil {
		t.Fatal(err)
	}
	dbPath := filepath.Join(dbDir, "ai-code-tracking.db")
	// Create an empty file to simulate the DB existence.
	if err := os.WriteFile(dbPath, []byte{}, 0o644); err != nil {
		t.Fatal(err)
	}

	p := NewCursorParser(home)
	sources := p.Discover()
	if len(sources) != 1 {
		t.Fatalf("expected 1 source, got %d", len(sources))
	}
	if sources[0].Tool != "cursor" {
		t.Errorf("tool = %q, want cursor", sources[0].Tool)
	}
	if sources[0].Format != "sqlite" {
		t.Errorf("format = %q, want sqlite", sources[0].Format)
	}
}

func TestCursorParseConversationSummaries(t *testing.T) {
	dbPath := createTestCursorDB(t)

	p := NewCursorParser("/fake/home")
	turns, err := p.Parse(DataSource{
		Tool:   "cursor",
		Path:   dbPath,
		Format: "sqlite",
	}, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}

	// Should find conversation summaries and scored commits.
	summaries := 0
	commits := 0
	for _, turn := range turns {
		switch turn.Role {
		case "summary":
			summaries++
		case "commit":
			commits++
		}
	}

	if summaries != 2 {
		t.Errorf("expected 2 conversation summaries, got %d", summaries)
	}
	if commits != 2 {
		t.Errorf("expected 2 scored commits, got %d", commits)
	}
}

func TestCursorParseScoredCommitsAIPercentage(t *testing.T) {
	dbPath := createTestCursorDB(t)

	p := NewCursorParser("/fake/home")
	turns, err := p.Parse(DataSource{
		Tool:   "cursor",
		Path:   dbPath,
		Format: "sqlite",
	}, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}

	for _, turn := range turns {
		if turn.Role != "commit" {
			continue
		}
		pct, ok := turn.Metadata["v2_ai_percentage"].(float64)
		if !ok {
			t.Error("expected v2_ai_percentage in metadata")
			continue
		}
		if pct < 0 || pct > 100 {
			t.Errorf("v2_ai_percentage %f out of range", pct)
		}

		humanAdded, ok := turn.Metadata["human_lines_added"].(int)
		if !ok {
			t.Error("expected human_lines_added in metadata")
			continue
		}
		if humanAdded < 0 {
			t.Error("human_lines_added should be non-negative")
		}
	}
}

func TestCursorParseSinceFilter(t *testing.T) {
	dbPath := createTestCursorDB(t)

	// Use a since date that filters out the first entries.
	since := time.Date(2026, 4, 16, 0, 0, 0, 0, time.UTC)
	p := NewCursorParser("/fake/home")
	turns, err := p.Parse(DataSource{
		Tool:   "cursor",
		Path:   dbPath,
		Format: "sqlite",
	}, since)
	if err != nil {
		t.Fatal(err)
	}

	for _, turn := range turns {
		if !turn.Timestamp.IsZero() && turn.Timestamp.Before(since) {
			t.Errorf("turn at %v should have been filtered by since=%v", turn.Timestamp, since)
		}
	}
}

func TestCursorParseMissingDB(t *testing.T) {
	p := NewCursorParser("/fake/home")
	turns, err := p.Parse(DataSource{
		Tool:   "cursor",
		Path:   "/nonexistent/db.sqlite",
		Format: "sqlite",
	}, time.Time{})
	if err != nil {
		t.Errorf("expected nil error for missing DB, got %v", err)
	}
	if turns != nil {
		t.Errorf("expected nil turns for missing DB, got %d", len(turns))
	}
}

func TestCursorTailReturnsNewRows(t *testing.T) {
	dbPath := createTestCursorDB(t)

	p := NewCursorParser("/fake/home")
	ds := DataSource{Tool: "cursor", Path: dbPath, Format: "sqlite"}

	// First tail from offset 0.
	turns1, offset1, err := p.Tail(ds, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(turns1) == 0 {
		t.Error("expected turns from first tail")
	}
	if offset1 == 0 {
		t.Error("expected non-zero offset after first tail")
	}

	// Tail again — no new data.
	turns2, offset2, err := p.Tail(ds, offset1)
	if err != nil {
		t.Fatal(err)
	}
	if len(turns2) != 0 {
		t.Errorf("expected 0 new turns, got %d", len(turns2))
	}
	if offset2 != offset1 {
		t.Errorf("offset should be unchanged: %d vs %d", offset2, offset1)
	}
}

func TestCursorParseMissingTables(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "empty.db")

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()

	p := NewCursorParser("/fake/home")
	turns, err := p.Parse(DataSource{
		Tool:   "cursor",
		Path:   dbPath,
		Format: "sqlite",
	}, time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	if len(turns) != 0 {
		t.Errorf("expected 0 turns from empty DB, got %d", len(turns))
	}
}

func TestCursorScoredCommitsGetUniqueConversationIDs(t *testing.T) {
	dbPath := createTestCursorDB(t)

	p := NewCursorParser("/fake/home")
	turns, err := p.Parse(DataSource{
		Tool:   "cursor",
		Path:   dbPath,
		Format: "sqlite",
	}, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}

	// Each scored commit should produce a turn with a unique ConversationID
	// keyed by commit hash, not branch name. This prevents all commits on
	// the same branch from collapsing into a single CaptureEvent.
	seenIDs := make(map[string]bool)
	for _, turn := range turns {
		if turn.Role != "commit" {
			continue
		}
		if seenIDs[turn.ConversationID] {
			t.Errorf("duplicate ConversationID %q — commits should have unique IDs", turn.ConversationID)
		}
		seenIDs[turn.ConversationID] = true

		hash := turn.Metadata["commit_hash"].(string)
		expected := "commit-" + hash
		if turn.ConversationID != expected {
			t.Errorf("ConversationID = %q, want %q", turn.ConversationID, expected)
		}
	}

	if len(seenIDs) != 2 {
		t.Errorf("expected 2 unique commit ConversationIDs, got %d", len(seenIDs))
	}
}

func TestCursorGitFormatTimestamps(t *testing.T) {
	dbPath := createTestCursorDBWithGitDates(t)

	p := NewCursorParser("/fake/home")
	turns, err := p.Parse(DataSource{
		Tool:   "cursor",
		Path:   dbPath,
		Format: "sqlite",
	}, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}

	commits := 0
	for _, turn := range turns {
		if turn.Role != "commit" {
			continue
		}
		commits++
		if turn.Timestamp.IsZero() {
			t.Errorf("commit %q has zero timestamp — git-format date not parsed",
				turn.Metadata["commit_hash"])
		}
	}

	if commits != 2 {
		t.Errorf("expected 2 commits, got %d", commits)
	}
}

// createTestCursorDBWithGitDates creates a fixture DB using git-style date
// format ("Mon Jan 2 15:04:05 2006 -0700") as Cursor actually stores them.
func createTestCursorDBWithGitDates(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "ai-code-tracking.db")

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	stmts := []string{
		`CREATE TABLE conversation_summaries (
			conversationId TEXT PRIMARY KEY,
			title TEXT, tldr TEXT, overview TEXT, summaryBullets TEXT,
			model TEXT, mode TEXT, updatedAt TEXT
		)`,
		`CREATE TABLE scored_commits (
			commitHash TEXT PRIMARY KEY,
			branchName TEXT,
			linesAdded INTEGER, linesDeleted INTEGER,
			tabLinesAdded INTEGER, tabLinesDeleted INTEGER,
			composerLinesAdded INTEGER, composerLinesDeleted INTEGER,
			humanLinesAdded INTEGER, humanLinesDeleted INTEGER,
			v1AiPercentage REAL, v2AiPercentage REAL,
			commitMessage TEXT, commitDate TEXT
		)`,
		`INSERT INTO scored_commits VALUES
			('aaa111', 'main', 50, 10, 5, 1, 20, 5, 25, 4, 50.0, 55.0, 'Fix login', 'Wed Mar 4 14:52:36 2026 +0530'),
			('bbb222', 'main', 30, 5, 3, 0, 10, 2, 17, 3, 40.0, 43.0, 'Add tests', 'Tue Feb 17 02:20:44 2026 +0530')`,
	}

	for _, stmt := range stmts {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("exec %q: %v", stmt[:40], err)
		}
	}
	return dbPath
}

// createTestCursorDB creates a SQLite database matching Cursor's schema
// with fixture data.
func createTestCursorDB(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "ai-code-tracking.db")

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	stmts := []string{
		`CREATE TABLE conversation_summaries (
			conversationId TEXT PRIMARY KEY,
			title TEXT,
			tldr TEXT,
			overview TEXT,
			summaryBullets TEXT,
			model TEXT,
			mode TEXT,
			updatedAt TEXT
		)`,
		`CREATE TABLE scored_commits (
			commitHash TEXT PRIMARY KEY,
			branchName TEXT,
			linesAdded INTEGER,
			linesDeleted INTEGER,
			tabLinesAdded INTEGER,
			tabLinesDeleted INTEGER,
			composerLinesAdded INTEGER,
			composerLinesDeleted INTEGER,
			humanLinesAdded INTEGER,
			humanLinesDeleted INTEGER,
			v1AiPercentage REAL,
			v2AiPercentage REAL,
			commitMessage TEXT,
			commitDate TEXT
		)`,
		`INSERT INTO conversation_summaries VALUES
			('conv-001', 'Refactor Auth', 'Refactored auth to use DI', 'Comprehensive auth refactor with dependency injection', 'DI over singletons;Test isolation', 'gpt-4o', 'agent', '2026-04-17T10:00:00Z'),
			('conv-002', 'Add Rate Limiting', 'Added in-memory rate limiter', 'Implemented token bucket rate limiting', 'In-memory;No Redis dependency', 'claude-sonnet', 'chat', '2026-04-17T11:00:00Z')`,
		`INSERT INTO scored_commits VALUES
			('abc123', 'feature/auth', 120, 30, 20, 5, 50, 10, 50, 15, 58.3, 62.5, 'Refactor auth module to use DI', '2026-04-17T12:00:00Z'),
			('def456', 'main', 45, 10, 10, 2, 5, 0, 30, 8, 33.3, 27.3, 'Add rate limiting to login endpoint', '2026-04-17T13:00:00Z')`,
	}

	for _, stmt := range stmts {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("exec %q: %v", stmt[:50], err)
		}
	}

	return dbPath
}
