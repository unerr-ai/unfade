package parsers

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// claudeEntry is the raw JSONL structure from ~/.claude/projects/<path>/<session>.jsonl.
type claudeEntry struct {
	UUID       string        `json:"uuid"`
	ParentUUID string        `json:"parentUuid"`
	Type       string        `json:"type"` // "user", "assistant", "permission-mode", "file-history-snapshot"
	Message    claudeMessage `json:"message"`
	Timestamp  string        `json:"timestamp"`
	SessionID  string        `json:"sessionId"`
	CWD        string        `json:"cwd"`
	GitBranch  string        `json:"gitBranch"`
	Sidechain  bool          `json:"isSidechain"`
}

// claudeMessage holds the role and polymorphic content field.
type claudeMessage struct {
	Role    string          `json:"role"`
	Content json.RawMessage `json:"content"`
}

// ClaudeCodeParser reads Claude Code session JSONL files and builds
// conversation trees from parentUuid/uuid chains.
type ClaudeCodeParser struct {
	homeDir string
}

func NewClaudeCodeParser(homeDir string) *ClaudeCodeParser {
	return &ClaudeCodeParser{homeDir: homeDir}
}

func (p *ClaudeCodeParser) Name() string { return "claude-code" }

func (p *ClaudeCodeParser) Discover() []DataSource {
	projectsDir := filepath.Join(p.homeDir, ".claude", "projects")
	if _, err := os.Stat(projectsDir); os.IsNotExist(err) {
		return nil
	}

	var sources []DataSource
	_ = filepath.WalkDir(projectsDir, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if filepath.Ext(path) != ".jsonl" {
			return nil
		}
		project := projectPathFromMangled(filepath.Base(filepath.Dir(path)))
		sources = append(sources, DataSource{
			Tool:    "claude-code",
			Path:    path,
			Format:  "jsonl",
			Project: project,
		})
		return nil
	})
	return sources
}

func (p *ClaudeCodeParser) Parse(source DataSource, since time.Time) ([]ConversationTurn, error) {
	f, err := os.Open(source.Path)
	if err != nil {
		if os.IsNotExist(err) || os.IsPermission(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("open %s: %w", source.Path, err)
	}
	defer f.Close()

	entries, err := readClaudeEntries(f, since)
	if err != nil {
		return nil, err
	}
	if len(entries) == 0 {
		return nil, nil
	}

	return buildConversationTurns(entries, source.Project), nil
}

func (p *ClaudeCodeParser) Tail(source DataSource, offset int64) ([]ConversationTurn, int64, error) {
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

	entries, err := readClaudeEntries(f, time.Time{})
	if err != nil {
		return nil, offset, err
	}

	newOffset, err := f.Seek(0, io.SeekCurrent)
	if err != nil {
		newOffset = info.Size()
	}

	if len(entries) == 0 {
		return nil, newOffset, nil
	}

	turns := tailConversationTurns(entries, source.Project)
	return turns, newOffset, nil
}

// readClaudeEntries streams JSONL lines, filtering by timestamp and skipping
// non-conversation types (permission-mode, file-history-snapshot).
func readClaudeEntries(r io.Reader, since time.Time) ([]claudeEntry, error) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	var entries []claudeEntry
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var entry claudeEntry
		if err := json.Unmarshal(line, &entry); err != nil {
			continue
		}

		if entry.Type == "permission-mode" || entry.Type == "file-history-snapshot" {
			continue
		}
		if entry.Type != "user" && entry.Type != "assistant" {
			continue
		}

		if !since.IsZero() {
			ts := parseTimestamp(entry.Timestamp)
			if !ts.IsZero() && ts.Before(since) {
				continue
			}
		}

		entries = append(entries, entry)
	}

	return entries, scanner.Err()
}

// buildConversationTurns reconstructs conversation trees from parentUuid/uuid
// chains and assigns sequential turn indices within each conversation.
func buildConversationTurns(entries []claudeEntry, project string) []ConversationTurn {
	if len(entries) == 0 {
		return nil
	}

	byUUID := make(map[string]*claudeEntry, len(entries))
	children := make(map[string][]string)

	for i := range entries {
		e := &entries[i]
		byUUID[e.UUID] = e
		if e.ParentUUID != "" {
			children[e.ParentUUID] = append(children[e.ParentUUID], e.UUID)
		}
	}

	// Find roots: entries whose parent is absent from the map.
	var roots []string
	for _, e := range entries {
		if e.ParentUUID == "" || byUUID[e.ParentUUID] == nil {
			roots = append(roots, e.UUID)
		}
	}

	// Walk each root's chain to build conversation sequences.
	visited := make(map[string]bool, len(entries))
	var allTurns []ConversationTurn

	for _, rootUUID := range roots {
		root := byUUID[rootUUID]
		if root == nil || visited[rootUUID] {
			continue
		}

		convID := root.SessionID
		if convID == "" {
			convID = rootUUID
		}
		if root.Sidechain {
			convID += "-side-" + rootUUID
		}

		chain := walkChain(rootUUID, byUUID, children, visited)
		totalTurns := len(chain)

		for i, uuid := range chain {
			e := byUUID[uuid]
			if e == nil {
				continue
			}

			content, toolCalls := extractClaudeContent(e)
			turn := ConversationTurn{
				SessionID:      e.SessionID,
				ConversationID: convID,
				TurnIndex:      i,
				TotalTurns:     totalTurns,
				Role:           normalizeClaudeRole(e.Type, e.Message.Role),
				Content:        content,
				Timestamp:      parseTimestamp(e.Timestamp),
				GitBranch:      e.GitBranch,
				ProjectPath:    firstNonEmpty(e.CWD, project),
				ParentID:       e.ParentUUID,
				ToolUse:        toolCalls,
			}
			allTurns = append(allTurns, turn)
		}
	}

	sort.Slice(allTurns, func(i, j int) bool {
		return allTurns[i].Timestamp.Before(allTurns[j].Timestamp)
	})

	return allTurns
}

// tailConversationTurns produces turns from incremental data without full
// tree context. ParentID is preserved for downstream tree building.
func tailConversationTurns(entries []claudeEntry, project string) []ConversationTurn {
	turns := make([]ConversationTurn, 0, len(entries))
	for _, e := range entries {
		content, toolCalls := extractClaudeContent(&e)
		turns = append(turns, ConversationTurn{
			SessionID:      e.SessionID,
			ConversationID: e.SessionID,
			TurnIndex:      -1,
			TotalTurns:     0,
			Role:           normalizeClaudeRole(e.Type, e.Message.Role),
			Content:        content,
			Timestamp:      parseTimestamp(e.Timestamp),
			GitBranch:      e.GitBranch,
			ProjectPath:    firstNonEmpty(e.CWD, project),
			ParentID:       e.ParentUUID,
			ToolUse:        toolCalls,
		})
	}
	return turns
}

// walkChain follows the main (non-sidechain preferred) conversation path
// from a root entry, producing an ordered list of UUIDs.
func walkChain(rootUUID string, byUUID map[string]*claudeEntry, childMap map[string][]string, visited map[string]bool) []string {
	var chain []string
	current := rootUUID

	for current != "" && !visited[current] {
		visited[current] = true
		chain = append(chain, current)

		kids := childMap[current]
		if len(kids) == 0 {
			break
		}

		// Prefer the non-sidechain child; fall back to first child.
		next := ""
		for _, kid := range kids {
			if e := byUUID[kid]; e != nil && !e.Sidechain && !visited[kid] {
				next = kid
				break
			}
		}
		if next == "" {
			for _, kid := range kids {
				if !visited[kid] {
					next = kid
					break
				}
			}
		}
		current = next
	}

	return chain
}

// extractClaudeContent handles the polymorphic message.content field.
// User messages: content is a JSON string.
// Assistant messages: content is a JSON array of {type, text/name/input} blocks.
func extractClaudeContent(e *claudeEntry) (string, []ToolCall) {
	raw := e.Message.Content
	if len(raw) == 0 {
		return "", nil
	}

	// Try string first (user messages).
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s, nil
	}

	// Try array of content blocks (assistant messages).
	var blocks []map[string]any
	if err := json.Unmarshal(raw, &blocks); err != nil {
		return string(raw), nil
	}

	var textParts []string
	var tools []ToolCall

	for _, block := range blocks {
		blockType, _ := block["type"].(string)
		switch blockType {
		case "text":
			if text, ok := block["text"].(string); ok {
				textParts = append(textParts, text)
			}
		case "tool_use":
			name, _ := block["name"].(string)
			inputRaw, _ := json.Marshal(block["input"])
			tools = append(tools, ToolCall{
				Name:  name,
				Input: truncate(string(inputRaw), 500),
			})
		}
	}

	return strings.Join(textParts, "\n"), tools
}

func normalizeClaudeRole(entryType, messageRole string) string {
	switch {
	case entryType == "user" || messageRole == "user":
		return "user"
	case entryType == "assistant" || messageRole == "assistant":
		return "assistant"
	default:
		return "system"
	}
}

// projectPathFromMangled reverses Claude Code's directory mangling:
// "-Users-jaswanth-IdeaProjects-unfade-cli" → "/Users/jaswanth/IdeaProjects/unfade-cli"
func projectPathFromMangled(mangled string) string {
	if mangled == "" {
		return ""
	}
	if mangled[0] == '-' {
		return "/" + strings.ReplaceAll(mangled[1:], "-", "/")
	}
	return strings.ReplaceAll(mangled, "-", "/")
}

func parseTimestamp(s string) time.Time {
	if s == "" {
		return time.Time{}
	}
	for _, layout := range []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02T15:04:05.000Z",
		"2006-01-02T15:04:05Z",
	} {
		if t, err := time.Parse(layout, s); err == nil {
			return t
		}
	}
	return time.Time{}
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max-3] + "..."
}
