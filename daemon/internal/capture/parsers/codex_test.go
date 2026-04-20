package parsers

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestCodexParserName(t *testing.T) {
	p := NewCodexParser("/fake/home")
	if p.Name() != "codex" {
		t.Errorf("Name() = %q, want codex", p.Name())
	}
}

func TestCodexDiscoverMissingDirectory(t *testing.T) {
	p := NewCodexParser("/nonexistent/path")
	sources := p.Discover()
	if len(sources) != 0 {
		t.Errorf("expected 0 sources for missing dir, got %d", len(sources))
	}
}

func TestCodexDiscoverFindsJSONL(t *testing.T) {
	home := t.TempDir()
	sessDir := filepath.Join(home, ".codex", "sessions", "2026", "04", "17")
	if err := os.MkdirAll(sessDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sessDir, "rollout-001.jsonl"), []byte(`{}`), 0o644); err != nil {
		t.Fatal(err)
	}

	p := NewCodexParser(home)
	sources := p.Discover()
	if len(sources) != 1 {
		t.Fatalf("expected 1 source, got %d", len(sources))
	}
	if sources[0].Tool != "codex" {
		t.Errorf("tool = %q, want codex", sources[0].Tool)
	}
}

func TestCodexParseConversationTurns(t *testing.T) {
	fixture := fixtureDir(t, "codex", "session1.jsonl")

	p := NewCodexParser("/fake/home")
	turns, err := p.Parse(DataSource{
		Tool:   "codex",
		Path:   fixture,
		Format: "jsonl",
	}, time.Time{})
	if err != nil {
		t.Fatal(err)
	}

	// Fixture has 4 response_items (2 user, 2 assistant); session_meta and event_msg are not turns.
	if len(turns) != 4 {
		t.Fatalf("expected 4 turns, got %d", len(turns))
	}

	// Verify session metadata is propagated.
	for _, turn := range turns {
		if turn.SessionID != "codex-sess-001" {
			t.Errorf("SessionID = %q, want codex-sess-001", turn.SessionID)
		}
		if turn.GitBranch != "feature/auth" {
			t.Errorf("GitBranch = %q, want feature/auth", turn.GitBranch)
		}
		if turn.ProjectPath != "/Users/dev/api" {
			t.Errorf("ProjectPath = %q, want /Users/dev/api", turn.ProjectPath)
		}
	}

	// Verify role alternation.
	expectedRoles := []string{"user", "assistant", "user", "assistant"}
	for i, turn := range turns {
		if turn.Role != expectedRoles[i] {
			t.Errorf("turn %d: role = %q, want %q", i, turn.Role, expectedRoles[i])
		}
	}

	// Verify TurnIndex and TotalTurns.
	for i, turn := range turns {
		if turn.TurnIndex != i {
			t.Errorf("turn %d: TurnIndex = %d, want %d", i, turn.TurnIndex, i)
		}
		if turn.TotalTurns != 4 {
			t.Errorf("turn %d: TotalTurns = %d, want 4", i, turn.TotalTurns)
		}
	}
}

func TestCodexParseExtractsGitContext(t *testing.T) {
	fixture := fixtureDir(t, "codex", "session1.jsonl")

	p := NewCodexParser("/fake/home")
	turns, err := p.Parse(DataSource{
		Tool:   "codex",
		Path:   fixture,
		Format: "jsonl",
	}, time.Time{})
	if err != nil {
		t.Fatal(err)
	}

	if len(turns) == 0 {
		t.Fatal("expected turns")
	}

	first := turns[0]
	commitHash, _ := first.Metadata["commit_hash"].(string)
	if commitHash != "abc123" {
		t.Errorf("commit_hash = %q, want abc123", commitHash)
	}

	repoURL, _ := first.Metadata["repository_url"].(string)
	if repoURL != "https://github.com/dev/api" {
		t.Errorf("repository_url = %q, want https://github.com/dev/api", repoURL)
	}
}

func TestCodexParseSinceFilter(t *testing.T) {
	fixture := fixtureDir(t, "codex", "session1.jsonl")

	since := time.Date(2026, 4, 17, 11, 3, 0, 0, time.UTC)
	p := NewCodexParser("/fake/home")
	turns, err := p.Parse(DataSource{
		Tool: "codex",
		Path: fixture,
	}, since)
	if err != nil {
		t.Fatal(err)
	}

	// Only entries at 11:03 and 11:04 should pass the filter.
	if len(turns) != 2 {
		t.Errorf("expected 2 turns after since filter, got %d", len(turns))
	}
}

func TestCodexParseMissingFile(t *testing.T) {
	p := NewCodexParser("/fake/home")
	turns, err := p.Parse(DataSource{
		Tool: "codex",
		Path: "/nonexistent/session.jsonl",
	}, time.Time{})
	if err != nil {
		t.Errorf("expected nil error for missing file, got %v", err)
	}
	if turns != nil {
		t.Errorf("expected nil turns for missing file, got %d", len(turns))
	}
}

func TestCodexTail(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "session.jsonl")

	initial := `{"type":"session_meta","timestamp":"2026-04-17T11:00:00.000Z","payload":{"id":"s1","cwd":"/tmp","cli_version":"0.5","model_provider":"openai","git":{"commit_hash":"","branch":"main","repository_url":""}}}
{"type":"response_item","timestamp":"2026-04-17T11:01:00.000Z","payload":{"role":"user","content":[{"type":"text","text":"hello"}]}}
`
	if err := os.WriteFile(path, []byte(initial), 0o644); err != nil {
		t.Fatal(err)
	}

	p := NewCodexParser("/fake/home")
	ds := DataSource{Tool: "codex", Path: path, Format: "jsonl"}

	turns1, offset1, err := p.Tail(ds, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(turns1) != 1 {
		t.Errorf("expected 1 turn, got %d", len(turns1))
	}

	// Append more data.
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	f.WriteString(`{"type":"response_item","timestamp":"2026-04-17T11:02:00.000Z","payload":{"role":"assistant","content":[{"type":"text","text":"hi there"}]}}` + "\n")
	f.Close()

	turns2, offset2, err := p.Tail(ds, offset1)
	if err != nil {
		t.Fatal(err)
	}
	if len(turns2) != 1 {
		t.Errorf("expected 1 new turn, got %d", len(turns2))
	}
	if offset2 <= offset1 {
		t.Error("offset should advance")
	}
}
