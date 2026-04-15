// FILE: daemon/internal/platform/logger.go
// Structured logging with file rotation for the Unfade daemon.
// Logs to stderr (always) and optionally to a log file with rotation.
// Rotation triggers when file exceeds 10MB; keeps last 3 rotated files.

package platform

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// LogLevel represents the severity of a log message.
type LogLevel int

const (
	LevelDebug LogLevel = iota
	LevelInfo
	LevelWarn
	LevelError
)

func (l LogLevel) String() string {
	switch l {
	case LevelDebug:
		return "debug"
	case LevelInfo:
		return "info"
	case LevelWarn:
		return "warn"
	case LevelError:
		return "error"
	default:
		return "unknown"
	}
}

const (
	maxLogFileSize = 10 * 1024 * 1024 // 10MB
	maxRotatedLogs = 3
)

// LogEntry is a structured log record written as JSON.
type LogEntry struct {
	Time    string `json:"time"`
	Level   string `json:"level"`
	Message string `json:"msg"`
	// Extra fields merged at top level.
	Fields map[string]any `json:"-"`
}

// MarshalJSON produces a flat JSON object with fields merged in.
func (e LogEntry) MarshalJSON() ([]byte, error) {
	m := map[string]any{
		"time":  e.Time,
		"level": e.Level,
		"msg":   e.Message,
	}
	for k, v := range e.Fields {
		m[k] = v
	}
	return json.Marshal(m)
}

// Logger writes structured JSON logs to stderr and an optional rotating file.
type Logger struct {
	mu       sync.Mutex
	level    LogLevel
	filePath string
	file     *os.File
	writers  []io.Writer
}

// NewLogger creates a logger that writes to stderr.
// Call SetFile to also write to a rotating log file.
func NewLogger(level LogLevel) *Logger {
	return &Logger{
		level:   level,
		writers: []io.Writer{os.Stderr},
	}
}

// SetFile configures file-based logging with rotation.
// The directory is created if it does not exist.
func (l *Logger) SetFile(path string) error {
	l.mu.Lock()
	defer l.mu.Unlock()

	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create log directory: %w", err)
	}

	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return fmt.Errorf("open log file: %w", err)
	}

	l.filePath = path
	l.file = f
	l.writers = []io.Writer{os.Stderr, f}
	return nil
}

// Close flushes and closes the log file (if open).
func (l *Logger) Close() {
	l.mu.Lock()
	defer l.mu.Unlock()

	if l.file != nil {
		_ = l.file.Close()
		l.file = nil
	}
	l.writers = []io.Writer{os.Stderr}
}

// Debug logs at debug level.
func (l *Logger) Debug(msg string, fields ...map[string]any) {
	l.log(LevelDebug, msg, fields)
}

// Info logs at info level.
func (l *Logger) Info(msg string, fields ...map[string]any) {
	l.log(LevelInfo, msg, fields)
}

// Warn logs at warn level.
func (l *Logger) Warn(msg string, fields ...map[string]any) {
	l.log(LevelWarn, msg, fields)
}

// Error logs at error level.
func (l *Logger) Error(msg string, fields ...map[string]any) {
	l.log(LevelError, msg, fields)
}

func (l *Logger) log(level LogLevel, msg string, fieldSlice []map[string]any) {
	if level < l.level {
		return
	}

	var merged map[string]any
	if len(fieldSlice) > 0 {
		merged = fieldSlice[0]
	}

	entry := LogEntry{
		Time:    time.Now().UTC().Format(time.RFC3339Nano),
		Level:   level.String(),
		Message: msg,
		Fields:  merged,
	}

	data, err := json.Marshal(entry)
	if err != nil {
		return
	}
	data = append(data, '\n')

	l.mu.Lock()
	defer l.mu.Unlock()

	for _, w := range l.writers {
		_, _ = w.Write(data)
	}

	l.rotateIfNeeded()
}

// rotateIfNeeded checks if the log file exceeds maxLogFileSize and rotates.
// Must be called with l.mu held.
func (l *Logger) rotateIfNeeded() {
	if l.file == nil || l.filePath == "" {
		return
	}

	info, err := l.file.Stat()
	if err != nil || info.Size() < maxLogFileSize {
		return
	}

	_ = l.file.Close()

	// Shift existing rotated files: .3 → delete, .2 → .3, .1 → .2
	for i := maxRotatedLogs; i >= 1; i-- {
		old := fmt.Sprintf("%s.%d", l.filePath, i)
		if i == maxRotatedLogs {
			_ = os.Remove(old)
		} else {
			next := fmt.Sprintf("%s.%d", l.filePath, i+1)
			_ = os.Rename(old, next)
		}
	}

	// Current → .1
	_ = os.Rename(l.filePath, l.filePath+".1")

	// Open fresh file
	f, err := os.OpenFile(l.filePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		l.file = nil
		l.writers = []io.Writer{os.Stderr}
		return
	}

	l.file = f
	l.writers = []io.Writer{os.Stderr, f}
}
