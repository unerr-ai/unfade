package health

import (
	"testing"
	"time"
)

type mockLogger struct {
	warnCount  int
	debugCount int
}

func (l *mockLogger) Warn(msg string, fields ...map[string]any)  { l.warnCount++ }
func (l *mockLogger) Debug(msg string, fields ...map[string]any) { l.debugCount++ }

func TestCheckBudget_ReportsUsage(t *testing.T) {
	log := &mockLogger{}
	cfg := DefaultBudgetConfig()

	status := CheckBudget(cfg, log)

	if status.MemoryMB <= 0 {
		t.Error("MemoryMB should be > 0")
	}
	if status.NumGoroutines <= 0 {
		t.Error("NumGoroutines should be > 0")
	}
}

func TestCheckBudget_WarnsOnExcessMemory(t *testing.T) {
	log := &mockLogger{}
	// Set an impossibly low memory limit to trigger warning.
	cfg := BudgetConfig{MaxMemoryMB: 0.001, MaxCPUPct: 1.0, CheckInterval: time.Second}

	status := CheckBudget(cfg, log)

	if !status.MemoryOver {
		t.Error("MemoryOver should be true with 0.001MB limit")
	}
	if log.warnCount == 0 {
		t.Error("expected a warn log for memory overage")
	}
}

func TestCheckBudget_NoWarningUnderBudget(t *testing.T) {
	log := &mockLogger{}
	// Set a generous limit.
	cfg := BudgetConfig{MaxMemoryMB: 10000, MaxCPUPct: 100, CheckInterval: time.Second}

	status := CheckBudget(cfg, log)

	if status.MemoryOver {
		t.Error("MemoryOver should be false with generous limit")
	}
	if log.warnCount != 0 {
		t.Errorf("expected 0 warnings, got %d", log.warnCount)
	}
}

func TestDefaultBudgetConfig(t *testing.T) {
	cfg := DefaultBudgetConfig()
	if cfg.MaxMemoryMB != 50.0 {
		t.Errorf("MaxMemoryMB = %f, want 50.0", cfg.MaxMemoryMB)
	}
	if cfg.MaxCPUPct != 1.0 {
		t.Errorf("MaxCPUPct = %f, want 1.0", cfg.MaxCPUPct)
	}
	if cfg.CheckInterval != 30*time.Second {
		t.Errorf("CheckInterval = %v, want 30s", cfg.CheckInterval)
	}
}

func TestStartBudgetMonitor_ReturnsStatusFunc(t *testing.T) {
	log := &mockLogger{}
	cfg := BudgetConfig{MaxMemoryMB: 10000, MaxCPUPct: 100, CheckInterval: 50 * time.Millisecond}

	getStatus, stop := StartBudgetMonitor(cfg, log)
	defer stop()

	status := getStatus()
	if status.MemoryMB <= 0 {
		t.Error("initial status should have MemoryMB > 0")
	}

	// Wait for at least one tick.
	time.Sleep(100 * time.Millisecond)

	status2 := getStatus()
	if status2.MemoryMB <= 0 {
		t.Error("updated status should have MemoryMB > 0")
	}
}
