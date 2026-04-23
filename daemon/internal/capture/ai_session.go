package capture

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/google/uuid"
	"github.com/unfade-io/unfade-cli/daemon/internal/capture/parsers"
)

const (
	aiPollInterval  = 10 * time.Second
	aiDebounceDelay = 1 * time.Second
)

// sessionSeqCounters tracks monotonic sequence IDs per session across the process.
var sessionSeqCounters = struct {
	mu       sync.Mutex
	counters map[string]int64
}{counters: make(map[string]int64)}

// nextSequenceID returns the next monotonic sequence number for the given session.
func nextSequenceID(sessionID string) int64 {
	if sessionID == "" {
		return 0
	}
	sessionSeqCounters.mu.Lock()
	defer sessionSeqCounters.mu.Unlock()
	n := sessionSeqCounters.counters[sessionID]
	sessionSeqCounters.counters[sessionID] = n + 1
	return n
}

// sequencesFile is the path format for persistent sequence state.
// Format: {"sessions": {"session-uuid": lastId}, "updated": "ISO"}
type sequencesState struct {
	Sessions map[string]int64 `json:"sessions"`
	Updated  string           `json:"updated"`
}

// LoadSequenceCounters restores sequence counters from .unfade/state/sequences.json.
// Called once at daemon startup.
func LoadSequenceCounters(stateDir string) {
	filePath := filepath.Join(stateDir, "sequences.json")
	data, err := os.ReadFile(filePath)
	if err != nil {
		return // File doesn't exist yet — fresh start.
	}

	var state sequencesState
	if err := json.Unmarshal(data, &state); err != nil {
		return // Corrupted — start fresh.
	}

	sessionSeqCounters.mu.Lock()
	defer sessionSeqCounters.mu.Unlock()
	for k, v := range state.Sessions {
		sessionSeqCounters.counters[k] = v + 1 // +1 so next ID is monotonically after persisted max
	}
}

// SaveSequenceCounters persists sequence counters to .unfade/state/sequences.json.
// Called on daemon shutdown for crash recovery.
func SaveSequenceCounters(stateDir string) error {
	sessionSeqCounters.mu.Lock()
	state := sequencesState{
		Sessions: make(map[string]int64, len(sessionSeqCounters.counters)),
		Updated:  time.Now().Format(time.RFC3339),
	}
	for k, v := range sessionSeqCounters.counters {
		state.Sessions[k] = v
	}
	sessionSeqCounters.mu.Unlock()

	data, err := json.Marshal(state)
	if err != nil {
		return fmt.Errorf("marshal sequences: %w", err)
	}

	if err := os.MkdirAll(stateDir, 0o755); err != nil {
		return fmt.Errorf("create state dir: %w", err)
	}

	return os.WriteFile(filepath.Join(stateDir, "sequences.json"), data, 0o644)
}

// ResetSequenceCounters clears in-memory counters (for testing).
func ResetSequenceCounters() {
	sessionSeqCounters.mu.Lock()
	defer sessionSeqCounters.mu.Unlock()
	sessionSeqCounters.counters = make(map[string]int64)
}

// AISessionWatcher implements CaptureSource — discovers AI tool data on disk
// via pluggable parsers, tails new data, and emits raw CaptureEvents.
type AISessionWatcher struct {
	logger  CaptureSourceLogger
	parsers []parsers.AIToolParser
	watcher *fsnotify.Watcher
	eventCh chan<- CaptureEvent
	done    chan struct{}
	wg      sync.WaitGroup
	offsets map[string]int64 // DataSource.Path → last byte/rowid offset
	mu      sync.Mutex
}

// NewAISessionWatcher creates a watcher with default parsers for all
// supported AI tools (Claude Code, Cursor, Codex CLI, Aider).
func NewAISessionWatcher(logger CaptureSourceLogger, projectPaths []string) *AISessionWatcher {
	home, _ := os.UserHomeDir()
	if home == "" {
		home = "/tmp"
	}

	return &AISessionWatcher{
		logger: logger,
		parsers: []parsers.AIToolParser{
			parsers.NewClaudeCodeParser(home),
			parsers.NewCursorParser(home),
			parsers.NewCodexParser(home),
			parsers.NewAiderParser(projectPaths),
		},
		done:    make(chan struct{}),
		offsets: make(map[string]int64),
	}
}

func (a *AISessionWatcher) Name() string { return "ai-session" }

func (a *AISessionWatcher) Start(eventCh chan<- CaptureEvent) error {
	a.eventCh = eventCh

	// Initialize offsets to current file/db positions so the live watcher
	// only picks up NEW data. Historical data is handled by the ingestor.
	a.initializeOffsets()

	// Discover base directories for fsnotify watches.
	watchDirs := a.discoverWatchDirs()

	if len(watchDirs) > 0 {
		w, err := fsnotify.NewWatcher()
		if err != nil {
			return fmt.Errorf("create fsnotify watcher: %w", err)
		}
		a.watcher = w

		for _, dir := range watchDirs {
			if err := watchRecursive(w, dir); err != nil {
				a.logger.Warn("failed to watch ai session dir", map[string]any{
					"dir":   dir,
					"error": err.Error(),
				})
			} else {
				a.logger.Info("watching ai session dir", map[string]any{"dir": dir})
			}
		}
	} else {
		a.logger.Info("no ai session directories found — running in poll-only mode")
	}

	a.wg.Add(1)
	go a.watchLoop()

	a.logger.Info("ai session watcher started", map[string]any{
		"parsers": len(a.parsers),
	})
	return nil
}

func (a *AISessionWatcher) Stop() {
	close(a.done)
	if a.watcher != nil {
		_ = a.watcher.Close()
	}
	a.wg.Wait()
	a.logger.Info("ai session watcher stopped")
}

func (a *AISessionWatcher) WatchedPaths() []string {
	return a.discoverWatchDirs()
}

// initializeOffsets fast-forwards to the current end of every known data
// source so subsequent Tail() calls only return newly appended data.
func (a *AISessionWatcher) initializeOffsets() {
	for _, p := range a.parsers {
		for _, src := range p.Discover() {
			switch src.Format {
			case "jsonl", "markdown":
				info, err := os.Stat(src.Path)
				if err == nil {
					a.offsets[src.Path] = info.Size()
				}
			case "sqlite":
				// For SQLite we need to query the current max rowid.
				_, newOffset, _ := p.Tail(src, 0)
				a.offsets[src.Path] = newOffset
			}
		}
	}
}

// discoverWatchDirs collects the unique parent directories of all discovered
// data sources for fsnotify registration.
func (a *AISessionWatcher) discoverWatchDirs() []string {
	dirSet := make(map[string]bool)
	for _, p := range a.parsers {
		for _, src := range p.Discover() {
			dir := filepath.Dir(src.Path)
			dirSet[dir] = true
		}
	}
	dirs := make([]string, 0, len(dirSet))
	for d := range dirSet {
		dirs = append(dirs, d)
	}
	return dirs
}

func (a *AISessionWatcher) watchLoop() {
	defer a.wg.Done()

	pollTicker := time.NewTicker(aiPollInterval)
	defer pollTicker.Stop()

	var debounceTimer *time.Timer
	var debounceCh <-chan time.Time

	for {
		select {
		case <-a.done:
			if debounceTimer != nil {
				debounceTimer.Stop()
			}
			return

		case event, ok := <-a.watcherEvents():
			if !ok {
				return
			}
			if !isRelevantAIFile(event.Name) {
				continue
			}
			if debounceTimer != nil {
				debounceTimer.Stop()
			}
			debounceTimer = time.NewTimer(aiDebounceDelay)
			debounceCh = debounceTimer.C

		case <-debounceCh:
			debounceCh = nil
			a.scanAndEmit()

		case <-pollTicker.C:
			a.scanAndEmit()
		}
	}
}

func (a *AISessionWatcher) watcherEvents() <-chan fsnotify.Event {
	if a.watcher != nil {
		return a.watcher.Events
	}
	return make(chan fsnotify.Event)
}

// scanAndEmit iterates every parser, tails each data source for new turns,
// groups by conversation, and emits raw CaptureEvents.
func (a *AISessionWatcher) scanAndEmit() {
	for _, p := range a.parsers {
		for _, src := range p.Discover() {
			a.mu.Lock()
			lastOffset := a.offsets[src.Path]
			a.mu.Unlock()

			turns, newOffset, err := p.Tail(src, lastOffset)
			if err != nil {
				a.logger.Debug("tail error", map[string]any{
					"tool":  p.Name(),
					"path":  src.Path,
					"error": err.Error(),
				})
				continue
			}
			if newOffset == lastOffset || len(turns) == 0 {
				if newOffset != lastOffset {
					a.mu.Lock()
					a.offsets[src.Path] = newOffset
					a.mu.Unlock()
				}
				continue
			}

			a.mu.Lock()
			a.offsets[src.Path] = newOffset
			a.mu.Unlock()

			events := TurnsToEvents(turns, p.Name())
			for _, ev := range events {
				select {
				case a.eventCh <- ev:
				case <-a.done:
					return
				}
			}
		}
	}
}

// --- Shared event conversion (used by both watcher and historical ingestor) ---

// TurnsToEvents groups ConversationTurns by ConversationID and produces
// raw CaptureEvents. No classification or analysis — the daemon is a pure fetcher.
func TurnsToEvents(turns []parsers.ConversationTurn, toolName string) []CaptureEvent {
	if len(turns) == 0 {
		return nil
	}

	convMap := make(map[string][]parsers.ConversationTurn)
	for _, t := range turns {
		convMap[t.ConversationID] = append(convMap[t.ConversationID], t)
	}

	events := make([]CaptureEvent, 0, len(convMap))
	for convID, convTurns := range convMap {
		for i := range convTurns {
			convTurns[i].TotalTurns = len(convTurns)
		}
		events = append(events, conversationToEvent(convID, convTurns, toolName))
	}

	return events
}

func conversationToEvent(convID string, turns []parsers.ConversationTurn, toolName string) CaptureEvent {
	summary := "AI conversation"
	for _, t := range turns {
		if t.Role == "user" && len(strings.TrimSpace(t.Content)) > 5 {
			summary = truncateSummary(t.Content)
			break
		}
	}
	if summary == "AI conversation" {
		for _, t := range turns {
			if t.Role == "summary" && t.Content != "" {
				summary = truncateSummary(t.Content)
				break
			}
		}
	}

	ts := time.Now().UTC()
	for _, t := range turns {
		if !t.Timestamp.IsZero() {
			ts = t.Timestamp
			break
		}
	}

	branch := ""
	project := ""
	sessionID := ""
	for _, t := range turns {
		if t.GitBranch != "" && branch == "" {
			branch = t.GitBranch
		}
		if t.ProjectPath != "" && project == "" {
			project = t.ProjectPath
		}
		if t.SessionID != "" && sessionID == "" {
			sessionID = t.SessionID
		}
	}

	detail := buildConversationDetail(turns)

	// Raw data extraction only — no classification or analysis.
	filesReferenced, filesModified := extractFileInfo(turns)
	toolCallsSummary := summarizeToolCalls(turns)
	fullPrompt := extractFullPrompt(turns)
	promptTimestamps := extractPromptTimestamps(turns)
	allPrompts := extractAllPrompts(turns)

	repoName := ""
	if project != "" {
		repoName = filepath.Base(project)
	}

	modelID := ""
	environment := ""
	conversationTitle := ""
	for _, t := range turns {
		if m, ok := t.Metadata["model_id"].(string); ok && m != "" && modelID == "" {
			modelID = m
		}
		if e, ok := t.Metadata["environment"].(string); ok && e != "" && environment == "" {
			environment = e
		}
		if ct, ok := t.Metadata["conversation_title"].(string); ok && ct != "" && conversationTitle == "" {
			conversationTitle = ct
		}
	}

	// Fallback: use first user prompt (truncated) as conversation title when
	// the parser doesn't provide one (Claude Code, Codex, Aider).
	if conversationTitle == "" && fullPrompt != "" {
		conversationTitle = fullPrompt
		if len(conversationTitle) > 200 {
			conversationTitle = conversationTitle[:200]
		}
	}

	// Raw conversation turns serialized for downstream processing.
	rawTurns := make([]map[string]any, 0, len(turns))
	for _, t := range turns {
		turn := map[string]any{
			"role":       t.Role,
			"content":    t.Content,
			"turn_index": t.TurnIndex,
		}
		if !t.Timestamp.IsZero() {
			turn["timestamp"] = t.Timestamp.UTC().Format(time.RFC3339)
		}
		if len(t.ToolUse) > 0 {
			turn["tool_use"] = t.ToolUse
		}
		rawTurns = append(rawTurns, turn)
	}

	metadata := map[string]any{
		"ai_tool":            toolName,
		"session_id":         sessionID,
		"conversation_id":    convID,
		"conversation_title": conversationTitle,
		"turn_count":         len(turns),
		"repo_root":          project,
		"repo_name":          repoName,
		"sequence_id":        nextSequenceID(sessionID),
		"model_id":           modelID,
		"environment":        environment,
		// Raw data — preserved for downstream processing
		"prompt_full":        fullPrompt,
		"prompts_all":        allPrompts,
		"prompt_count":       len(allPrompts),
		"prompt_timestamps":  promptTimestamps,
		"files_referenced":   filesReferenced,
		"files_modified":     filesModified,
		"tool_calls_summary": toolCallsSummary,
		"turns":              rawTurns,
	}

	allFiles := make([]string, 0, len(filesModified))
	allFiles = append(allFiles, filesModified...)

	return CaptureEvent{
		ID:        uuid.New().String(),
		Timestamp: ts.UTC().Format(time.RFC3339),
		Source:    "ai-session",
		Type:      "ai-conversation",
		Content: EventContent{
			Summary: summary,
			Detail:  detail,
			Branch:  branch,
			Project: project,
			Files:   allFiles,
		},
		Metadata: metadata,
	}
}

// extractFullPrompt returns the full text of the first user prompt (up to 10KB).
func extractFullPrompt(turns []parsers.ConversationTurn) string {
	for _, t := range turns {
		if t.Role == "user" && len(strings.TrimSpace(t.Content)) > 5 {
			content := strings.TrimSpace(t.Content)
			if len(content) > 10240 {
				content = content[:10240] + "... [truncated]"
			}
			return content
		}
	}
	return ""
}

// extractAllPrompts returns all user prompts (max 20 entries, 5KB quality cap each).
func extractAllPrompts(turns []parsers.ConversationTurn) []string {
	const maxEntries = 20
	const maxBytes = 5120

	var prompts []string
	for _, t := range turns {
		if t.Role == "user" && len(strings.TrimSpace(t.Content)) > 5 {
			content := strings.TrimSpace(t.Content)
			if len(content) > maxBytes {
				content = content[:maxBytes] + "... [truncated]"
			}
			prompts = append(prompts, content)
			if len(prompts) >= maxEntries {
				break
			}
		}
	}
	return prompts
}

// extractFileInfo extracts referenced and modified files from tool calls.
func extractFileInfo(turns []parsers.ConversationTurn) (referenced, modified []string) {
	refSet := make(map[string]bool)
	modSet := make(map[string]bool)

	for _, t := range turns {
		for _, tc := range t.ToolUse {
			fp := extractFilePath(tc.Input)
			if fp == "" {
				continue
			}
			switch tc.Name {
			case "Read", "Glob", "Grep":
				refSet[fp] = true
			case "Edit", "Write":
				modSet[fp] = true
				refSet[fp] = true
			default:
				// Other tools with file paths are references
				if fp != "" {
					refSet[fp] = true
				}
			}
		}
	}

	referenced = mapKeys(refSet)
	modified = mapKeys(modSet)
	return
}

// extractFilePath attempts to extract a file_path or path from a tool input JSON string.
func extractFilePath(input string) string {
	if input == "" {
		return ""
	}
	var parsed map[string]any
	if err := json.Unmarshal([]byte(input), &parsed); err != nil {
		return ""
	}
	if fp, ok := parsed["file_path"].(string); ok && fp != "" {
		return fp
	}
	if p, ok := parsed["path"].(string); ok && p != "" {
		return p
	}
	return ""
}

// summarizeToolCalls returns a compact summary of tool usage in the conversation.
func summarizeToolCalls(turns []parsers.ConversationTurn) []map[string]any {
	var summary []map[string]any
	for _, t := range turns {
		if t.Role != "assistant" {
			continue
		}
		for _, tc := range t.ToolUse {
			entry := map[string]any{"name": tc.Name}
			fp := extractFilePath(tc.Input)
			if fp != "" {
				entry["target"] = fp
			}
			summary = append(summary, entry)
			if len(summary) >= 50 {
				return summary // Cap at 50 tool calls
			}
		}
	}
	return summary
}

// extractPromptTimestamps returns ISO timestamps of all user prompts.
func extractPromptTimestamps(turns []parsers.ConversationTurn) []string {
	var timestamps []string
	for _, t := range turns {
		if t.Role == "user" && !t.Timestamp.IsZero() {
			timestamps = append(timestamps, t.Timestamp.UTC().Format(time.RFC3339))
		}
	}
	return timestamps
}

// mapKeys returns the keys of a map[string]bool as a sorted slice.
func mapKeys(m map[string]bool) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}

func buildConversationDetail(turns []parsers.ConversationTurn) string {
	var b strings.Builder
	for i, t := range turns {
		if i > 0 {
			b.WriteString(" | ")
		}
		b.WriteString(t.Role)
		b.WriteString(": ")
		content := strings.TrimSpace(t.Content)
		if len(content) > 300 {
			content = content[:297] + "..."
		}
		content = strings.ReplaceAll(content, "\n", " ")
		b.WriteString(content)
		if b.Len() > 4000 {
			b.WriteString(" | ...")
			break
		}
	}
	return b.String()
}

// --- Helpers ---

func isRelevantAIFile(name string) bool {
	switch filepath.Ext(name) {
	case ".jsonl", ".log", ".db", ".md":
		return true
	}
	return false
}

func watchRecursive(w *fsnotify.Watcher, dir string) error {
	return filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if watchErr := w.Add(path); watchErr != nil {
				// Skip silently — non-critical.
			}
		}
		return nil
	})
}

// truncateSummary shortens a string for use as an event summary.
func truncateSummary(s string) string {
	s = strings.TrimSpace(s)
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.ReplaceAll(s, "\r", "")
	if len(s) > 200 {
		return s[:197] + "..."
	}
	return s
}
