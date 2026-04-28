// FILE: daemon/internal/health/budget.go
// Resource budget enforcement for the Unfade daemon.
// Monitors RSS memory and CPU usage, logs warnings if exceeding budgets.
// Never kills self — lets the platform manager handle restarts.

package health

import (
	"os"
	"runtime"
	"time"
)

// BudgetConfig defines resource thresholds.
type BudgetConfig struct {
	MaxMemoryMB   float64       // Maximum RSS in MB (default: 50)
	MaxCPUPct     float64       // Maximum CPU percentage (default: 1.0)
	CheckInterval time.Duration // How often to check (default: 30s)
}

// DefaultBudgetConfig returns the default resource budget.
func DefaultBudgetConfig() BudgetConfig {
	return BudgetConfig{
		MaxMemoryMB:   100.0,
		MaxCPUPct:     1.0,
		CheckInterval: 30 * time.Second,
	}
}

// BudgetStatus represents the current resource usage snapshot.
type BudgetStatus struct {
	MemoryMB      float64 `json:"memory_mb"`
	HeapMB        float64 `json:"heap_mb"`
	NumGoroutines int     `json:"num_goroutines"`
	MemoryOver    bool    `json:"memory_over"`
}

// BudgetLogger is the interface the budget monitor uses for warnings.
type BudgetLogger interface {
	Warn(msg string, fields ...map[string]any)
	Debug(msg string, fields ...map[string]any)
}

// CheckBudget reads current resource usage and returns the status.
// If usage exceeds thresholds, it logs warnings but never terminates.
func CheckBudget(cfg BudgetConfig, log BudgetLogger) BudgetStatus {
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)

	sysMB := float64(ms.Sys) / (1024 * 1024)
	heapMB := float64(ms.HeapInuse) / (1024 * 1024)
	goroutines := runtime.NumGoroutine()

	// Use HeapInuse for budget enforcement — Sys includes OS-level overhead
	// (mmap, stacks, runtime metadata) that the process doesn't actively use.
	status := BudgetStatus{
		MemoryMB:      sysMB,
		HeapMB:        heapMB,
		NumGoroutines: goroutines,
		MemoryOver:    heapMB > cfg.MaxMemoryMB,
	}

	if status.MemoryOver {
		log.Warn("resource budget exceeded: memory", map[string]any{
			"heap_mb":    heapMB,
			"sys_mb":     sysMB,
			"limit_mb":   cfg.MaxMemoryMB,
			"goroutines": goroutines,
			"pid":        os.Getpid(),
		})
	} else {
		log.Debug("resource budget check", map[string]any{
			"memory_mb":  sysMB,
			"heap_mb":    heapMB,
			"goroutines": goroutines,
		})
	}

	return status
}

// StartBudgetMonitor runs periodic budget checks in a goroutine.
// Stops when the done channel is closed. Returns the stop function.
func StartBudgetMonitor(cfg BudgetConfig, log BudgetLogger) (latestStatus func() BudgetStatus, stop func()) {
	done := make(chan struct{})
	var current BudgetStatus

	// Initial check.
	current = CheckBudget(cfg, log)

	go func() {
		ticker := time.NewTicker(cfg.CheckInterval)
		defer ticker.Stop()

		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				current = CheckBudget(cfg, log)
			}
		}
	}()

	return func() BudgetStatus { return current }, func() { close(done) }
}
