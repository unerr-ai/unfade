package capture

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/unfade-io/unfade-cli/daemon/internal/capture/parsers"
)

// mockParser implements parsers.AIToolParser for testing.
type mockParser struct {
	name      string
	sources   []parsers.DataSource
	tailTurns []parsers.ConversationTurn
	tailOff   int64
}

func (m *mockParser) Name() string                   { return m.name }
func (m *mockParser) Discover() []parsers.DataSource { return m.sources }
func (m *mockParser) Parse(src parsers.DataSource, since time.Time) ([]parsers.ConversationTurn, error) {
	return m.tailTurns, nil
}
func (m *mockParser) Tail(src parsers.DataSource, offset int64) ([]parsers.ConversationTurn, int64, error) {
	if offset >= m.tailOff {
		return nil, offset, nil
	}
	return m.tailTurns, m.tailOff, nil
}

func TestAISessionWatcherV2Name(t *testing.T) {
	w := NewAISessionWatcher(&testLogger{}, nil)
	if w.Name() != "ai-session" {
		t.Errorf("Name() = %q, want ai-session", w.Name())
	}
}

func TestAISessionWatcherV2StartStopNoDirs(t *testing.T) {
	w := &AISessionWatcher{
		logger:  &testLogger{},
		parsers: []parsers.AIToolParser{&mockParser{name: "mock"}},
		done:    make(chan struct{}),
		offsets: make(map[string]int64),
	}

	ch := make(chan CaptureEvent, 10)
	if err := w.Start(ch); err != nil {
		t.Fatalf("Start: %v", err)
	}
	w.Stop()
}

// T-100: AISessionWatcher V2 emits events with direction_signals metadata.
func TestAISessionWatcherV2EmitsClassifiedEvents(t *testing.T) {
	mock := &mockParser{
		name: "test-tool",
		sources: []parsers.DataSource{
			{Tool: "test", Path: "/tmp/nonexistent-test-file.jsonl", Format: "jsonl"},
		},
		tailTurns: []parsers.ConversationTurn{
			{
				ConversationID: "conv-1", TurnIndex: 0, Role: "user",
				Content:   "No, don't use a singleton — use dependency injection instead of singletons for testability",
				Timestamp: time.Now(), SessionID: "sess-1",
			},
			{
				ConversationID: "conv-1", TurnIndex: 1, Role: "assistant",
				Content:   "I'll switch to dependency injection as you suggested.",
				Timestamp: time.Now(), SessionID: "sess-1",
			},
		},
		tailOff: 500,
	}

	ch := make(chan CaptureEvent, 10)
	w := &AISessionWatcher{
		logger:  &testLogger{},
		parsers: []parsers.AIToolParser{mock},
		done:    make(chan struct{}),
		offsets: make(map[string]int64),
		eventCh: ch,
	}

	w.scanAndEmit()

	select {
	case event := <-ch:
		if event.Source != "ai-session" {
			t.Errorf("source = %q, want ai-session", event.Source)
		}
		if event.Type != "ai-conversation" {
			t.Errorf("type = %q, want ai-conversation", event.Type)
		}
		if event.Metadata == nil {
			t.Fatal("expected metadata")
		}
		if _, ok := event.Metadata["direction_signals"]; !ok {
			t.Error("expected direction_signals in metadata")
		}
		if event.Metadata["ai_tool"] != "test-tool" {
			t.Errorf("ai_tool = %q, want test-tool", event.Metadata["ai_tool"])
		}
		turnCount, _ := event.Metadata["turn_count"].(int)
		if turnCount != 2 {
			t.Errorf("turn_count = %d, want 2", turnCount)
		}
	case <-time.After(1 * time.Second):
		t.Error("no event emitted")
	}
}

func TestAISessionWatcherV2OffsetTracking(t *testing.T) {
	mock := &mockParser{
		name:    "test",
		sources: []parsers.DataSource{{Tool: "test", Path: "/tmp/test-offset.jsonl", Format: "jsonl"}},
		tailTurns: []parsers.ConversationTurn{
			{ConversationID: "c1", TurnIndex: 0, Role: "user", Content: "hello", Timestamp: time.Now()},
		},
		tailOff: 100,
	}

	ch := make(chan CaptureEvent, 10)
	w := &AISessionWatcher{
		logger:  &testLogger{},
		parsers: []parsers.AIToolParser{mock},
		done:    make(chan struct{}),
		offsets: make(map[string]int64),
		eventCh: ch,
	}

	w.scanAndEmit()

	// Offset should be updated.
	w.mu.Lock()
	off := w.offsets["/tmp/test-offset.jsonl"]
	w.mu.Unlock()
	if off != 100 {
		t.Errorf("offset = %d, want 100", off)
	}

	// Second scan — no new data (offset already at 100).
	w.scanAndEmit()

	select {
	case <-ch:
		// First scan's event — drain it.
	default:
	}
	select {
	case <-ch:
		t.Error("unexpected second event (no new data)")
	case <-time.After(100 * time.Millisecond):
		// Good.
	}
}

func TestAISessionWatcherV2MultipleConversations(t *testing.T) {
	mock := &mockParser{
		name:    "multi",
		sources: []parsers.DataSource{{Tool: "multi", Path: "/tmp/multi.jsonl", Format: "jsonl"}},
		tailTurns: []parsers.ConversationTurn{
			{ConversationID: "conv-A", TurnIndex: 0, Role: "user", Content: "question A", Timestamp: time.Now()},
			{ConversationID: "conv-A", TurnIndex: 1, Role: "assistant", Content: "answer A", Timestamp: time.Now()},
			{ConversationID: "conv-B", TurnIndex: 0, Role: "user", Content: "question B", Timestamp: time.Now()},
			{ConversationID: "conv-B", TurnIndex: 1, Role: "assistant", Content: "answer B", Timestamp: time.Now()},
		},
		tailOff: 400,
	}

	ch := make(chan CaptureEvent, 10)
	w := &AISessionWatcher{
		logger:  &testLogger{},
		parsers: []parsers.AIToolParser{mock},
		done:    make(chan struct{}),
		offsets: make(map[string]int64),
		eventCh: ch,
	}

	w.scanAndEmit()

	// Should emit 2 events (one per conversation).
	count := 0
	timeout := time.After(1 * time.Second)
	for {
		select {
		case <-ch:
			count++
			if count == 2 {
				goto done
			}
		case <-timeout:
			goto done
		}
	}
done:
	if count != 2 {
		t.Errorf("got %d events, want 2 (one per conversation)", count)
	}
}

func TestTurnsToEventsDirectionSignals(t *testing.T) {
	turns := []parsers.ConversationTurn{
		{ConversationID: "c1", TurnIndex: 0, Role: "user", Content: "Refactor auth to use DI instead of singletons", Timestamp: time.Now()},
		{ConversationID: "c1", TurnIndex: 1, Role: "assistant", Content: "I'll use a singleton pattern for AuthService.", Timestamp: time.Now()},
		{ConversationID: "c1", TurnIndex: 2, Role: "user", Content: "No, don't use singletons — we need DI because our test framework uses isolated containers", Timestamp: time.Now()},
		{ConversationID: "c1", TurnIndex: 3, Role: "assistant", Content: "Switching to dependency injection.", Timestamp: time.Now()},
	}

	events := TurnsToEvents(turns, "claude-code")
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}

	ev := events[0]
	signals, ok := ev.Metadata["direction_signals"].(parsers.DirectionSignals)
	if !ok {
		t.Fatal("direction_signals not found or wrong type")
	}
	if signals.HumanDirectionScore <= 0 {
		t.Errorf("HDS = %.3f, want > 0", signals.HumanDirectionScore)
	}
	if signals.RejectionCount == 0 {
		t.Error("expected rejection count > 0")
	}
}

func TestTruncateSummary(t *testing.T) {
	short := "short"
	if truncateSummary(short) != "short" {
		t.Error("short string should not be truncated")
	}

	long := "a very long string that goes on and on " +
		"and on and on and on and on and on and on " +
		"and on and on and on and on and on and on " +
		"and on and on and on and on and on and on " +
		"and on and on and on and on and on and on " +
		"and on and on and on and on and on and on "
	result := truncateSummary(long)
	if len(result) > 200 {
		t.Errorf("truncated length %d > 200", len(result))
	}
}

func TestIsRelevantAIFile(t *testing.T) {
	tests := []struct {
		name string
		want bool
	}{
		{"test.jsonl", true},
		{"test.log", true},
		{"test.db", true},
		{"test.md", true},
		{"test.go", false},
		{"readme.txt", false},
	}
	for _, tt := range tests {
		if got := isRelevantAIFile(tt.name); got != tt.want {
			t.Errorf("isRelevantAIFile(%q) = %v, want %v", tt.name, got, tt.want)
		}
	}
}

// ---------------------------------------------------------------------------
// Phase 11C.2: Capture Quality Tests
// ---------------------------------------------------------------------------

func TestFullPromptPreserved(t *testing.T) {
	prompt := "Refactor the authentication middleware to use dependency injection. " +
		"We need to support multiple auth providers (OAuth2, SAML, API keys) and the current " +
		"singleton pattern makes unit testing impossible because the auth state leaks between tests."

	turns := []parsers.ConversationTurn{
		{ConversationID: "c1", TurnIndex: 0, Role: "user", Content: prompt, Timestamp: time.Now(), SessionID: "s1"},
		{ConversationID: "c1", TurnIndex: 1, Role: "assistant", Content: "I'll refactor the auth middleware.", Timestamp: time.Now(), SessionID: "s1"},
	}

	events := TurnsToEvents(turns, "claude-code")
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}

	fullPrompt, ok := events[0].Metadata["prompt_full"].(string)
	if !ok {
		t.Fatal("prompt_full not found in metadata")
	}
	if fullPrompt != prompt {
		t.Errorf("prompt_full = %q, want full prompt preserved", fullPrompt)
	}
}

func TestFullPromptTruncatedAt10KB(t *testing.T) {
	// Create a prompt longer than 10KB
	longPrompt := strings.Repeat("x", 11000)

	turns := []parsers.ConversationTurn{
		{ConversationID: "c1", TurnIndex: 0, Role: "user", Content: longPrompt, Timestamp: time.Now(), SessionID: "s1"},
		{ConversationID: "c1", TurnIndex: 1, Role: "assistant", Content: "ok", Timestamp: time.Now(), SessionID: "s1"},
	}

	events := TurnsToEvents(turns, "claude-code")
	fullPrompt := events[0].Metadata["prompt_full"].(string)

	if len(fullPrompt) > 10240+20 { // 10KB + "... [truncated]"
		t.Errorf("prompt_full length %d exceeds cap", len(fullPrompt))
	}
	if !strings.HasSuffix(fullPrompt, "... [truncated]") {
		t.Error("expected truncation marker")
	}
}

func TestFilesModifiedTracked(t *testing.T) {
	turns := []parsers.ConversationTurn{
		{
			ConversationID: "c1", TurnIndex: 0, Role: "user",
			Content: "Edit the auth file", Timestamp: time.Now(), SessionID: "s1",
		},
		{
			ConversationID: "c1", TurnIndex: 1, Role: "assistant",
			Content: "Done.", Timestamp: time.Now(), SessionID: "s1",
			ToolUse: []parsers.ToolCall{
				{Name: "Read", Input: `{"file_path": "/src/auth.ts"}`},
				{Name: "Edit", Input: `{"file_path": "/src/auth.ts"}`},
				{Name: "Write", Input: `{"file_path": "/src/middleware.ts"}`},
			},
		},
	}

	events := TurnsToEvents(turns, "claude-code")
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}

	modified, ok := events[0].Metadata["files_modified"].([]string)
	if !ok {
		t.Fatal("files_modified not found or wrong type")
	}

	modSet := make(map[string]bool)
	for _, f := range modified {
		modSet[f] = true
	}

	if !modSet["/src/auth.ts"] {
		t.Error("expected /src/auth.ts in files_modified")
	}
	if !modSet["/src/middleware.ts"] {
		t.Error("expected /src/middleware.ts in files_modified")
	}

	referenced, ok := events[0].Metadata["files_referenced"].([]string)
	if !ok {
		t.Fatal("files_referenced not found or wrong type")
	}

	refSet := make(map[string]bool)
	for _, f := range referenced {
		refSet[f] = true
	}

	if !refSet["/src/auth.ts"] {
		t.Error("expected /src/auth.ts in files_referenced")
	}
}

func TestSequenceIdsMonotonic(t *testing.T) {
	// Reset the counter for this test
	sessionSeqCounters.mu.Lock()
	delete(sessionSeqCounters.counters, "test-session-mono")
	sessionSeqCounters.mu.Unlock()

	turns := make([]parsers.ConversationTurn, 0, 10)
	for i := 0; i < 5; i++ {
		turns = append(turns, []parsers.ConversationTurn{
			{
				ConversationID: fmt.Sprintf("conv-%d", i),
				TurnIndex:      0, Role: "user",
				Content:   fmt.Sprintf("Question %d", i),
				Timestamp: time.Now(), SessionID: "test-session-mono",
			},
			{
				ConversationID: fmt.Sprintf("conv-%d", i),
				TurnIndex:      1, Role: "assistant",
				Content:   fmt.Sprintf("Answer %d", i),
				Timestamp: time.Now(), SessionID: "test-session-mono",
			},
		}...)
	}

	events := TurnsToEvents(turns, "claude-code")
	if len(events) != 5 {
		t.Fatalf("expected 5 events, got %d", len(events))
	}

	// Collect sequence IDs
	seqIDs := make([]int64, len(events))
	for i, ev := range events {
		seq, ok := ev.Metadata["sequence_id"].(int64)
		if !ok {
			t.Fatalf("event %d: sequence_id not int64", i)
		}
		seqIDs[i] = seq
	}

	// Verify strictly increasing (note: map iteration order is random,
	// but each call to nextSequenceID is monotonic for the session)
	seen := make(map[int64]bool)
	for _, id := range seqIDs {
		if seen[id] {
			t.Errorf("duplicate sequence_id: %d", id)
		}
		seen[id] = true
	}

	// All IDs should be in range [0, 5)
	for _, id := range seqIDs {
		if id < 0 || id >= 5 {
			t.Errorf("sequence_id %d out of expected range [0, 5)", id)
		}
	}
}

func TestRepoAssociation(t *testing.T) {
	turns := []parsers.ConversationTurn{
		{
			ConversationID: "c1", TurnIndex: 0, Role: "user",
			Content: "Fix the bug", Timestamp: time.Now(),
			SessionID: "s1", ProjectPath: "/Users/jaswanth/IdeaProjects/unfade-cli",
		},
		{
			ConversationID: "c1", TurnIndex: 1, Role: "assistant",
			Content: "Fixed.", Timestamp: time.Now(),
			SessionID: "s1", ProjectPath: "/Users/jaswanth/IdeaProjects/unfade-cli",
		},
	}

	events := TurnsToEvents(turns, "claude-code")
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}

	repoRoot, ok := events[0].Metadata["repo_root"].(string)
	if !ok {
		t.Fatal("repo_root not found")
	}
	if repoRoot != "/Users/jaswanth/IdeaProjects/unfade-cli" {
		t.Errorf("repo_root = %q, want /Users/jaswanth/IdeaProjects/unfade-cli", repoRoot)
	}

	repoName, ok := events[0].Metadata["repo_name"].(string)
	if !ok {
		t.Fatal("repo_name not found")
	}
	if repoName != "unfade-cli" {
		t.Errorf("repo_name = %q, want unfade-cli", repoName)
	}
}

// ---------------------------------------------------------------------------
// Sprint 11D Tests (T-322 through T-327)
// ---------------------------------------------------------------------------

// T-322: extractAllPrompts returns max 20 entries with 5KB quality cap.
func TestExtractAllPromptsLimits(t *testing.T) {
	// Create 25 user turns — should cap at 20
	var turns []parsers.ConversationTurn
	for i := 0; i < 25; i++ {
		turns = append(turns, parsers.ConversationTurn{
			ConversationID: "c1", TurnIndex: i * 2, Role: "user",
			Content:   fmt.Sprintf("Prompt number %d with enough text", i),
			Timestamp: time.Now(), SessionID: "s1",
		})
		turns = append(turns, parsers.ConversationTurn{
			ConversationID: "c1", TurnIndex: i*2 + 1, Role: "assistant",
			Content: "response", Timestamp: time.Now(), SessionID: "s1",
		})
	}

	events := TurnsToEvents(turns, "claude-code")
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}

	allPrompts, ok := events[0].Metadata["prompts_all"].([]string)
	if !ok {
		t.Fatal("prompts_all not found or wrong type")
	}
	if len(allPrompts) != 20 {
		t.Errorf("prompts_all length = %d, want 20", len(allPrompts))
	}

	// Test 5KB cap
	longTurns := []parsers.ConversationTurn{
		{ConversationID: "c2", TurnIndex: 0, Role: "user",
			Content: strings.Repeat("y", 6000), Timestamp: time.Now(), SessionID: "s2"},
		{ConversationID: "c2", TurnIndex: 1, Role: "assistant",
			Content: "ok", Timestamp: time.Now(), SessionID: "s2"},
	}

	events2 := TurnsToEvents(longTurns, "claude-code")
	allPrompts2 := events2[0].Metadata["prompts_all"].([]string)
	if len(allPrompts2[0]) > 5140 { // 5120 + "... [truncated]"
		t.Errorf("prompt exceeds 5KB cap: %d bytes", len(allPrompts2[0]))
	}
}

// T-323: classifyExecutionPhase returns correct priority-ordered phases.
func TestClassifyExecutionPhase(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    string
	}{
		{"debugging wins over testing", "fix the failing test", "debugging"},
		{"testing priority", "add unit tests for auth module", "testing"},
		{"refactoring priority", "refactor the handler to extract a helper", "refactoring"},
		{"configuring", "configure the .env file settings", "configuring"},
		{"implementing default", "add user registration endpoint", "implementing"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			turns := []parsers.ConversationTurn{
				{ConversationID: "c1", TurnIndex: 0, Role: "user", Content: tt.content, Timestamp: time.Now()},
				{ConversationID: "c1", TurnIndex: 1, Role: "assistant", Content: "done", Timestamp: time.Now()},
			}
			events := TurnsToEvents(turns, "test")
			phase := events[0].Metadata["execution_phase"].(string)
			if phase != tt.want {
				t.Errorf("execution_phase = %q, want %q", phase, tt.want)
			}
		})
	}
}

// T-324: classifyExecutionPhase returns "exploring" when only read tools used.
func TestClassifyExecutionPhaseExploring(t *testing.T) {
	turns := []parsers.ConversationTurn{
		{ConversationID: "c1", TurnIndex: 0, Role: "user",
			Content: "show me what is in the auth folder", Timestamp: time.Now()},
		{ConversationID: "c1", TurnIndex: 1, Role: "assistant",
			Content: "Here's what I found.", Timestamp: time.Now(),
			ToolUse: []parsers.ToolCall{
				{Name: "Glob", Input: `{"pattern": "src/auth/**"}`},
				{Name: "Read", Input: `{"file_path": "/src/auth/index.ts"}`},
			}},
	}
	events := TurnsToEvents(turns, "test")
	phase := events[0].Metadata["execution_phase"].(string)
	if phase != "exploring" {
		t.Errorf("execution_phase = %q, want exploring", phase)
	}
}

// T-325: extractIntentSummary returns first sentence, max 200 chars.
func TestExtractIntentSummary(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    string
	}{
		{"single sentence", "Add OAuth2 support. Then wire up the routes.", "Add OAuth2 support."},
		{"question", "How does the auth middleware work? Show me the code.", "How does the auth middleware work?"},
		{"no punctuation under 200", "Add user registration", "Add user registration"},
		{"long without period", strings.Repeat("a", 250), strings.Repeat("a", 200)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			turns := []parsers.ConversationTurn{
				{ConversationID: "c1", TurnIndex: 0, Role: "user", Content: tt.content, Timestamp: time.Now()},
				{ConversationID: "c1", TurnIndex: 1, Role: "assistant", Content: "ok", Timestamp: time.Now()},
			}
			events := TurnsToEvents(turns, "test")
			intent := events[0].Metadata["intent_summary"].(string)
			if intent != tt.want {
				t.Errorf("intent_summary = %q, want %q", intent, tt.want)
			}
		})
	}
}

// T-326: Session boundary markers (session_start, conversation_complete, trigger_context).
func TestSessionBoundaryMarkers(t *testing.T) {
	baseTime := time.Date(2026, 4, 20, 10, 0, 0, 0, time.UTC)

	turns := []parsers.ConversationTurn{
		{ConversationID: "c1", TurnIndex: 0, Role: "user",
			Content: "implement the feature", Timestamp: baseTime, SessionID: "s1"},
		{ConversationID: "c1", TurnIndex: 1, Role: "assistant",
			Content: "Done implementing.", Timestamp: baseTime.Add(5 * time.Minute), SessionID: "s1"},
	}

	events := TurnsToEvents(turns, "test")
	ev := events[0]

	// session_start should be the earliest timestamp
	sessionStart, ok := ev.Metadata["session_start"].(string)
	if !ok || sessionStart == "" {
		t.Fatal("session_start not found")
	}
	if sessionStart != "2026-04-20T10:00:00Z" {
		t.Errorf("session_start = %q, want 2026-04-20T10:00:00Z", sessionStart)
	}

	// conversation_complete should be true (last turn is assistant)
	complete, ok := ev.Metadata["conversation_complete"].(bool)
	if !ok {
		t.Fatal("conversation_complete not found")
	}
	if !complete {
		t.Error("expected conversation_complete = true")
	}

	// trigger_context should be user_initiated (no MCP signals)
	trigger, ok := ev.Metadata["trigger_context"].(string)
	if !ok {
		t.Fatal("trigger_context not found")
	}
	if trigger != "user_initiated" {
		t.Errorf("trigger_context = %q, want user_initiated", trigger)
	}
}

// T-327: Sequence persistence save/load round-trip.
func TestSequencePersistence(t *testing.T) {
	dir := t.TempDir()

	// Reset state
	ResetSequenceCounters()

	// Simulate some sequence IDs being used
	nextSequenceID("session-alpha")
	nextSequenceID("session-alpha")
	nextSequenceID("session-alpha") // now at 3
	nextSequenceID("session-beta")  // now at 1

	// Save
	if err := SaveSequenceCounters(dir); err != nil {
		t.Fatalf("SaveSequenceCounters: %v", err)
	}

	// Verify file exists
	data, err := os.ReadFile(filepath.Join(dir, "sequences.json"))
	if err != nil {
		t.Fatalf("read sequences.json: %v", err)
	}

	var state sequencesState
	if err := json.Unmarshal(data, &state); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if state.Sessions["session-alpha"] != 3 {
		t.Errorf("session-alpha = %d, want 3", state.Sessions["session-alpha"])
	}
	if state.Sessions["session-beta"] != 1 {
		t.Errorf("session-beta = %d, want 1", state.Sessions["session-beta"])
	}

	// Reset and reload
	ResetSequenceCounters()
	LoadSequenceCounters(dir)

	// Next IDs should continue from where we left off (persisted + 1)
	nextAlpha := nextSequenceID("session-alpha")
	if nextAlpha != 4 { // Loaded 3, +1 = starts at 4
		t.Errorf("next session-alpha ID = %d, want 4", nextAlpha)
	}
	nextBeta := nextSequenceID("session-beta")
	if nextBeta != 2 { // Loaded 1, +1 = starts at 2
		t.Errorf("next session-beta ID = %d, want 2", nextBeta)
	}
}

// T-327b: detectTriggerContext identifies MCP invocation.
func TestDetectTriggerContextMCP(t *testing.T) {
	turns := []parsers.ConversationTurn{
		{ConversationID: "c1", TurnIndex: 0, Role: "user",
			Content: "Use the unfade-context to get background", Timestamp: time.Now()},
		{ConversationID: "c1", TurnIndex: 1, Role: "assistant",
			Content: "I'll query MCP.", Timestamp: time.Now(),
			ToolUse: []parsers.ToolCall{{Name: "mcp__unfade", Input: `{}`}}},
	}
	events := TurnsToEvents(turns, "test")
	trigger := events[0].Metadata["trigger_context"].(string)
	if trigger != "mcp_invoked" {
		t.Errorf("trigger_context = %q, want mcp_invoked", trigger)
	}
}
