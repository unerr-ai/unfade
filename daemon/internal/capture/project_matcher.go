package capture

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type registryEntry struct {
	ID   string `json:"id"`
	Root string `json:"root"`
}

type registryFile struct {
	SchemaVersion int             `json:"schemaVersion"`
	Repos         []registryEntry `json:"repos"`
}

// ProjectMatcher resolves filesystem paths to projectIds via the global registry.
// Uses longest-prefix matching: /Users/j/IdeaProjects/unfade-cli/daemon → unfade-cli.
type ProjectMatcher struct {
	entries []registryEntry
}

// NewProjectMatcher loads the registry and returns a matcher.
// Returns a no-op matcher if the registry is unreadable (unregistered projects still captured).
func NewProjectMatcher(registryPath string) *ProjectMatcher {
	data, err := os.ReadFile(registryPath)
	if err != nil {
		return &ProjectMatcher{}
	}

	var reg registryFile
	if err := json.Unmarshal(data, &reg); err != nil {
		return &ProjectMatcher{}
	}

	entries := make([]registryEntry, len(reg.Repos))
	for i, r := range reg.Repos {
		abs, err := filepath.Abs(r.Root)
		if err != nil {
			abs = r.Root
		}
		entries[i] = registryEntry{ID: r.ID, Root: abs}
	}

	sort.Slice(entries, func(i, j int) bool {
		return len(entries[i].Root) > len(entries[j].Root)
	})

	return &ProjectMatcher{entries: entries}
}

// Match returns the projectId for a given filesystem path.
// Longest-prefix match against registry entries.
// Returns "unregistered:<path>" if no match found, or empty string if path is empty.
func (m *ProjectMatcher) Match(contentProject string) string {
	if contentProject == "" {
		return ""
	}

	abs, err := filepath.Abs(contentProject)
	if err != nil {
		abs = contentProject
	}

	for _, entry := range m.entries {
		if abs == entry.Root || strings.HasPrefix(abs, entry.Root+string(filepath.Separator)) {
			return entry.ID
		}
	}

	return "unregistered:" + contentProject
}

// RegistryPath returns the default registry path at ~/.unfade/state/registry.v1.json.
// Returns empty string if the user home directory cannot be determined.
func RegistryPath() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return ""
	}
	return filepath.Join(home, ".unfade", "state", "registry.v1.json")
}
