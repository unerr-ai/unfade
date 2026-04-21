// FILE: daemon/internal/capture/event.go
// CaptureEvent — Go struct mirroring src/schemas/event.ts (Zod).
// Any changes here MUST be synchronized with the TypeScript schema.
// The daemon writes these as JSON to ~/.unfade/events/YYYY-MM-DD.jsonl.

package capture

// CaptureEvent is the universal event format written by the daemon.
// Field names use camelCase JSON tags to match the TypeScript schema exactly.
type CaptureEvent struct {
	ID         string         `json:"id"`
	ProjectID  string         `json:"projectId"`
	Timestamp  string         `json:"timestamp"`
	Source     string         `json:"source"` // git | ai-session | terminal | browser | manual | mcp-active
	Type       string         `json:"type"`   // commit | diff | branch-switch | ...
	Content    EventContent   `json:"content"`
	GitContext *GitContext    `json:"gitContext,omitempty"`
	Metadata   map[string]any `json:"metadata,omitempty"`
}

// EventContent holds the primary payload of a capture event.
type EventContent struct {
	Summary string   `json:"summary"`
	Detail  string   `json:"detail,omitempty"`
	Files   []string `json:"files,omitempty"`
	Branch  string   `json:"branch,omitempty"`
	Project string   `json:"project,omitempty"`
}

// GitContext provides repository context for git-sourced events.
type GitContext struct {
	Repo       string `json:"repo"`
	Branch     string `json:"branch"`
	CommitHash string `json:"commitHash,omitempty"`
}
