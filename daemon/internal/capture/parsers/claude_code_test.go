package parsers

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestClaudeCodeParserName(t *testing.T) {
	p := NewClaudeCodeParser("/fake/home")
	if p.Name() != "claude-code" {
		t.Errorf("Name() = %q, want claude-code", p.Name())
	}
}

func TestClaudeCodeDiscoverMissingDirectory(t *testing.T) {
	p := NewClaudeCodeParser("/nonexistent/path")
	sources := p.Discover()
	if len(sources) != 0 {
		t.Errorf("expected 0 sources for missing dir, got %d", len(sources))
	}
}

func TestClaudeCodeDiscoverFindsJSONL(t *testing.T) {
	home := t.TempDir()
	projectDir := filepath.Join(home, ".claude", "projects", "-Users-dev-myproject")
	if err := os.MkdirAll(projectDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(projectDir, "session-001.jsonl"), []byte(`{}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(projectDir, "session-002.jsonl"), []byte(`{}`), 0o644); err != nil {
		t.Fatal(err)
	}

	p := NewClaudeCodeParser(home)
	sources := p.Discover()
	if len(sources) != 2 {
		t.Fatalf("expected 2 sources, got %d", len(sources))
	}
	for _, s := range sources {
		if s.Tool != "claude-code" {
			t.Errorf("tool = %q, want claude-code", s.Tool)
		}
		if s.Format != "jsonl" {
			t.Errorf("format = %q, want jsonl", s.Format)
		}
	}
}

func TestClaudeCodeParseConversationTree(t *testing.T) {
	fixture := fixtureDir(t, "claude_code", "session1.jsonl")

	p := NewClaudeCodeParser("/fake/home")
	turns, err := p.Parse(DataSource{
		Tool:    "claude-code",
		Path:    fixture,
		Format:  "jsonl",
		Project: "/Users/dev/project",
	}, time.Time{})
	if err != nil {
		t.Fatal(err)
	}

	// Fixture has 6 user/assistant entries on the main chain + 1 sidechain.
	// permission-mode and file-history-snapshot are skipped.
	if len(turns) < 6 {
		t.Fatalf("expected at least 6 turns, got %d", len(turns))
	}

	// Verify all turns have sessionId populated.
	for _, turn := range turns {
		if turn.SessionID == "" {
			t.Error("expected non-empty SessionID")
		}
	}

	// Verify roles are correctly normalized.
	roleCount := map[string]int{}
	for _, turn := range turns {
		roleCount[turn.Role]++
	}
	if roleCount["user"] < 3 {
		t.Errorf("expected at least 3 user turns, got %d", roleCount["user"])
	}
	if roleCount["assistant"] < 3 {
		t.Errorf("expected at least 3 assistant turns, got %d", roleCount["assistant"])
	}

	// Verify tool_use extraction from the assistant response.
	foundToolUse := false
	for _, turn := range turns {
		if len(turn.ToolUse) > 0 {
			foundToolUse = true
			if turn.ToolUse[0].Name != "write_file" {
				t.Errorf("tool name = %q, want write_file", turn.ToolUse[0].Name)
			}
		}
	}
	if !foundToolUse {
		t.Error("expected at least one turn with tool_use")
	}
}

func TestClaudeCodeParseSkipsPermissionAndSnapshot(t *testing.T) {
	fixture := fixtureDir(t, "claude_code", "session1.jsonl")

	p := NewClaudeCodeParser("/fake/home")
	turns, err := p.Parse(DataSource{
		Tool: "claude-code",
		Path: fixture,
	}, time.Time{})
	if err != nil {
		t.Fatal(err)
	}

	for _, turn := range turns {
		if turn.Role == "system" && (turn.Content == "auto-accept" || turn.Content == "snapshot data") {
			t.Error("permission-mode and file-history-snapshot should be skipped")
		}
	}
}

func TestClaudeCodeParseSinceFiltersOldEntries(t *testing.T) {
	fixture := fixtureDir(t, "claude_code", "session1.jsonl")

	since := time.Date(2026, 4, 17, 10, 3, 0, 0, time.UTC)
	p := NewClaudeCodeParser("/fake/home")
	turns, err := p.Parse(DataSource{
		Tool: "claude-code",
		Path: fixture,
	}, since)
	if err != nil {
		t.Fatal(err)
	}

	for _, turn := range turns {
		if !turn.Timestamp.IsZero() && turn.Timestamp.Before(since) {
			t.Errorf("turn at %v should have been filtered (since %v)", turn.Timestamp, since)
		}
	}
}

func TestClaudeCodeParseMissingFile(t *testing.T) {
	p := NewClaudeCodeParser("/fake/home")
	turns, err := p.Parse(DataSource{
		Tool: "claude-code",
		Path: "/nonexistent/session.jsonl",
	}, time.Time{})
	if err != nil {
		t.Errorf("expected nil error for missing file, got %v", err)
	}
	if turns != nil {
		t.Errorf("expected nil turns for missing file, got %d", len(turns))
	}
}

func TestClaudeCodeParseCorruptedLines(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "corrupt.jsonl")
	content := `not valid json
{"uuid":"a","parentUuid":"","type":"user","message":{"role":"user","content":"valid entry"},"timestamp":"2026-04-17T10:00:00.000Z","sessionId":"s","cwd":"/tmp","gitBranch":"main","isSidechain":false}
also not valid {{{
`
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}

	p := NewClaudeCodeParser("/fake/home")
	turns, err := p.Parse(DataSource{
		Tool: "claude-code",
		Path: path,
	}, time.Time{})
	if err != nil {
		t.Fatal(err)
	}

	if len(turns) != 1 {
		t.Errorf("expected 1 valid turn (skipping corrupted), got %d", len(turns))
	}
}

func TestClaudeCodeTail(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "session.jsonl")

	// Write initial entries.
	entries := []map[string]any{
		{"uuid": "a", "parentUuid": "", "type": "user", "message": map[string]any{"role": "user", "content": "first"}, "timestamp": "2026-04-17T10:00:00.000Z", "sessionId": "s1", "cwd": "/tmp", "gitBranch": "main", "isSidechain": false},
		{"uuid": "b", "parentUuid": "a", "type": "assistant", "message": map[string]any{"role": "assistant", "content": []any{map[string]any{"type": "text", "text": "response"}}}, "timestamp": "2026-04-17T10:01:00.000Z", "sessionId": "s1", "cwd": "/tmp", "gitBranch": "main", "isSidechain": false},
	}
	writeJSONL(t, path, entries)

	p := NewClaudeCodeParser("/fake/home")
	ds := DataSource{Tool: "claude-code", Path: path}

	// First tail from offset 0.
	turns1, offset1, err := p.Tail(ds, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(turns1) != 2 {
		t.Errorf("first tail: expected 2 turns, got %d", len(turns1))
	}
	if offset1 == 0 {
		t.Error("expected non-zero offset after first tail")
	}

	// Tail again from offset — no new data.
	turns2, offset2, err := p.Tail(ds, offset1)
	if err != nil {
		t.Fatal(err)
	}
	if len(turns2) != 0 {
		t.Errorf("second tail: expected 0 turns, got %d", len(turns2))
	}
	if offset2 != offset1 {
		t.Errorf("offset should not change without new data: %d vs %d", offset2, offset1)
	}

	// Append new data and tail again.
	appendJSONL(t, path, []map[string]any{
		{"uuid": "c", "parentUuid": "b", "type": "user", "message": map[string]any{"role": "user", "content": "follow up"}, "timestamp": "2026-04-17T10:02:00.000Z", "sessionId": "s1", "cwd": "/tmp", "gitBranch": "main", "isSidechain": false},
	})

	turns3, offset3, err := p.Tail(ds, offset1)
	if err != nil {
		t.Fatal(err)
	}
	if len(turns3) != 1 {
		t.Errorf("third tail: expected 1 new turn, got %d", len(turns3))
	}
	if offset3 <= offset1 {
		t.Error("offset should have advanced")
	}
}

func TestClaudeCodeConversationTreeStructure(t *testing.T) {
	fixture := fixtureDir(t, "claude_code", "session1.jsonl")

	p := NewClaudeCodeParser("/fake/home")
	turns, err := p.Parse(DataSource{
		Tool: "claude-code",
		Path: fixture,
	}, time.Time{})
	if err != nil {
		t.Fatal(err)
	}

	// Main chain should have sequential turn indices.
	mainTurns := filterByConvID(turns, "sess-abc")
	for i, turn := range mainTurns {
		if turn.TurnIndex != i {
			t.Errorf("main chain turn %d: TurnIndex = %d, want %d", i, turn.TurnIndex, i)
		}
	}
}

func TestProjectPathFromMangled(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"-Users-dev-myproject", "/Users/dev/myproject"},
		{"", ""},
	}
	for _, tt := range tests {
		got := projectPathFromMangled(tt.input)
		if got != tt.want {
			t.Errorf("projectPathFromMangled(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestParseTimestamp(t *testing.T) {
	tests := []struct {
		input string
		zero  bool
	}{
		{"2026-04-17T10:00:00.000Z", false},
		{"2026-04-17T10:00:00Z", false},
		// Git-style timestamps used by Cursor's scored_commits table
		{"Wed Mar 4 14:52:36 2026 +0530", false},
		{"Tue Feb 17 02:20:44 2026 +0530", false},
		{"invalid", true},
		{"", true},
	}
	for _, tt := range tests {
		ts := parseTimestamp(tt.input)
		if tt.zero && !ts.IsZero() {
			t.Errorf("parseTimestamp(%q) should be zero", tt.input)
		}
		if !tt.zero && ts.IsZero() {
			t.Errorf("parseTimestamp(%q) should not be zero", tt.input)
		}
	}
}

// --- helpers ---

func fixtureDir(t *testing.T, parts ...string) string {
	t.Helper()
	elems := append([]string{"testdata"}, parts...)
	return filepath.Join(elems...)
}

func writeJSONL(t *testing.T, path string, entries []map[string]any) {
	t.Helper()
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	for _, entry := range entries {
		data, _ := json.Marshal(entry)
		f.Write(data)
		f.WriteString("\n")
	}
}

func appendJSONL(t *testing.T, path string, entries []map[string]any) {
	t.Helper()
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	for _, entry := range entries {
		data, _ := json.Marshal(entry)
		f.Write(data)
		f.WriteString("\n")
	}
}

func filterByConvID(turns []ConversationTurn, convID string) []ConversationTurn {
	var out []ConversationTurn
	for _, t := range turns {
		if t.ConversationID == convID {
			out = append(out, t)
		}
	}
	return out
}
