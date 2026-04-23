package parsers

import "time"

// DataSource represents a discovered AI tool data file or database on disk.
type DataSource struct {
	Tool    string // "claude-code", "cursor", "codex", "aider"
	Path    string // Absolute path to the file or database
	Format  string // "jsonl", "sqlite", "markdown"
	Project string // Project directory path, if determinable
}

// ToolCall represents a tool/function invocation recorded in an AI conversation.
type ToolCall struct {
	Name  string `json:"name"`
	Input string `json:"input,omitempty"`
}

// ConversationTurn is the normalized intermediate representation of one turn
// in any AI tool's conversation log. All parsers emit this common struct;
// the downstream classifier and event emitter operate on this form exclusively.
type ConversationTurn struct {
	SessionID      string         `json:"session_id"`
	ConversationID string         `json:"conversation_id"`
	TurnIndex      int            `json:"turn_index"`
	TotalTurns     int            `json:"total_turns"`
	Role           string         `json:"role"` // "user", "assistant", "system", "summary", "commit"
	Content        string         `json:"content"`
	Timestamp      time.Time      `json:"timestamp"`
	GitBranch      string         `json:"git_branch,omitempty"`
	ProjectPath    string         `json:"project_path,omitempty"`
	ParentID       string         `json:"parent_id,omitempty"`
	ToolUse        []ToolCall     `json:"tool_use,omitempty"`
	Metadata       map[string]any `json:"metadata,omitempty"`
}

// AIToolParser is the interface every AI tool parser implements.
// Each parser understands one tool's native data format and produces
// normalized ConversationTurn structs.
type AIToolParser interface {
	// Name returns the parser identifier (e.g. "claude-code", "cursor").
	Name() string

	// Discover scans the filesystem for this tool's data files/databases.
	// Returns empty slice (not error) when the tool is not installed.
	Discover() []DataSource

	// Parse reads a data source from scratch, returning all conversation
	// turns whose timestamp >= since. Used for historical ingest.
	Parse(source DataSource, since time.Time) ([]ConversationTurn, error)

	// Tail reads incremental data appended since the given byte offset
	// (or row watermark for databases). Returns new turns and the updated
	// offset for the next call. Used for live monitoring.
	Tail(source DataSource, offset int64) ([]ConversationTurn, int64, error)
}
