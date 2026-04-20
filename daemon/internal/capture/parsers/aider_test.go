package parsers

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestAiderParserName(t *testing.T) {
	p := NewAiderParser(nil)
	if p.Name() != "aider" {
		t.Errorf("Name() = %q, want aider", p.Name())
	}
}

func TestAiderDiscoverMissingFiles(t *testing.T) {
	p := NewAiderParser([]string{"/nonexistent/project"})
	sources := p.Discover()
	if len(sources) != 0 {
		t.Errorf("expected 0 sources, got %d", len(sources))
	}
}

func TestAiderDiscoverFindsHistory(t *testing.T) {
	dir := t.TempDir()
	histPath := filepath.Join(dir, ".aider.chat.history.md")
	if err := os.WriteFile(histPath, []byte("#### test"), 0o644); err != nil {
		t.Fatal(err)
	}

	p := NewAiderParser([]string{dir})
	sources := p.Discover()
	if len(sources) != 1 {
		t.Fatalf("expected 1 source, got %d", len(sources))
	}
	if sources[0].Tool != "aider" {
		t.Errorf("tool = %q, want aider", sources[0].Tool)
	}
	if sources[0].Format != "markdown" {
		t.Errorf("format = %q, want markdown", sources[0].Format)
	}
	if sources[0].Project != dir {
		t.Errorf("project = %q, want %q", sources[0].Project, dir)
	}
}

func TestAiderParseUserAssistantTurns(t *testing.T) {
	fixture := fixtureDir(t, "aider", ".aider.chat.history.md")

	p := NewAiderParser(nil)
	turns, err := p.Parse(DataSource{
		Tool:    "aider",
		Path:    fixture,
		Format:  "markdown",
		Project: "/Users/dev/project",
	}, time.Time{})
	if err != nil {
		t.Fatal(err)
	}

	if len(turns) == 0 {
		t.Fatal("expected turns from aider history")
	}

	// Count roles.
	users := 0
	assistants := 0
	for _, turn := range turns {
		switch turn.Role {
		case "user":
			users++
		case "assistant":
			assistants++
		}
	}

	// Fixture has 3 user prompts and 3 assistant responses.
	if users != 3 {
		t.Errorf("expected 3 user turns, got %d", users)
	}
	if assistants != 3 {
		t.Errorf("expected 3 assistant turns, got %d", assistants)
	}
}

func TestAiderParseUserContent(t *testing.T) {
	fixture := fixtureDir(t, "aider", ".aider.chat.history.md")

	p := NewAiderParser(nil)
	turns, err := p.Parse(DataSource{
		Tool:    "aider",
		Path:    fixture,
		Format:  "markdown",
		Project: "/Users/dev/project",
	}, time.Time{})
	if err != nil {
		t.Fatal(err)
	}

	// First user turn should contain the prompt text.
	found := false
	for _, turn := range turns {
		if turn.Role == "user" && turn.Content == "Add error handling to the database connection pool" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected first user turn to contain 'Add error handling to the database connection pool'")
	}
}

func TestAiderParseProjectPath(t *testing.T) {
	fixture := fixtureDir(t, "aider", ".aider.chat.history.md")

	p := NewAiderParser(nil)
	turns, err := p.Parse(DataSource{
		Tool:    "aider",
		Path:    fixture,
		Format:  "markdown",
		Project: "/Users/dev/myproject",
	}, time.Time{})
	if err != nil {
		t.Fatal(err)
	}

	for _, turn := range turns {
		if turn.ProjectPath != "/Users/dev/myproject" {
			t.Errorf("ProjectPath = %q, want /Users/dev/myproject", turn.ProjectPath)
		}
	}
}

func TestAiderParseMissingFile(t *testing.T) {
	p := NewAiderParser(nil)
	turns, err := p.Parse(DataSource{
		Tool: "aider",
		Path: "/nonexistent/file.md",
	}, time.Time{})
	if err != nil {
		t.Errorf("expected nil error for missing file, got %v", err)
	}
	if turns != nil {
		t.Errorf("expected nil turns, got %d", len(turns))
	}
}

func TestAiderTail(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ".aider.chat.history.md")

	initial := "#### Fix the bug\n\nI'll fix the bug by updating the handler.\n"
	if err := os.WriteFile(path, []byte(initial), 0o644); err != nil {
		t.Fatal(err)
	}

	p := NewAiderParser(nil)
	ds := DataSource{Tool: "aider", Path: path, Format: "markdown", Project: dir}

	turns1, offset1, err := p.Tail(ds, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(turns1) != 2 {
		t.Errorf("expected 2 turns, got %d", len(turns1))
	}

	// Append more data.
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	f.WriteString("\n#### Add tests\n\nAdding comprehensive test coverage.\n")
	f.Close()

	turns2, offset2, err := p.Tail(ds, offset1)
	if err != nil {
		t.Fatal(err)
	}
	if len(turns2) < 1 {
		t.Errorf("expected at least 1 new turn, got %d", len(turns2))
	}
	if offset2 <= offset1 {
		t.Error("offset should advance")
	}
}

func TestAiderParseConversationGrouping(t *testing.T) {
	fixture := fixtureDir(t, "aider", ".aider.chat.history.md")

	p := NewAiderParser(nil)
	turns, err := p.Parse(DataSource{
		Tool:    "aider",
		Path:    fixture,
		Format:  "markdown",
		Project: "/Users/dev/project",
	}, time.Time{})
	if err != nil {
		t.Fatal(err)
	}

	// Each user+assistant pair should share a ConversationID.
	convIDs := make(map[string]int)
	for _, turn := range turns {
		convIDs[turn.ConversationID]++
	}

	// Fixture has 3 conversation pairs.
	if len(convIDs) != 3 {
		t.Errorf("expected 3 distinct conversations, got %d", len(convIDs))
	}

	// Each conversation should have a user and an assistant turn.
	for convID, count := range convIDs {
		if count != 2 {
			t.Errorf("conversation %q has %d turns, want 2", convID, count)
		}
	}
}

func TestAiderParseTotalTurnsPerConversation(t *testing.T) {
	fixture := fixtureDir(t, "aider", ".aider.chat.history.md")

	p := NewAiderParser(nil)
	turns, err := p.Parse(DataSource{
		Tool:    "aider",
		Path:    fixture,
		Format:  "markdown",
		Project: "/Users/dev/project",
	}, time.Time{})
	if err != nil {
		t.Fatal(err)
	}

	for _, turn := range turns {
		if turn.TotalTurns != 2 {
			t.Errorf("turn in conv %q: TotalTurns = %d, want 2", turn.ConversationID, turn.TotalTurns)
		}
	}
}
