// FILE: daemon/cmd/unfaded/main.go
// unfaded — the Unfade capture engine daemon.
// Passive background process that watches git, AI sessions, and terminal activity.
// Writes CaptureEvent JSONL to .unfade/events/.
//
// Startup sequence:
// 1. Acquire flock on PID file — exit if another instance holds the lock
// 2. Start IPC server on Unix domain socket
// 3. Start health reporter goroutine
// 4. Start resource budget monitor
// 5. Register SIGTERM/SIGINT handlers for graceful shutdown
package main

import (
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"github.com/unfade-io/unfade-cli/daemon/internal/capture"
	"github.com/unfade-io/unfade-cli/daemon/internal/coordinator"
	"github.com/unfade-io/unfade-cli/daemon/internal/health"
	"github.com/unfade-io/unfade-cli/daemon/internal/platform"
)

const version = "0.1.0"

func main() {
	var projectDir string
	var verbose bool
	var coordinatorMode bool
	flag.StringVar(&projectDir, "project-dir", "", "Path to the project root (must contain .git)")
	flag.BoolVar(&verbose, "verbose", false, "Enable debug logging")
	flag.BoolVar(&coordinatorMode, "coordinator", false, "Run as multi-repo coordinator (reads registry)")
	flag.Parse()

	if coordinatorMode {
		if os.Getenv("UNFADE_ENTERPRISE") != "true" {
			fmt.Fprintln(os.Stderr, "unfaded: coordinator mode requires Unfade Enterprise. Set UNFADE_ENTERPRISE=true to enable.")
			os.Exit(1)
		}
		runCoordinator(verbose)
		return
	}

	// Determine state directory.
	// If --project-dir is given, use <project>/.unfade/state/
	// Otherwise, use ~/.unfade/state/
	stateDir := resolveStateDir(projectDir)
	logsDir := resolveLogsDir(projectDir)

	// Initialize logger.
	logLevel := platform.LevelInfo
	if verbose {
		logLevel = platform.LevelDebug
	}
	log := platform.NewLogger(logLevel)
	if err := log.SetFile(filepath.Join(logsDir, "daemon.log")); err != nil {
		fmt.Fprintf(os.Stderr, "warning: could not open log file: %v\n", err)
	}
	defer log.Close()

	log.Info("unfaded starting", map[string]any{
		"version":     version,
		"project_dir": projectDir,
		"state_dir":   stateDir,
		"pid":         os.Getpid(),
	})

	// 1. Acquire PID file with flock.
	pidPath := filepath.Join(stateDir, "daemon.pid")
	pidFile, err := platform.AcquirePID(pidPath)
	if err != nil {
		log.Error("failed to acquire PID file", map[string]any{"error": err.Error()})
		fmt.Fprintf(os.Stderr, "unfaded: %v\n", err)
		os.Exit(1)
	}
	defer pidFile.Release()
	log.Info("PID file acquired", map[string]any{"path": pidPath, "pid": os.Getpid()})

	// 2. Start resource budget monitor.
	budgetCfg := health.DefaultBudgetConfig()
	getBudget, stopBudget := health.StartBudgetMonitor(budgetCfg, log)
	defer stopBudget()

	// 3. Start health reporter.
	reporter := health.NewReporter(health.ReporterConfig{
		StateDir:  stateDir,
		Version:   version,
		Logger:    log,
		Interval:  30 * time.Second,
		GetBudget: getBudget,
	})
	reporter.Start(30 * time.Second)
	defer reporter.Stop()
	log.Info("health reporter started", map[string]any{"interval": "30s"})

	// 4. Start capture orchestrator.
	eventsDir := resolveEventsDir(projectDir)
	terminalSocket := filepath.Join(stateDir, "terminal.sock")
	orchestrator := capture.NewOrchestrator(capture.OrchestratorConfig{
		ProjectDir:     projectDir,
		EventsDir:      eventsDir,
		StateDir:       stateDir,
		Logger:         log,
		TerminalSocket: terminalSocket,
	})
	if projectDir != "" {
		if err := orchestrator.Start(); err != nil {
			log.Error("failed to start capture orchestrator", map[string]any{"error": err.Error()})
			fmt.Fprintf(os.Stderr, "unfaded: capture orchestrator error: %v\n", err)
			os.Exit(1)
		}
		defer orchestrator.Stop()
		log.Info("capture orchestrator started", map[string]any{"events_dir": eventsDir})
	} else {
		log.Info("no --project-dir specified, capture orchestrator skipped")
	}

	// 5. Start IPC server.
	socketPath := filepath.Join(stateDir, "daemon.sock")

	// Channel to signal shutdown from IPC "stop" command.
	stopCh := make(chan struct{}, 1)

	ipcHandler := func(req platform.IPCRequest) platform.IPCResponse {
		return handleIPC(req, getBudget, reporter, orchestrator, stopCh)
	}

	ipcServer := platform.NewIPCServer(socketPath, ipcHandler, log)
	if err := ipcServer.Start(); err != nil {
		log.Error("failed to start IPC server", map[string]any{"error": err.Error()})
		fmt.Fprintf(os.Stderr, "unfaded: IPC server error: %v\n", err)
		os.Exit(1)
	}
	defer ipcServer.Stop()
	log.Info("IPC server started", map[string]any{"socket": socketPath})

	// 6. Register signal handlers.
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)

	log.Info("unfaded ready — waiting for signals")

	// Main loop — wait for shutdown signal.
	select {
	case sig := <-sigCh:
		log.Info("received signal, shutting down", map[string]any{"signal": sig.String()})
	case <-stopCh:
		log.Info("received stop command via IPC, shutting down")
	}

	// Graceful shutdown sequence.
	shutdown(log, ipcServer, orchestrator, reporter, pidFile, stateDir)
}

func handleIPC(req platform.IPCRequest, getBudget func() health.BudgetStatus, reporter *health.Reporter, orchestrator *capture.WatcherOrchestrator, stopCh chan struct{}) platform.IPCResponse {
	switch req.Cmd {
	case "status":
		budget := getBudget()
		resp := map[string]any{
			"status":       "running",
			"pid":          os.Getpid(),
			"version":      version,
			"memory_mb":    budget.MemoryMB,
			"events_today": 0,
		}
		if orchestrator != nil {
			resp["watchers"] = orchestrator.WatcherStatus()
			resp["events_today"] = orchestrator.EventsToday()
		}
		return platform.IPCResponse{
			OK:   true,
			Data: resp,
		}

	case "stop":
		// Signal main loop to exit.
		select {
		case stopCh <- struct{}{}:
		default:
		}
		return platform.IPCResponse{
			OK: true,
			Data: map[string]any{
				"message": "shutdown initiated",
			},
		}

	case "backfill":
		if orchestrator == nil {
			return platform.IPCResponse{
				OK:    false,
				Error: "no project directory configured — cannot backfill",
			}
		}

		// Default: 30 days.
		days := 30
		if req.Args != nil {
			if d, ok := req.Args["days"]; ok {
				switch v := d.(type) {
				case float64:
					days = int(v)
				case string:
					if parsed, err := strconv.Atoi(v); err == nil {
						days = parsed
					}
				}
			}
		}

		since := time.Now().AddDate(0, 0, -days)
		count, err := orchestrator.Backfill(since)
		if err != nil {
			return platform.IPCResponse{
				OK:    false,
				Error: fmt.Sprintf("backfill failed: %v", err),
			}
		}

		return platform.IPCResponse{
			OK: true,
			Data: map[string]any{
				"message": fmt.Sprintf("backfilled %d commits from last %d days", count, days),
				"count":   count,
				"days":    days,
			},
		}

	case "ingest":
		if orchestrator == nil {
			return platform.IPCResponse{
				OK:    false,
				Error: "no project directory configured — cannot ingest",
			}
		}

		days := 7
		if req.Args != nil {
			if d, ok := req.Args["days"]; ok {
				switch v := d.(type) {
				case float64:
					days = int(v)
				case string:
					if parsed, err := strconv.Atoi(v); err == nil {
						days = parsed
					}
				}
			}
		}

		since := time.Now().AddDate(0, 0, -days)
		if err := orchestrator.StartIngest(since); err != nil {
			return platform.IPCResponse{
				OK:    false,
				Error: fmt.Sprintf("ingest failed: %v", err),
			}
		}

		return platform.IPCResponse{
			OK: true,
			Data: map[string]any{
				"message": fmt.Sprintf("historical ingest started for last %d days", days),
				"days":    days,
			},
		}

	case "ingest-status":
		if orchestrator == nil {
			return platform.IPCResponse{
				OK:    false,
				Error: "no project directory configured",
			}
		}

		status := orchestrator.IngestStatus()
		if status == nil {
			return platform.IPCResponse{
				OK: true,
				Data: map[string]any{
					"status": "not configured",
				},
			}
		}

		return platform.IPCResponse{
			OK: true,
			Data: map[string]any{
				"status":       status.Status,
				"started_at":   status.StartedAt,
				"completed_at": status.CompletedAt,
				"since":        status.Since,
				"until":        status.Until,
				"total_events": status.TotalEvents,
				"error":        status.Error,
			},
		}

	case "terminal-event":
		if orchestrator == nil {
			return platform.IPCResponse{OK: true, Data: map[string]any{"status": "ignored"}}
		}

		command, _ := req.Args["command"].(string)
		exitCode := 0
		if ec, ok := req.Args["exit"].(float64); ok {
			exitCode = int(ec)
		}
		duration := 0.0
		if d, ok := req.Args["duration"].(float64); ok {
			duration = d
		}
		cwd, _ := req.Args["cwd"].(string)

		if command == "" {
			return platform.IPCResponse{OK: true, Data: map[string]any{"status": "skipped"}}
		}

		event := capture.CaptureEvent{
			ID:        fmt.Sprintf("term-%d", time.Now().UnixNano()),
			Timestamp: time.Now().UTC().Format(time.RFC3339),
			Source:    "terminal",
			Type:      "command",
			Content: capture.EventContent{
				Summary: command,
			},
			Metadata: map[string]any{
				"exit_code": exitCode,
				"duration":  duration,
				"cwd":       cwd,
			},
		}

		if orchestrator != nil {
			orchestrator.InjectEvent(event)
		}

		return platform.IPCResponse{OK: true, Data: map[string]any{"status": "captured"}}

	case "distill":
		return platform.IPCResponse{
			OK: true,
			Data: map[string]any{
				"message": "distill not yet implemented",
			},
		}

	default:
		return platform.IPCResponse{
			OK:    false,
			Error: fmt.Sprintf("unknown command: %s", req.Cmd),
		}
	}
}

func shutdown(log *platform.Logger, ipc *platform.IPCServer, orchestrator *capture.WatcherOrchestrator, reporter *health.Reporter, pid *platform.PIDFile, stateDir string) {
	log.Info("graceful shutdown: stopping IPC server")
	ipc.Stop()

	if orchestrator != nil {
		log.Info("graceful shutdown: stopping capture orchestrator")
		orchestrator.Stop()
	}

	log.Info("graceful shutdown: writing final health status")
	reporter.WriteOnce("stopped")
	reporter.Stop()

	log.Info("graceful shutdown: releasing PID file")
	pid.Release()

	// Clean up health.json since daemon is stopping.
	health.RemoveHealthFile(stateDir)

	log.Info("unfaded stopped cleanly")
}

func runCoordinator(verbose bool) {
	home, _ := os.UserHomeDir()
	stateDir := filepath.Join(home, ".unfade", "state")
	logsDir := filepath.Join(home, ".unfade", "logs")

	logLevel := platform.LevelInfo
	if verbose {
		logLevel = platform.LevelDebug
	}
	log := platform.NewLogger(logLevel)
	_ = os.MkdirAll(logsDir, 0o755)
	if err := log.SetFile(filepath.Join(logsDir, "coordinator.log")); err != nil {
		fmt.Fprintf(os.Stderr, "warning: could not open coordinator log: %v\n", err)
	}
	defer log.Close()

	log.Info("coordinator mode starting", map[string]any{"version": version, "pid": os.Getpid()})

	pidPath := filepath.Join(stateDir, "coordinator.pid")
	_ = os.MkdirAll(stateDir, 0o755)
	pidFile, err := platform.AcquirePID(pidPath)
	if err != nil {
		log.Error("failed to acquire coordinator PID", map[string]any{"error": err.Error()})
		fmt.Fprintf(os.Stderr, "unfaded coordinator: %v\n", err)
		os.Exit(1)
	}
	defer pidFile.Release()

	budgetCfg := health.DefaultBudgetConfig()
	getBudget, stopBudget := health.StartBudgetMonitor(budgetCfg, log)
	defer stopBudget()

	coord := coordinator.New(log)
	if err := coord.Start(); err != nil {
		log.Error("coordinator start failed", map[string]any{"error": err.Error()})
		fmt.Fprintf(os.Stderr, "unfaded coordinator: %v\n", err)
		os.Exit(1)
	}

	socketPath := filepath.Join(stateDir, "coordinator.sock")
	stopCh := make(chan struct{}, 1)

	ipcHandler := func(req platform.IPCRequest) platform.IPCResponse {
		if req.Cmd == "stop" {
			select {
			case stopCh <- struct{}{}:
			default:
			}
			return platform.IPCResponse{OK: true, Data: map[string]any{"message": "coordinator shutdown"}}
		}
		return coord.HandleIPC(req, getBudget)
	}

	ipcServer := platform.NewIPCServer(socketPath, ipcHandler, log)
	if err := ipcServer.Start(); err != nil {
		log.Error("coordinator IPC failed", map[string]any{"error": err.Error()})
		os.Exit(1)
	}
	defer ipcServer.Stop()

	log.Info("coordinator ready", map[string]any{"socket": socketPath})

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)

	select {
	case sig := <-sigCh:
		log.Info("coordinator received signal", map[string]any{"signal": sig.String()})
	case <-stopCh:
		log.Info("coordinator stop via IPC")
	}

	coord.Stop()
	ipcServer.Stop()
	pidFile.Release()
	log.Info("coordinator stopped cleanly")
}

func resolveEventsDir(projectDir string) string {
	if projectDir != "" {
		return filepath.Join(projectDir, ".unfade", "events")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".unfade", "events")
}

func resolveStateDir(projectDir string) string {
	if projectDir != "" {
		return filepath.Join(projectDir, ".unfade", "state")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".unfade", "state")
}

func resolveLogsDir(projectDir string) string {
	if projectDir != "" {
		return filepath.Join(projectDir, ".unfade", "logs")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".unfade", "logs")
}
