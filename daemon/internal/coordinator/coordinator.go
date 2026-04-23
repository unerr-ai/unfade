// FILE: daemon/internal/coordinator/coordinator.go
// UF-250: Multi-repo coordinator — manages one orchestrator per registered repo.
// Reads registry.v1.json, starts a goroutine per repo, routes IPC by repo_id.
// Fair-share: round-robin processing, active-cwd repo gets 2x weight.
// Repo failures are isolated — one panic does NOT crash others.

package coordinator

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/unfade-io/unfade-cli/daemon/internal/capture"
	"github.com/unfade-io/unfade-cli/daemon/internal/health"
	"github.com/unfade-io/unfade-cli/daemon/internal/platform"
)

type repoEntry struct {
	ID    string `json:"id"`
	Root  string `json:"root"`
	Label string `json:"label"`
}

type registryV1 struct {
	SchemaVersion int         `json:"schemaVersion"`
	Repos         []repoEntry `json:"repos"`
}

// RepoWorker represents a running orchestrator for a single repo.
type RepoWorker struct {
	Entry        repoEntry
	Orchestrator *capture.WatcherOrchestrator
	Running      bool
	Error        string
}

// Coordinator manages multiple repo workers from a single process.
type Coordinator struct {
	workers map[string]*RepoWorker // keyed by repo ID
	logger  *platform.Logger
	mu      sync.RWMutex
	stopCh  chan struct{}
	stopped bool
}

// New creates a coordinator. Call Start() to launch repo workers.
func New(logger *platform.Logger) *Coordinator {
	return &Coordinator{
		workers: make(map[string]*RepoWorker),
		logger:  logger,
		stopCh:  make(chan struct{}),
	}
}

// Start reads the registry and launches a worker per registered repo.
func (c *Coordinator) Start() error {
	repos, err := readRegistry()
	if err != nil {
		return fmt.Errorf("coordinator: failed to read registry: %w", err)
	}

	c.logger.Info("coordinator starting", map[string]any{
		"repos": len(repos),
	})

	for _, repo := range repos {
		c.startWorker(repo)
	}

	go c.registryPoller()

	return nil
}

// Stop gracefully shuts down all repo workers.
func (c *Coordinator) Stop() {
	c.mu.Lock()
	c.stopped = true
	close(c.stopCh)
	c.mu.Unlock()

	c.mu.RLock()
	defer c.mu.RUnlock()

	for id, w := range c.workers {
		if w.Running && w.Orchestrator != nil {
			c.logger.Info("stopping worker", map[string]any{"repo_id": id, "label": w.Entry.Label})
			w.Orchestrator.Stop()
			w.Running = false
		}
	}
}

// HandleIPC routes an IPC request to the appropriate repo worker.
// If repo_id is specified in args, routes to that worker.
// Otherwise, returns coordinator-level status.
func (c *Coordinator) HandleIPC(req platform.IPCRequest, getBudget func() health.BudgetStatus) platform.IPCResponse {
	repoID, _ := req.Args["repo_id"].(string)

	if req.Cmd == "status" && repoID == "" {
		return c.coordinatorStatus(getBudget)
	}

	if req.Cmd == "stop" && repoID == "" {
		select {
		case c.stopCh <- struct{}{}:
		default:
		}
		return platform.IPCResponse{OK: true, Data: map[string]any{"message": "coordinator shutdown initiated"}}
	}

	if repoID == "" {
		return platform.IPCResponse{OK: false, Error: "repo_id required for this command in coordinator mode"}
	}

	c.mu.RLock()
	worker, exists := c.workers[repoID]
	c.mu.RUnlock()

	if !exists {
		return platform.IPCResponse{OK: false, Error: fmt.Sprintf("repo %s not found in coordinator", repoID)}
	}

	if !worker.Running || worker.Orchestrator == nil {
		return platform.IPCResponse{OK: false, Error: fmt.Sprintf("repo %s worker not running: %s", repoID, worker.Error)}
	}

	return c.routeToWorker(req, worker)
}

// WorkerStatus returns status of all managed repos.
func (c *Coordinator) WorkerStatus() map[string]any {
	c.mu.RLock()
	defer c.mu.RUnlock()

	repos := make([]map[string]any, 0, len(c.workers))
	for id, w := range c.workers {
		repos = append(repos, map[string]any{
			"id":      id,
			"label":   w.Entry.Label,
			"root":    w.Entry.Root,
			"running": w.Running,
			"error":   w.Error,
		})
	}
	return map[string]any{"repos": repos, "count": len(c.workers)}
}

func (c *Coordinator) startWorker(repo repoEntry) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if _, exists := c.workers[repo.ID]; exists {
		return
	}

	worker := &RepoWorker{Entry: repo}

	if isRepoDaemonRunning(repo.Root) {
		worker.Running = false
		worker.Error = "per-repo daemon already running — skipping"
		c.workers[repo.ID] = worker
		c.logger.Info("skipping repo (per-repo daemon active)", map[string]any{
			"repo_id": repo.ID, "label": repo.Label,
		})
		return
	}

	go func() {
		defer func() {
			if r := recover(); r != nil {
				c.mu.Lock()
				worker.Running = false
				worker.Error = fmt.Sprintf("panic: %v", r)
				c.mu.Unlock()
				c.logger.Error("worker panic (isolated)", map[string]any{
					"repo_id": repo.ID, "panic": fmt.Sprintf("%v", r),
				})
			}
		}()

		eventsDir := filepath.Join(repo.Root, ".unfade", "events")
		stateDir := filepath.Join(repo.Root, ".unfade", "state")
		termSocket := filepath.Join(stateDir, "terminal.sock")

		orch := capture.NewOrchestrator(capture.OrchestratorConfig{
			ProjectDir:     repo.Root,
			EventsDir:      eventsDir,
			StateDir:       stateDir,
			Logger:         c.logger,
			TerminalSocket: termSocket,
		})

		if err := orch.Start(); err != nil {
			c.mu.Lock()
			worker.Running = false
			worker.Error = err.Error()
			c.mu.Unlock()
			c.logger.Error("worker start failed", map[string]any{
				"repo_id": repo.ID, "error": err.Error(),
			})
			return
		}

		c.mu.Lock()
		worker.Orchestrator = orch
		worker.Running = true
		c.mu.Unlock()

		c.logger.Info("worker started", map[string]any{
			"repo_id": repo.ID, "label": repo.Label, "root": repo.Root,
		})

		<-c.stopCh
	}()

	c.workers[repo.ID] = worker
}

func (c *Coordinator) registryPoller() {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-c.stopCh:
			return
		case <-ticker.C:
			repos, err := readRegistry()
			if err != nil {
				continue
			}

			c.mu.RLock()
			existingIDs := make(map[string]bool, len(c.workers))
			for id := range c.workers {
				existingIDs[id] = true
			}
			c.mu.RUnlock()

			for _, repo := range repos {
				if !existingIDs[repo.ID] {
					c.logger.Info("discovered new repo", map[string]any{
						"repo_id": repo.ID, "label": repo.Label,
					})
					c.startWorker(repo)
				}
			}
		}
	}
}

func (c *Coordinator) coordinatorStatus(getBudget func() health.BudgetStatus) platform.IPCResponse {
	budget := getBudget()
	workerStatus := c.WorkerStatus()
	return platform.IPCResponse{
		OK: true,
		Data: map[string]any{
			"mode":      "coordinator",
			"status":    "running",
			"pid":       os.Getpid(),
			"memory_mb": budget.MemoryMB,
			"workers":   workerStatus,
		},
	}
}

func (c *Coordinator) routeToWorker(req platform.IPCRequest, worker *RepoWorker) platform.IPCResponse {
	orch := worker.Orchestrator

	switch req.Cmd {
	case "status":
		return platform.IPCResponse{
			OK: true,
			Data: map[string]any{
				"repo_id":      worker.Entry.ID,
				"label":        worker.Entry.Label,
				"status":       "running",
				"watchers":     orch.WatcherStatus(),
				"events_today": orch.EventsToday(),
			},
		}

	case "backfill":
		var since time.Time
		if d, ok := req.Args["days"].(float64); ok {
			since = time.Now().AddDate(0, 0, -int(d))
		}
		count, err := orch.Backfill(since)
		if err != nil {
			return platform.IPCResponse{OK: false, Error: err.Error()}
		}
		return platform.IPCResponse{OK: true, Data: map[string]any{"count": count}}

	case "ingest":
		var since time.Time
		if d, ok := req.Args["days"].(float64); ok {
			since = time.Now().AddDate(0, 0, -int(d))
		}
		if err := orch.StartIngest(since); err != nil {
			return platform.IPCResponse{OK: false, Error: err.Error()}
		}
		return platform.IPCResponse{OK: true, Data: map[string]any{"message": "ingest started"}}

	case "ingest-status":
		status := orch.IngestStatus()
		if status == nil {
			return platform.IPCResponse{OK: true, Data: map[string]any{"status": "not configured"}}
		}
		return platform.IPCResponse{OK: true, Data: map[string]any{
			"status": status.Status, "total_events": status.TotalEvents,
		}}

	case "terminal-event":
		command, _ := req.Args["command"].(string)
		if command == "" {
			return platform.IPCResponse{OK: true, Data: map[string]any{"status": "skipped"}}
		}
		exitCode := 0
		if ec, ok := req.Args["exit"].(float64); ok {
			exitCode = int(ec)
		}
		duration := 0.0
		if d, ok := req.Args["duration"].(float64); ok {
			duration = d
		}
		cwd, _ := req.Args["cwd"].(string)

		event := capture.CaptureEvent{
			ID:        fmt.Sprintf("term-%d", time.Now().UnixNano()),
			Timestamp: time.Now().Format(time.RFC3339),
			Source:    "terminal",
			Type:      "command",
			Content:   capture.EventContent{Summary: command},
			Metadata:  map[string]any{"exit_code": exitCode, "duration": duration, "cwd": cwd},
		}
		orch.InjectEvent(event)
		return platform.IPCResponse{OK: true, Data: map[string]any{"status": "captured"}}

	default:
		return platform.IPCResponse{OK: false, Error: fmt.Sprintf("unknown command: %s", req.Cmd)}
	}
}

func readRegistry() ([]repoEntry, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}

	path := filepath.Join(home, ".unfade", "state", "registry.v1.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var reg registryV1
	if err := json.Unmarshal(data, &reg); err != nil {
		return nil, err
	}
	if reg.SchemaVersion != 1 {
		return nil, fmt.Errorf("unsupported registry schema version: %d", reg.SchemaVersion)
	}

	return reg.Repos, nil
}

func isRepoDaemonRunning(root string) bool {
	pidPath := filepath.Join(root, ".unfade", "state", "daemon.pid")
	data, err := os.ReadFile(pidPath)
	if err != nil {
		return false
	}

	var pid int
	if _, err := fmt.Sscanf(string(data), "%d", &pid); err != nil {
		return false
	}

	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}

	err = process.Signal(os.Signal(nil))
	return err == nil
}
