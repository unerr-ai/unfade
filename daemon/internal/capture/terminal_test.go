// Tests for UF-062: Terminal capture receiver
// T-169 through T-174

package capture

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"testing"
	"time"
)

// testTerminalSocketPath creates a short socket path under /tmp.
func testTerminalSocketPath(t *testing.T, name string) string {
	t.Helper()
	path := fmt.Sprintf("/tmp/uf-term-%s-%d.sock", name, os.Getpid())
	t.Cleanup(func() { os.Remove(path) })
	return path
}

type termTestLogger struct{}

func (l *termTestLogger) Debug(msg string, fields ...map[string]any) {}
func (l *termTestLogger) Info(msg string, fields ...map[string]any)  {}
func (l *termTestLogger) Warn(msg string, fields ...map[string]any)  {}
func (l *termTestLogger) Error(msg string, fields ...map[string]any) {}

// T-169: receives command event via Unix socket
func TestTerminalReceiver_ReceivesCommandEvent(t *testing.T) {
	socketPath := testTerminalSocketPath(t, "recv")
	eventCh := make(chan CaptureEvent, 10)

	recv := NewTerminalReceiver(socketPath, &termTestLogger{})
	if err := recv.Start(eventCh); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer recv.Stop()

	time.Sleep(10 * time.Millisecond)

	// Send a terminal event.
	sendTerminalEvent(t, socketPath, TerminalEvent{
		Cmd:      "npm test",
		Exit:     0,
		Duration: 3.5,
		Cwd:      "/project",
	})

	select {
	case event := <-eventCh:
		if event.Source != "terminal" {
			t.Errorf("source = %q, want terminal", event.Source)
		}
		if event.Type != "command" {
			t.Errorf("type = %q, want command", event.Type)
		}
		if event.Content.Summary != "npm test" {
			t.Errorf("summary = %q, want 'npm test'", event.Content.Summary)
		}
		if event.Metadata["cmd"] != "npm test" {
			t.Errorf("metadata cmd = %v, want 'npm test'", event.Metadata["cmd"])
		}
		if event.Metadata["cwd"] != "/project" {
			t.Errorf("metadata cwd = %v, want '/project'", event.Metadata["cwd"])
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for event")
	}
}

// T-170: sets type to "error" when exit != 0
func TestTerminalReceiver_ErrorType(t *testing.T) {
	socketPath := testTerminalSocketPath(t, "err")
	eventCh := make(chan CaptureEvent, 10)

	recv := NewTerminalReceiver(socketPath, &termTestLogger{})
	if err := recv.Start(eventCh); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer recv.Stop()

	time.Sleep(10 * time.Millisecond)

	sendTerminalEvent(t, socketPath, TerminalEvent{
		Cmd:      "cargo build",
		Exit:     1,
		Duration: 12.0,
		Cwd:      "/rust-project",
	})

	select {
	case event := <-eventCh:
		if event.Type != "error" {
			t.Errorf("type = %q, want error", event.Type)
		}
		if event.Metadata["exit"] != 1 {
			t.Errorf("exit = %v, want 1", event.Metadata["exit"])
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for event")
	}
}

// T-171: handles malformed JSON gracefully
func TestTerminalReceiver_MalformedJSON(t *testing.T) {
	socketPath := testTerminalSocketPath(t, "bad")
	eventCh := make(chan CaptureEvent, 10)

	recv := NewTerminalReceiver(socketPath, &termTestLogger{})
	if err := recv.Start(eventCh); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer recv.Stop()

	time.Sleep(10 * time.Millisecond)

	// Send malformed JSON.
	conn, err := net.Dial("unix", socketPath)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	_, _ = conn.Write([]byte("not valid json\n"))
	conn.Close()

	// Should not receive any event.
	select {
	case event := <-eventCh:
		t.Errorf("unexpected event received: %+v", event)
	case <-time.After(200 * time.Millisecond):
		// Expected — no event for malformed JSON.
	}
}

// T-172: discards events with empty cmd
func TestTerminalReceiver_EmptyCmd(t *testing.T) {
	socketPath := testTerminalSocketPath(t, "empty")
	eventCh := make(chan CaptureEvent, 10)

	recv := NewTerminalReceiver(socketPath, &termTestLogger{})
	if err := recv.Start(eventCh); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer recv.Stop()

	time.Sleep(10 * time.Millisecond)

	sendTerminalEvent(t, socketPath, TerminalEvent{
		Cmd:  "",
		Exit: 0,
		Cwd:  "/project",
	})

	select {
	case event := <-eventCh:
		t.Errorf("unexpected event for empty cmd: %+v", event)
	case <-time.After(200 * time.Millisecond):
		// Expected — no event for empty cmd.
	}
}

// T-173: handles multiple concurrent connections
func TestTerminalReceiver_ConcurrentConnections(t *testing.T) {
	socketPath := testTerminalSocketPath(t, "conc")
	eventCh := make(chan CaptureEvent, 20)

	recv := NewTerminalReceiver(socketPath, &termTestLogger{})
	if err := recv.Start(eventCh); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer recv.Stop()

	time.Sleep(10 * time.Millisecond)

	n := 5
	done := make(chan bool, n)
	for i := 0; i < n; i++ {
		go func(idx int) {
			sendTerminalEvent(t, socketPath, TerminalEvent{
				Cmd:      fmt.Sprintf("echo %d", idx),
				Exit:     0,
				Duration: 0.1,
				Cwd:      "/project",
			})
			done <- true
		}(i)
	}

	for i := 0; i < n; i++ {
		<-done
	}

	// Collect events.
	received := 0
	timeout := time.After(2 * time.Second)
	for received < n {
		select {
		case <-eventCh:
			received++
		case <-timeout:
			t.Fatalf("received %d/%d events", received, n)
		}
	}
}

// T-174: handles socket unavailable gracefully (stop cleans up)
func TestTerminalReceiver_StopCleansUpSocket(t *testing.T) {
	socketPath := testTerminalSocketPath(t, "clean")
	eventCh := make(chan CaptureEvent, 10)

	recv := NewTerminalReceiver(socketPath, &termTestLogger{})
	if err := recv.Start(eventCh); err != nil {
		t.Fatalf("Start: %v", err)
	}

	recv.Stop()

	// Socket should be removed.
	_, err := net.Dial("unix", socketPath)
	if err == nil {
		t.Error("socket should be removed after Stop")
	}
}

func TestTerminalReceiver_Name(t *testing.T) {
	recv := NewTerminalReceiver("/tmp/test.sock", &termTestLogger{})
	if recv.Name() != "terminal" {
		t.Errorf("Name() = %q, want terminal", recv.Name())
	}
}

func TestTerminalReceiver_WatchedPaths(t *testing.T) {
	recv := NewTerminalReceiver("/tmp/test.sock", &termTestLogger{})
	paths := recv.WatchedPaths()
	if len(paths) != 1 || paths[0] != "/tmp/test.sock" {
		t.Errorf("WatchedPaths() = %v, want [/tmp/test.sock]", paths)
	}
}

func sendTerminalEvent(t *testing.T, socketPath string, te TerminalEvent) {
	t.Helper()

	conn, err := net.DialTimeout("unix", socketPath, 2*time.Second)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	data, _ := json.Marshal(te)
	data = append(data, '\n')
	if _, err := conn.Write(data); err != nil {
		t.Fatalf("write: %v", err)
	}
}
