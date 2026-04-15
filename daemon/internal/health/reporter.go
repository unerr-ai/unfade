// FILE: daemon/internal/health/reporter.go
// Health reporter writes health.json every 30 seconds via atomic tmp+rename.
// Never produces partial JSON — readers always see a complete snapshot.

package health

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// HealthStatus is the JSON schema written to health.json.
type HealthStatus struct {
	Status        string            `json:"status"`
	PID           int               `json:"pid"`
	UptimeSeconds int64             `json:"uptime_seconds"`
	Watchers      map[string][]string `json:"watchers"`
	EventsToday   int               `json:"events_today"`
	MemoryMB      float64           `json:"memory_mb"`
	Version       string            `json:"version"`
}

// HealthLogger is the logging interface used by the reporter.
type HealthLogger interface {
	Debug(msg string, fields ...map[string]any)
	Error(msg string, fields ...map[string]any)
}

// Reporter periodically writes health.json to the state directory.
type Reporter struct {
	stateDir  string
	startTime time.Time
	version   string
	logger    HealthLogger
	done      chan struct{}

	// Callbacks to gather live data.
	getBudget    func() BudgetStatus
	getWatchers  func() map[string][]string
	countEvents  func() int
}

// ReporterConfig holds configuration for the health reporter.
type ReporterConfig struct {
	StateDir string
	Version  string
	Logger   HealthLogger
	Interval time.Duration // Default: 30s

	// Optional callbacks — nil-safe (return zero values).
	GetBudget   func() BudgetStatus
	GetWatchers func() map[string][]string
	CountEvents func() int
}

// NewReporter creates a health reporter.
func NewReporter(cfg ReporterConfig) *Reporter {
	if cfg.Interval == 0 {
		cfg.Interval = 30 * time.Second
	}
	return &Reporter{
		stateDir:    cfg.StateDir,
		startTime:   time.Now(),
		version:     cfg.Version,
		logger:      cfg.Logger,
		done:        make(chan struct{}),
		getBudget:   cfg.GetBudget,
		getWatchers: cfg.GetWatchers,
		countEvents: cfg.CountEvents,
	}
}

// Start begins periodic health reporting. Non-blocking — runs in a goroutine.
func (r *Reporter) Start(interval time.Duration) {
	// Write immediately on start.
	r.write()

	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-r.done:
				return
			case <-ticker.C:
				r.write()
			}
		}
	}()
}

// Stop halts the health reporter.
func (r *Reporter) Stop() {
	close(r.done)
}

// WriteOnce writes a single health snapshot (used during shutdown).
func (r *Reporter) WriteOnce(status string) {
	r.writeWithStatus(status)
}

func (r *Reporter) write() {
	r.writeWithStatus("running")
}

func (r *Reporter) writeWithStatus(status string) {
	var budget BudgetStatus
	if r.getBudget != nil {
		budget = r.getBudget()
	}

	watchers := map[string][]string{"git": {}, "ai_session": {}}
	if r.getWatchers != nil {
		w := r.getWatchers()
		if w != nil {
			watchers = w
		}
	}

	eventsToday := 0
	if r.countEvents != nil {
		eventsToday = r.countEvents()
	}

	h := HealthStatus{
		Status:        status,
		PID:           os.Getpid(),
		UptimeSeconds: int64(time.Since(r.startTime).Seconds()),
		Watchers:      watchers,
		EventsToday:   eventsToday,
		MemoryMB:      budget.MemoryMB,
		Version:       r.version,
	}

	data, err := json.MarshalIndent(h, "", "  ")
	if err != nil {
		r.logger.Error("failed to marshal health.json", map[string]any{"error": err.Error()})
		return
	}
	data = append(data, '\n')

	// Atomic write: write to tmp file, then rename.
	if err := os.MkdirAll(r.stateDir, 0o755); err != nil {
		r.logger.Error("failed to create state directory", map[string]any{"error": err.Error()})
		return
	}

	healthPath := filepath.Join(r.stateDir, "health.json")
	tmpPath := healthPath + ".tmp"

	if err := os.WriteFile(tmpPath, data, 0o644); err != nil {
		r.logger.Error("failed to write health.json.tmp", map[string]any{"error": err.Error()})
		return
	}

	if err := os.Rename(tmpPath, healthPath); err != nil {
		r.logger.Error("failed to rename health.json.tmp", map[string]any{"error": err.Error()})
		_ = os.Remove(tmpPath)
	}
}

// RemoveHealthFile removes health.json (called during shutdown).
func RemoveHealthFile(stateDir string) {
	_ = os.Remove(filepath.Join(stateDir, "health.json"))
	_ = os.Remove(fmt.Sprintf("%s/health.json.tmp", stateDir))
}
