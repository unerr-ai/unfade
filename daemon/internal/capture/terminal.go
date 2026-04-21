// FILE: daemon/internal/capture/terminal.go
// UF-062: TerminalReceiver implements CaptureSource — listens on a Unix domain
// socket for JSON payloads from shell hooks. Converts { cmd, exit, duration, cwd }
// into CaptureEvents with source "terminal".
// Non-blocking startup — socket accept loop runs in a goroutine.
// Handles malformed JSON gracefully (log warning, discard).

package capture

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// TerminalEvent is the JSON payload received from shell hooks.
type TerminalEvent struct {
	Cmd      string  `json:"cmd"`
	Exit     int     `json:"exit"`
	Duration float64 `json:"duration"`
	Cwd      string  `json:"cwd"`
}

// TerminalReceiver listens on a Unix domain socket for terminal events from shell hooks.
type TerminalReceiver struct {
	socketPath string
	logger     CaptureSourceLogger
	listener   net.Listener
	eventCh    chan<- CaptureEvent
	done       chan struct{}
	wg         sync.WaitGroup
}

// NewTerminalReceiver creates a terminal receiver bound to the given socket path.
func NewTerminalReceiver(socketPath string, logger CaptureSourceLogger) *TerminalReceiver {
	return &TerminalReceiver{
		socketPath: socketPath,
		logger:     logger,
		done:       make(chan struct{}),
	}
}

func (t *TerminalReceiver) Name() string { return "terminal" }

// Start begins listening on the Unix socket. Non-blocking — runs accept loop in a goroutine.
func (t *TerminalReceiver) Start(eventCh chan<- CaptureEvent) error {
	t.eventCh = eventCh

	dir := filepath.Dir(t.socketPath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create socket directory: %w", err)
	}

	// Remove stale socket file if it exists.
	_ = os.Remove(t.socketPath)

	ln, err := net.Listen("unix", t.socketPath)
	if err != nil {
		return fmt.Errorf("listen on terminal socket %s: %w", t.socketPath, err)
	}
	t.listener = ln

	t.logger.Info("terminal receiver listening", map[string]any{"socket": t.socketPath})

	t.wg.Add(1)
	go t.acceptLoop()

	return nil
}

// Stop gracefully shuts down the terminal receiver.
func (t *TerminalReceiver) Stop() {
	close(t.done)
	if t.listener != nil {
		_ = t.listener.Close()
	}
	t.wg.Wait()
	_ = os.Remove(t.socketPath)
	t.logger.Info("terminal receiver stopped")
}

// WatchedPaths returns the socket path for health reporting.
func (t *TerminalReceiver) WatchedPaths() []string {
	return []string{t.socketPath}
}

func (t *TerminalReceiver) acceptLoop() {
	defer t.wg.Done()

	for {
		conn, err := t.listener.Accept()
		if err != nil {
			select {
			case <-t.done:
				return // Normal shutdown.
			default:
				t.logger.Error("terminal accept error", map[string]any{"error": err.Error()})
				return
			}
		}
		t.wg.Add(1)
		go t.handleConn(conn)
	}
}

func (t *TerminalReceiver) handleConn(conn net.Conn) {
	defer t.wg.Done()
	defer conn.Close()

	// Set read deadline to prevent hanging connections.
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))

	scanner := bufio.NewScanner(conn)
	if !scanner.Scan() {
		return
	}

	line := scanner.Bytes()
	var te TerminalEvent
	if err := json.Unmarshal(line, &te); err != nil {
		t.logger.Warn("malformed terminal event JSON", map[string]any{
			"error": err.Error(),
			"raw":   truncateRaw(string(line)),
		})
		return
	}

	// Validate required field.
	if strings.TrimSpace(te.Cmd) == "" {
		t.logger.Warn("terminal event missing cmd field")
		return
	}

	event := t.toEvent(te)

	select {
	case t.eventCh <- event:
	case <-t.done:
	}
}

// toEvent converts a TerminalEvent into a CaptureEvent.
func (t *TerminalReceiver) toEvent(te TerminalEvent) CaptureEvent {
	eventType := "command"
	if te.Exit != 0 {
		eventType = "error"
	}

	summary := te.Cmd
	if len(summary) > 200 {
		summary = summary[:197] + "..."
	}

	return CaptureEvent{
		ID:        uuid.New().String(),
		Timestamp: time.Now().Format(time.RFC3339),
		Source:    "terminal",
		Type:      eventType,
		Content: EventContent{
			Summary: summary,
			Project: filepath.Base(te.Cwd),
		},
		Metadata: map[string]any{
			"cmd":      te.Cmd,
			"exit":     te.Exit,
			"duration": te.Duration,
			"cwd":      te.Cwd,
		},
	}
}

// truncateRaw limits raw log output for warning messages.
func truncateRaw(s string) string {
	if len(s) > 100 {
		return s[:100] + "..."
	}
	return s
}
