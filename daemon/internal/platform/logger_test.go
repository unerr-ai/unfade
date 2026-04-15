package platform

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLogger_WritesToStderr(t *testing.T) {
	log := NewLogger(LevelDebug)
	// Just verify it doesn't panic — stderr output is not captured in unit tests.
	log.Info("test message")
	log.Debug("debug message", map[string]any{"key": "value"})
	log.Warn("warn message")
	log.Error("error message")
}

func TestLogger_WritesToFile(t *testing.T) {
	dir := t.TempDir()
	logPath := filepath.Join(dir, "test.log")

	log := NewLogger(LevelInfo)
	if err := log.SetFile(logPath); err != nil {
		t.Fatalf("SetFile: %v", err)
	}

	log.Info("hello from test")
	log.Close()

	data, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("read log file: %v", err)
	}

	content := string(data)
	if !strings.Contains(content, "hello from test") {
		t.Errorf("log file should contain message, got: %s", content)
	}

	// Verify JSON structure.
	var entry map[string]any
	lines := strings.Split(strings.TrimSpace(content), "\n")
	if err := json.Unmarshal([]byte(lines[0]), &entry); err != nil {
		t.Fatalf("log entry is not valid JSON: %v", err)
	}
	if entry["level"] != "info" {
		t.Errorf("level = %v, want info", entry["level"])
	}
	if entry["msg"] != "hello from test" {
		t.Errorf("msg = %v, want 'hello from test'", entry["msg"])
	}
}

func TestLogger_RespectsLogLevel(t *testing.T) {
	dir := t.TempDir()
	logPath := filepath.Join(dir, "test.log")

	log := NewLogger(LevelWarn)
	if err := log.SetFile(logPath); err != nil {
		t.Fatalf("SetFile: %v", err)
	}

	log.Debug("should not appear")
	log.Info("should not appear either")
	log.Warn("this should appear")
	log.Close()

	data, _ := os.ReadFile(logPath)
	content := string(data)

	if strings.Contains(content, "should not appear") {
		t.Error("debug/info messages should be filtered at warn level")
	}
	if !strings.Contains(content, "this should appear") {
		t.Error("warn message should appear")
	}
}

func TestLogger_IncludesFieldsInJSON(t *testing.T) {
	dir := t.TempDir()
	logPath := filepath.Join(dir, "test.log")

	log := NewLogger(LevelDebug)
	if err := log.SetFile(logPath); err != nil {
		t.Fatalf("SetFile: %v", err)
	}

	log.Info("with fields", map[string]any{"pid": 42, "component": "test"})
	log.Close()

	data, _ := os.ReadFile(logPath)
	var entry map[string]any
	if err := json.Unmarshal([]byte(strings.TrimSpace(string(data))), &entry); err != nil {
		t.Fatalf("not valid JSON: %v", err)
	}

	if entry["pid"] != float64(42) {
		t.Errorf("pid = %v, want 42", entry["pid"])
	}
	if entry["component"] != "test" {
		t.Errorf("component = %v, want test", entry["component"])
	}
}

func TestLogger_RotatesLargeFile(t *testing.T) {
	dir := t.TempDir()
	logPath := filepath.Join(dir, "test.log")

	log := NewLogger(LevelDebug)
	if err := log.SetFile(logPath); err != nil {
		t.Fatalf("SetFile: %v", err)
	}

	// Write enough to exceed 10MB.
	bigMsg := strings.Repeat("x", 1024)
	for i := 0; i < 11000; i++ {
		log.Info(bigMsg)
	}
	log.Close()

	// Check that rotated file exists.
	if _, err := os.Stat(logPath + ".1"); os.IsNotExist(err) {
		t.Error("expected rotated file .1 to exist")
	}
}

func TestLogLevel_String(t *testing.T) {
	tests := []struct {
		level LogLevel
		want  string
	}{
		{LevelDebug, "debug"},
		{LevelInfo, "info"},
		{LevelWarn, "warn"},
		{LevelError, "error"},
		{LogLevel(99), "unknown"},
	}

	for _, tt := range tests {
		if got := tt.level.String(); got != tt.want {
			t.Errorf("LogLevel(%d).String() = %q, want %q", tt.level, got, tt.want)
		}
	}
}
