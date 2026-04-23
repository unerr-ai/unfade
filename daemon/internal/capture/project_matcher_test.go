package capture

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func writeRegistry(t *testing.T, dir string, repos []registryEntry) string {
	t.Helper()
	reg := registryFile{SchemaVersion: 1, Repos: repos}
	data, err := json.Marshal(reg)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "registry.v1.json")
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestProjectMatcher_LongestPrefixMatch(t *testing.T) {
	dir := t.TempDir()
	// Create nested project dirs so Abs can resolve them
	parent := filepath.Join(dir, "projects")
	child := filepath.Join(parent, "unfade-cli")
	if err := os.MkdirAll(child, 0o755); err != nil {
		t.Fatal(err)
	}

	path := writeRegistry(t, dir, []registryEntry{
		{ID: "parent-project", Root: parent},
		{ID: "unfade-cli", Root: child},
	})

	m := NewProjectMatcher(path)

	// Exact match on child should return child project, not parent
	got := m.Match(child)
	if got != "unfade-cli" {
		t.Errorf("Match(%q) = %q, want %q", child, got, "unfade-cli")
	}

	// Subpath of child should also match child (longest prefix)
	subpath := filepath.Join(child, "src", "main.go")
	got = m.Match(subpath)
	if got != "unfade-cli" {
		t.Errorf("Match(%q) = %q, want %q", subpath, got, "unfade-cli")
	}

	// Subpath of parent (but not child) should match parent
	sibling := filepath.Join(parent, "other-repo")
	got = m.Match(sibling)
	if got != "parent-project" {
		t.Errorf("Match(%q) = %q, want %q", sibling, got, "parent-project")
	}
}

func TestProjectMatcher_EmptyPath(t *testing.T) {
	dir := t.TempDir()
	path := writeRegistry(t, dir, []registryEntry{
		{ID: "test", Root: "/some/path"},
	})

	m := NewProjectMatcher(path)
	got := m.Match("")
	if got != "" {
		t.Errorf("Match(\"\") = %q, want empty string", got)
	}
}

func TestProjectMatcher_UnregisteredFallback(t *testing.T) {
	dir := t.TempDir()
	path := writeRegistry(t, dir, []registryEntry{
		{ID: "known", Root: filepath.Join(dir, "known-repo")},
	})

	m := NewProjectMatcher(path)
	unknown := filepath.Join(dir, "unknown-repo")
	got := m.Match(unknown)
	want := "unregistered:" + unknown
	if got != want {
		t.Errorf("Match(%q) = %q, want %q", unknown, got, want)
	}
}

func TestProjectMatcher_RegistryLoadFailure(t *testing.T) {
	// Non-existent registry file → no-op matcher
	m := NewProjectMatcher("/nonexistent/registry.json")
	got := m.Match("/some/project")
	if got != "unregistered:/some/project" {
		t.Errorf("Match with bad registry = %q, want unregistered fallback", got)
	}
}

func TestProjectMatcher_InvalidJSON(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "registry.v1.json")
	if err := os.WriteFile(path, []byte("not json"), 0o644); err != nil {
		t.Fatal(err)
	}

	m := NewProjectMatcher(path)
	got := m.Match("/some/project")
	if got != "unregistered:/some/project" {
		t.Errorf("Match with invalid JSON = %q, want unregistered fallback", got)
	}
}

func TestRegistryPath_ReturnsNonEmpty(t *testing.T) {
	// RegistryPath should return a non-empty path when HOME is set
	if os.Getenv("HOME") == "" && os.Getenv("USERPROFILE") == "" {
		t.Skip("no HOME or USERPROFILE set")
	}
	got := RegistryPath()
	if got == "" {
		t.Error("RegistryPath() returned empty string with HOME set")
	}
}
