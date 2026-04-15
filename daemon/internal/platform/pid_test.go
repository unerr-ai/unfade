package platform

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

func TestAcquirePID_CreatesFileWithCurrentPID(t *testing.T) {
	dir := t.TempDir()
	pidPath := filepath.Join(dir, "daemon.pid")

	pf, err := AcquirePID(pidPath)
	if err != nil {
		t.Fatalf("AcquirePID: %v", err)
	}
	defer pf.Release()

	data, err := os.ReadFile(pidPath)
	if err != nil {
		t.Fatalf("read PID file: %v", err)
	}

	got := string(data)
	want := strconv.Itoa(os.Getpid()) + "\n"
	if got != want {
		t.Errorf("PID file content = %q, want %q", got, want)
	}
}

func TestAcquirePID_FailsIfAlreadyLocked(t *testing.T) {
	dir := t.TempDir()
	pidPath := filepath.Join(dir, "daemon.pid")

	pf1, err := AcquirePID(pidPath)
	if err != nil {
		t.Fatalf("first AcquirePID: %v", err)
	}
	defer pf1.Release()

	_, err = AcquirePID(pidPath)
	if err == nil {
		t.Fatal("expected error for second AcquirePID, got nil")
	}
}

func TestRelease_RemovesPIDFile(t *testing.T) {
	dir := t.TempDir()
	pidPath := filepath.Join(dir, "daemon.pid")

	pf, err := AcquirePID(pidPath)
	if err != nil {
		t.Fatalf("AcquirePID: %v", err)
	}

	pf.Release()

	if _, err := os.Stat(pidPath); !os.IsNotExist(err) {
		t.Error("PID file should be removed after Release")
	}
}

func TestRelease_SafeToCallMultipleTimes(t *testing.T) {
	dir := t.TempDir()
	pidPath := filepath.Join(dir, "daemon.pid")

	pf, err := AcquirePID(pidPath)
	if err != nil {
		t.Fatalf("AcquirePID: %v", err)
	}

	pf.Release()
	pf.Release() // Should not panic.
}

func TestReadPID_ReturnsZeroForMissingFile(t *testing.T) {
	got := ReadPID("/tmp/nonexistent-unfade-pid-file")
	if got != 0 {
		t.Errorf("ReadPID = %d, want 0", got)
	}
}

func TestReadPID_ParsesValidPID(t *testing.T) {
	dir := t.TempDir()
	pidPath := filepath.Join(dir, "daemon.pid")
	os.WriteFile(pidPath, []byte("12345\n"), 0o644)

	got := ReadPID(pidPath)
	if got != 12345 {
		t.Errorf("ReadPID = %d, want 12345", got)
	}
}

func TestIsStale_ReturnsPIDForDeadProcess(t *testing.T) {
	dir := t.TempDir()
	pidPath := filepath.Join(dir, "daemon.pid")
	// Use a PID that almost certainly doesn't exist.
	os.WriteFile(pidPath, []byte("999999999\n"), 0o644)

	got := IsStale(pidPath)
	if got != 999999999 {
		t.Errorf("IsStale = %d, want 999999999", got)
	}
}

func TestIsStale_ReturnsZeroForLiveProcess(t *testing.T) {
	dir := t.TempDir()
	pidPath := filepath.Join(dir, "daemon.pid")
	os.WriteFile(pidPath, []byte(strconv.Itoa(os.Getpid())+"\n"), 0o644)

	got := IsStale(pidPath)
	if got != 0 {
		t.Errorf("IsStale = %d, want 0 (live process)", got)
	}
}

func TestCleanStale_RemovesStaleFile(t *testing.T) {
	dir := t.TempDir()
	pidPath := filepath.Join(dir, "daemon.pid")
	os.WriteFile(pidPath, []byte("999999999\n"), 0o644)

	cleaned := CleanStale(pidPath)
	if cleaned != 999999999 {
		t.Errorf("CleanStale = %d, want 999999999", cleaned)
	}

	if _, err := os.Stat(pidPath); !os.IsNotExist(err) {
		t.Error("stale PID file should be removed")
	}
}
