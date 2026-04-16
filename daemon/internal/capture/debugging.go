// FILE: daemon/internal/capture/debugging.go
// UF-064: DebuggingDetector — stateful pattern detector that buffers terminal events
// per cwd. When 3+ related commands with ≥1 non-zero exit code appear within a
// 10-minute window, emits a synthetic "debugging_session" CaptureEvent.
//
// Related commands heuristic:
//   - Same base binary (first whitespace-delimited token)
//   - Same target file (argument containing / or known extension)
//   - Same cwd within time window
//
// False positives are harmless; false negatives lose signal — keep heuristic simple.

package capture

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

const (
	debugWindowDuration = 10 * time.Minute
	debugMinCommands    = 3
)

// bufferedEvent wraps a CaptureEvent with parsed terminal metadata.
type bufferedEvent struct {
	event      CaptureEvent
	cmd        string
	exit       int
	cwd        string
	baseCmd    string
	targets    []string
	receivedAt time.Time
}

// DebuggingDetector watches terminal events for debugging session patterns.
type DebuggingDetector struct {
	eventCh chan<- CaptureEvent
	buffers map[string][]bufferedEvent // keyed by cwd
	mu      sync.Mutex
	// emittedKeys tracks recently emitted sessions to avoid duplicates.
	// Key: "cwd:baseCmd", Value: time of last emission.
	emittedKeys map[string]time.Time
}

// NewDebuggingDetector creates a detector that emits debugging session events
// to the given channel.
func NewDebuggingDetector(eventCh chan<- CaptureEvent) *DebuggingDetector {
	return &DebuggingDetector{
		eventCh:     eventCh,
		buffers:     make(map[string][]bufferedEvent),
		emittedKeys: make(map[string]time.Time),
	}
}

// ProcessEvent evaluates a terminal CaptureEvent for debugging patterns.
// Call this for every terminal-sourced event.
func (d *DebuggingDetector) ProcessEvent(event CaptureEvent) {
	if event.Source != "terminal" {
		return
	}

	// Extract terminal metadata.
	cmd, _ := event.Metadata["cmd"].(string)
	exitRaw, _ := event.Metadata["exit"]
	cwd, _ := event.Metadata["cwd"].(string)

	if cmd == "" || cwd == "" {
		return
	}

	exit := toInt(exitRaw)

	be := bufferedEvent{
		event:      event,
		cmd:        cmd,
		exit:       exit,
		cwd:        cwd,
		baseCmd:    baseCommand(cmd),
		targets:    extractTargets(cmd),
		receivedAt: time.Now(),
	}

	d.mu.Lock()
	defer d.mu.Unlock()

	// Add to buffer for this cwd.
	d.buffers[cwd] = append(d.buffers[cwd], be)

	// Expire old events outside the window.
	cutoff := time.Now().Add(-debugWindowDuration)
	d.expireOld(cwd, cutoff)

	// Clean up stale emittedKeys.
	for k, t := range d.emittedKeys {
		if time.Since(t) > debugWindowDuration {
			delete(d.emittedKeys, k)
		}
	}

	// Check for debugging session.
	d.checkSession(cwd)
}

// expireOld removes events older than cutoff from the cwd buffer.
func (d *DebuggingDetector) expireOld(cwd string, cutoff time.Time) {
	buf := d.buffers[cwd]
	start := 0
	for start < len(buf) && buf[start].receivedAt.Before(cutoff) {
		start++
	}
	if start > 0 {
		d.buffers[cwd] = buf[start:]
	}
	if len(d.buffers[cwd]) == 0 {
		delete(d.buffers, cwd)
	}
}

// checkSession looks for a cluster of related commands with errors.
func (d *DebuggingDetector) checkSession(cwd string) {
	buf := d.buffers[cwd]
	if len(buf) < debugMinCommands {
		return
	}

	// Group by base command — the most common relatedness signal.
	groups := make(map[string][]bufferedEvent)
	for _, be := range buf {
		groups[be.baseCmd] = append(groups[be.baseCmd], be)
	}

	for baseCmd, group := range groups {
		if len(group) < debugMinCommands {
			continue
		}

		// Check for at least one non-zero exit.
		hasError := false
		for _, be := range group {
			if be.exit != 0 {
				hasError = true
				break
			}
		}
		if !hasError {
			continue
		}

		// Avoid duplicate emissions for the same cluster.
		emitKey := fmt.Sprintf("%s:%s", cwd, baseCmd)
		if lastEmit, ok := d.emittedKeys[emitKey]; ok {
			newestInGroup := group[len(group)-1].receivedAt
			if !newestInGroup.After(lastEmit) {
				continue
			}
		}

		d.emitSession(cwd, baseCmd, group)
		d.emittedKeys[emitKey] = time.Now()

		// Clear matched events from buffer.
		d.removeMatched(cwd, group)
		return // One emission per ProcessEvent call.
	}
}

// emitSession sends a synthetic debugging_session CaptureEvent.
func (d *DebuggingDetector) emitSession(cwd, baseCmd string, events []bufferedEvent) {
	commands := make([]string, len(events))
	exitCodes := make([]int, len(events))
	var totalDuration float64

	for i, be := range events {
		commands[i] = be.cmd
		exitCodes[i] = be.exit
		if dur, ok := be.event.Metadata["duration"].(float64); ok {
			totalDuration += dur
		}
	}

	// Check if session was resolved (last command succeeded).
	resolved := events[len(events)-1].exit == 0
	resolutionCmd := ""
	if resolved {
		resolutionCmd = events[len(events)-1].cmd
	}

	summary := fmt.Sprintf("Debugging session: %d commands with %s (%.0fs total)",
		len(events), baseCmd, totalDuration)

	event := CaptureEvent{
		ID:        uuid.New().String(),
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Source:    "terminal",
		Type:      "debugging_session",
		Content: EventContent{
			Summary: summary,
			Project: filepath.Base(cwd),
		},
		Metadata: map[string]any{
			"commands":       commands,
			"exit_codes":     exitCodes,
			"total_duration": totalDuration,
			"base_cmd":       baseCmd,
			"cwd":            cwd,
			"resolved":       resolved,
			"resolution_cmd": resolutionCmd,
			"command_count":  len(events),
		},
	}

	select {
	case d.eventCh <- event:
	default:
		// Channel full — drop silently. Debugging sessions are best-effort.
	}
}

// removeMatched removes the given events from the cwd buffer.
func (d *DebuggingDetector) removeMatched(cwd string, matched []bufferedEvent) {
	matchSet := make(map[string]bool, len(matched))
	for _, be := range matched {
		matchSet[be.event.ID] = true
	}

	buf := d.buffers[cwd]
	filtered := make([]bufferedEvent, 0, len(buf)-len(matched))
	for _, be := range buf {
		if !matchSet[be.event.ID] {
			filtered = append(filtered, be)
		}
	}

	if len(filtered) == 0 {
		delete(d.buffers, cwd)
	} else {
		d.buffers[cwd] = filtered
	}
}

// --- Heuristic helpers ---

// baseCommand extracts the first token (the binary name) from a command string.
func baseCommand(cmd string) string {
	cmd = strings.TrimSpace(cmd)
	// Handle common prefixes: sudo, nohup, time.
	for _, prefix := range []string{"sudo ", "nohup ", "time "} {
		if strings.HasPrefix(cmd, prefix) {
			cmd = strings.TrimPrefix(cmd, prefix)
			cmd = strings.TrimSpace(cmd)
		}
	}
	parts := strings.Fields(cmd)
	if len(parts) == 0 {
		return ""
	}
	// Handle "env" prefix: skip env and any VAR=VALUE pairs.
	idx := 0
	if parts[0] == "env" {
		idx = 1
		for idx < len(parts) && strings.Contains(parts[idx], "=") {
			idx++
		}
	}
	if idx >= len(parts) {
		return ""
	}
	return filepath.Base(parts[idx])
}

// extractTargets finds path-like arguments in a command string.
func extractTargets(cmd string) []string {
	parts := strings.Fields(cmd)
	var targets []string
	for _, p := range parts[1:] {
		if strings.HasPrefix(p, "-") {
			continue
		}
		if isPathLike(p) {
			targets = append(targets, p)
		}
	}
	return targets
}

// isPathLike checks if a token looks like a file path.
func isPathLike(s string) bool {
	if strings.Contains(s, "/") || strings.Contains(s, "\\") {
		return true
	}
	ext := filepath.Ext(s)
	switch ext {
	case ".go", ".ts", ".js", ".py", ".rs", ".java", ".c", ".cpp", ".h",
		".json", ".yaml", ".yml", ".toml", ".md", ".txt", ".sh",
		".css", ".html", ".sql", ".rb", ".php", ".swift", ".kt":
		return true
	}
	return false
}

// toInt converts various numeric types to int.
func toInt(v any) int {
	switch n := v.(type) {
	case int:
		return n
	case float64:
		return int(n)
	case int64:
		return int(n)
	case json.Number:
		i, _ := n.Int64()
		return int(i)
	default:
		return 0
	}
}
