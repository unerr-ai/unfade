// FILE: daemon/internal/platform/pid.go
// PID file management with flock for the Unfade daemon.
// Ensures single-instance operation via exclusive advisory lock.

package platform

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"syscall"
)

// PIDFile manages a PID file with an exclusive flock.
// The lock is held for the lifetime of the daemon process.
type PIDFile struct {
	path string
	file *os.File
}

// AcquirePID creates a PID file at the given path, writes the current PID,
// and holds an exclusive flock. Returns an error if another daemon holds the lock.
func AcquirePID(path string) (*PIDFile, error) {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create PID directory: %w", err)
	}

	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o644)
	if err != nil {
		return nil, fmt.Errorf("open PID file: %w", err)
	}

	// Non-blocking exclusive lock — fails immediately if another process holds it.
	err = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
	if err != nil {
		_ = f.Close()
		// Try to read existing PID for a better error message.
		existingPID := readExistingPID(path)
		if existingPID > 0 {
			return nil, fmt.Errorf("another daemon is running (PID %d)", existingPID)
		}
		return nil, fmt.Errorf("could not acquire lock on PID file: %w", err)
	}

	// Truncate and write current PID.
	if err := f.Truncate(0); err != nil {
		_ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
		_ = f.Close()
		return nil, fmt.Errorf("truncate PID file: %w", err)
	}
	if _, err := f.Seek(0, 0); err != nil {
		_ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
		_ = f.Close()
		return nil, fmt.Errorf("seek PID file: %w", err)
	}

	pid := os.Getpid()
	if _, err := fmt.Fprintf(f, "%d\n", pid); err != nil {
		_ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
		_ = f.Close()
		return nil, fmt.Errorf("write PID: %w", err)
	}
	if err := f.Sync(); err != nil {
		_ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
		_ = f.Close()
		return nil, fmt.Errorf("sync PID file: %w", err)
	}

	return &PIDFile{path: path, file: f}, nil
}

// Release removes the PID file and releases the flock.
// Safe to call multiple times.
func (p *PIDFile) Release() {
	if p.file == nil {
		return
	}
	_ = syscall.Flock(int(p.file.Fd()), syscall.LOCK_UN)
	_ = p.file.Close()
	_ = os.Remove(p.path)
	p.file = nil
}

// Path returns the PID file path.
func (p *PIDFile) Path() string {
	return p.path
}

// ReadPID reads the PID from an existing PID file.
// Returns 0 if the file doesn't exist or contains invalid content.
func ReadPID(path string) int {
	return readExistingPID(path)
}

// IsStale checks if a PID file exists but the process is no longer running.
// Returns the stale PID (> 0) if stale, or 0 if not stale or file doesn't exist.
func IsStale(path string) int {
	pid := readExistingPID(path)
	if pid <= 0 {
		return 0
	}

	// Signal 0 checks if process exists without actually sending a signal.
	err := syscall.Kill(pid, 0)
	if err == syscall.ESRCH {
		return pid // Process does not exist — stale.
	}
	return 0 // Process is alive (or we lack permission, assume alive).
}

// CleanStale removes the PID file if it's stale (process no longer running).
// Returns the stale PID that was cleaned, or 0 if nothing was cleaned.
func CleanStale(path string) int {
	pid := IsStale(path)
	if pid > 0 {
		_ = os.Remove(path)
	}
	return pid
}

func readExistingPID(path string) int {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0
	}

	s := string(data)
	// Trim whitespace/newlines.
	for len(s) > 0 && (s[len(s)-1] == '\n' || s[len(s)-1] == '\r' || s[len(s)-1] == ' ') {
		s = s[:len(s)-1]
	}
	if s == "" {
		return 0
	}

	pid, err := strconv.Atoi(s)
	if err != nil || pid <= 0 {
		return 0
	}
	return pid
}
