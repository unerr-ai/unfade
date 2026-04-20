package parsers

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"time"
)

// codexEntry is the raw JSONL structure from ~/.codex/sessions/YYYY/MM/DD/*.jsonl.
type codexEntry struct {
	Type      string          `json:"type"` // "session_meta", "response_item", "event_msg"
	Timestamp string          `json:"timestamp"`
	Payload   json.RawMessage `json:"payload"`
}

// codexSessionMeta holds the metadata from a session_meta entry.
type codexSessionMeta struct {
	ID            string `json:"id"`
	CWD           string `json:"cwd"`
	CLIVersion    string `json:"cli_version"`
	ModelProvider string `json:"model_provider"`
	Git           struct {
		CommitHash    string `json:"commit_hash"`
		Branch        string `json:"branch"`
		RepositoryURL string `json:"repository_url"`
	} `json:"git"`
}

// codexResponseItem holds a single conversation turn from a response_item entry.
type codexResponseItem struct {
	Role    string `json:"role"` // "user", "assistant"
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
}

// CodexParser reads Codex CLI session JSONL files from ~/.codex/sessions/.
type CodexParser struct {
	homeDir string
}

func NewCodexParser(homeDir string) *CodexParser {
	return &CodexParser{homeDir: homeDir}
}

func (p *CodexParser) Name() string { return "codex" }

func (p *CodexParser) Discover() []DataSource {
	sessionsDir := filepath.Join(p.homeDir, ".codex", "sessions")
	if _, err := os.Stat(sessionsDir); os.IsNotExist(err) {
		return nil
	}

	var sources []DataSource
	_ = filepath.WalkDir(sessionsDir, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if filepath.Ext(path) != ".jsonl" {
			return nil
		}
		sources = append(sources, DataSource{
			Tool:   "codex",
			Path:   path,
			Format: "jsonl",
		})
		return nil
	})
	return sources
}

func (p *CodexParser) Parse(source DataSource, since time.Time) ([]ConversationTurn, error) {
	f, err := os.Open(source.Path)
	if err != nil {
		if os.IsNotExist(err) || os.IsPermission(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("open %s: %w", source.Path, err)
	}
	defer f.Close()

	return parseCodexSession(f, since)
}

func (p *CodexParser) Tail(source DataSource, offset int64) ([]ConversationTurn, int64, error) {
	f, err := os.Open(source.Path)
	if err != nil {
		if os.IsNotExist(err) || os.IsPermission(err) {
			return nil, offset, nil
		}
		return nil, offset, fmt.Errorf("open %s: %w", source.Path, err)
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return nil, offset, err
	}
	if info.Size() <= offset {
		return nil, offset, nil
	}

	if offset > 0 {
		if _, err := f.Seek(offset, io.SeekStart); err != nil {
			return nil, offset, err
		}
	}

	turns, err := parseCodexSession(f, time.Time{})
	if err != nil {
		return nil, offset, err
	}

	newOffset, err := f.Seek(0, io.SeekCurrent)
	if err != nil {
		newOffset = info.Size()
	}

	return turns, newOffset, nil
}

func parseCodexSession(r io.Reader, since time.Time) ([]ConversationTurn, error) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	var meta codexSessionMeta
	var turns []ConversationTurn
	turnIdx := 0

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var entry codexEntry
		if err := json.Unmarshal(line, &entry); err != nil {
			continue
		}

		switch entry.Type {
		case "session_meta":
			if err := json.Unmarshal(entry.Payload, &meta); err != nil {
				continue
			}

		case "response_item":
			ts := parseTimestamp(entry.Timestamp)
			if !since.IsZero() && !ts.IsZero() && ts.Before(since) {
				continue
			}

			var item codexResponseItem
			if err := json.Unmarshal(entry.Payload, &item); err != nil {
				continue
			}

			content := extractCodexContent(item)
			if content == "" {
				continue
			}

			turn := ConversationTurn{
				SessionID:      meta.ID,
				ConversationID: meta.ID,
				TurnIndex:      turnIdx,
				Role:           normalizeCodexRole(item.Role),
				Content:        content,
				Timestamp:      ts,
				GitBranch:      meta.Git.Branch,
				ProjectPath:    meta.CWD,
				Metadata: map[string]any{
					"model_provider": meta.ModelProvider,
					"cli_version":    meta.CLIVersion,
				},
			}

			if meta.Git.CommitHash != "" {
				turn.Metadata["commit_hash"] = meta.Git.CommitHash
			}
			if meta.Git.RepositoryURL != "" {
				turn.Metadata["repository_url"] = meta.Git.RepositoryURL
			}

			turns = append(turns, turn)
			turnIdx++
		}
	}

	if err := scanner.Err(); err != nil {
		return turns, err
	}

	// Back-fill TotalTurns now that we know the count.
	for i := range turns {
		turns[i].TotalTurns = len(turns)
	}

	sort.Slice(turns, func(i, j int) bool {
		return turns[i].Timestamp.Before(turns[j].Timestamp)
	})

	return turns, nil
}

func extractCodexContent(item codexResponseItem) string {
	var parts []string
	for _, c := range item.Content {
		if c.Type == "text" && c.Text != "" {
			parts = append(parts, c.Text)
		}
	}
	return joinParts(parts)
}

func normalizeCodexRole(role string) string {
	switch role {
	case "user":
		return "user"
	case "assistant":
		return "assistant"
	default:
		return "system"
	}
}

func joinParts(parts []string) string {
	if len(parts) == 0 {
		return ""
	}
	result := parts[0]
	for _, p := range parts[1:] {
		result += "\n" + p
	}
	return result
}
