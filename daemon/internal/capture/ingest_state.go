package capture

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// IngestSourceProgress tracks per-tool progress during historical ingest.
type IngestSourceProgress struct {
	Tool            string `json:"tool"`
	FilesDiscovered int    `json:"files_discovered"`
	FilesProcessed  int    `json:"files_processed"`
	EventsEmitted   int    `json:"events_emitted"`
	Errors          int    `json:"errors"`
}

// IngestState is the persistent progress record for historical ingest.
// Written atomically to .unfade/state/ingest.json.
type IngestState struct {
	Status      string                 `json:"status"` // "idle", "running", "completed", "failed"
	StartedAt   string                 `json:"started_at,omitempty"`
	CompletedAt string                 `json:"completed_at,omitempty"`
	Since       string                 `json:"since"`
	Until       string                 `json:"until"`
	Sources     []IngestSourceProgress `json:"sources"`
	TotalEvents int                    `json:"total_events"`
	Error       string                 `json:"error,omitempty"`
	Processed   map[string]bool        `json:"processed,omitempty"`
}

// IngestStateManager provides thread-safe access to IngestState with
// atomic persistence (write to temp file → rename).
type IngestStateManager struct {
	path  string
	mu    sync.RWMutex
	state IngestState
}

// NewIngestStateManager creates a manager that persists state to the given path.
// Loads existing state from disk if present.
func NewIngestStateManager(stateDir string) *IngestStateManager {
	path := filepath.Join(stateDir, "ingest.json")
	m := &IngestStateManager{
		path: path,
		state: IngestState{
			Status:    "idle",
			Processed: make(map[string]bool),
		},
	}
	m.load()
	return m
}

func (m *IngestStateManager) load() {
	data, err := os.ReadFile(m.path)
	if err != nil {
		return
	}
	var s IngestState
	if err := json.Unmarshal(data, &s); err != nil {
		return
	}
	if s.Processed == nil {
		s.Processed = make(map[string]bool)
	}
	m.state = s
}

// Get returns a snapshot of the current state.
func (m *IngestStateManager) Get() IngestState {
	m.mu.RLock()
	defer m.mu.RUnlock()
	cp := m.state
	if m.state.Sources != nil {
		cp.Sources = make([]IngestSourceProgress, len(m.state.Sources))
		copy(cp.Sources, m.state.Sources)
	}
	if m.state.Processed != nil {
		cp.Processed = make(map[string]bool, len(m.state.Processed))
		for k, v := range m.state.Processed {
			cp.Processed[k] = v
		}
	}
	return cp
}

// MarkRunning transitions state to "running" with the given timeline.
// Preserves the Processed map so resumable ingests can skip already-done files.
func (m *IngestStateManager) MarkRunning(since, until time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.state.Status = "running"
	m.state.StartedAt = time.Now().UTC().Format(time.RFC3339)
	m.state.CompletedAt = ""
	m.state.Since = since.UTC().Format(time.RFC3339)
	m.state.Until = until.UTC().Format(time.RFC3339)
	m.state.Sources = nil
	m.state.TotalEvents = 0
	m.state.Error = ""
	if m.state.Processed == nil {
		m.state.Processed = make(map[string]bool)
	}
	m.save()
}

// SetSources initializes the per-tool progress entries.
func (m *IngestStateManager) SetSources(sources []IngestSourceProgress) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.state.Sources = sources
	m.save()
}

// RecordFileProcessed marks a file as done and increments counters.
func (m *IngestStateManager) RecordFileProcessed(tool, path string, events int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.state.Processed[path] = true
	m.state.TotalEvents += events
	for i := range m.state.Sources {
		if m.state.Sources[i].Tool == tool {
			m.state.Sources[i].FilesProcessed++
			m.state.Sources[i].EventsEmitted += events
			break
		}
	}
	m.save()
}

// RecordError increments the error count for a tool.
func (m *IngestStateManager) RecordError(tool string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Sources {
		if m.state.Sources[i].Tool == tool {
			m.state.Sources[i].Errors++
			break
		}
	}
	m.save()
}

// IsProcessed returns true if the given path was already processed.
func (m *IngestStateManager) IsProcessed(path string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.state.Processed[path]
}

// MarkCompleted transitions state to "completed".
func (m *IngestStateManager) MarkCompleted() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.state.Status = "completed"
	m.state.CompletedAt = time.Now().UTC().Format(time.RFC3339)
	m.save()
}

// MarkFailed transitions state to "failed" with an error message.
func (m *IngestStateManager) MarkFailed(errMsg string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.state.Status = "failed"
	m.state.CompletedAt = time.Now().UTC().Format(time.RFC3339)
	m.state.Error = errMsg
	m.save()
}

// save writes state to disk atomically: temp file → rename.
// Caller must hold m.mu.
func (m *IngestStateManager) save() {
	dir := filepath.Dir(m.path)
	_ = os.MkdirAll(dir, 0o755)

	data, err := json.MarshalIndent(m.state, "", "  ")
	if err != nil {
		return
	}

	tmp := m.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return
	}
	_ = os.Rename(tmp, m.path)
}
