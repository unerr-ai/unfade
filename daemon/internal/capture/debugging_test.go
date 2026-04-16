// Tests for UF-064: Debugging session detection
// T-175 through T-180

package capture

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func makeTerminalEvent(cmd string, exit int, cwd string) CaptureEvent {
	return CaptureEvent{
		ID:        uuid.New().String(),
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Source:    "terminal",
		Type:      "command",
		Content:   EventContent{Summary: cmd},
		Metadata: map[string]any{
			"cmd":      cmd,
			"exit":     exit,
			"duration": 2.0,
			"cwd":      cwd,
		},
	}
}

// T-175: detects debugging session with 3+ related commands and errors
func TestDebuggingDetector_DetectsSession(t *testing.T) {
	eventCh := make(chan CaptureEvent, 10)
	det := NewDebuggingDetector(eventCh)

	det.ProcessEvent(makeTerminalEvent("npm test", 1, "/project"))
	det.ProcessEvent(makeTerminalEvent("npm test --verbose", 1, "/project"))

	// Third event should trigger detection.
	det.ProcessEvent(makeTerminalEvent("npm test --debug", 0, "/project"))

	select {
	case event := <-eventCh:
		if event.Type != "debugging_session" {
			t.Errorf("type = %q, want debugging_session", event.Type)
		}
		if event.Source != "terminal" {
			t.Errorf("source = %q, want terminal", event.Source)
		}
		cmdCount, _ := event.Metadata["command_count"].(int)
		if cmdCount != 3 {
			t.Errorf("command_count = %d, want 3", cmdCount)
		}
		resolved, _ := event.Metadata["resolved"].(bool)
		if !resolved {
			t.Error("expected resolved=true since last command succeeded")
		}
	case <-time.After(1 * time.Second):
		t.Fatal("timed out waiting for debugging session event")
	}
}

// T-176: does not trigger without errors
func TestDebuggingDetector_NoErrorsNoSession(t *testing.T) {
	eventCh := make(chan CaptureEvent, 10)
	det := NewDebuggingDetector(eventCh)

	det.ProcessEvent(makeTerminalEvent("npm test", 0, "/project"))
	det.ProcessEvent(makeTerminalEvent("npm test --verbose", 0, "/project"))
	det.ProcessEvent(makeTerminalEvent("npm test --debug", 0, "/project"))

	select {
	case event := <-eventCh:
		t.Errorf("unexpected session event: %+v", event)
	case <-time.After(200 * time.Millisecond):
		// Expected — no session without errors.
	}
}

// T-177: does not trigger with fewer than 3 commands
func TestDebuggingDetector_TooFewCommands(t *testing.T) {
	eventCh := make(chan CaptureEvent, 10)
	det := NewDebuggingDetector(eventCh)

	det.ProcessEvent(makeTerminalEvent("npm test", 1, "/project"))
	det.ProcessEvent(makeTerminalEvent("npm test --verbose", 1, "/project"))

	select {
	case event := <-eventCh:
		t.Errorf("unexpected session with only 2 commands: %+v", event)
	case <-time.After(200 * time.Millisecond):
		// Expected.
	}
}

// T-178: ignores non-terminal events
func TestDebuggingDetector_IgnoresNonTerminal(t *testing.T) {
	eventCh := make(chan CaptureEvent, 10)
	det := NewDebuggingDetector(eventCh)

	gitEvent := CaptureEvent{
		ID:        uuid.New().String(),
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Source:    "git",
		Type:      "commit",
		Content:   EventContent{Summary: "fix: something"},
		Metadata: map[string]any{
			"cmd":  "git commit",
			"exit": 0,
			"cwd":  "/project",
		},
	}

	det.ProcessEvent(gitEvent)
	det.ProcessEvent(gitEvent)
	det.ProcessEvent(gitEvent)

	select {
	case event := <-eventCh:
		t.Errorf("unexpected session from non-terminal events: %+v", event)
	case <-time.After(200 * time.Millisecond):
		// Expected.
	}
}

// T-179: groups by base command correctly
func TestDebuggingDetector_GroupsByBaseCommand(t *testing.T) {
	eventCh := make(chan CaptureEvent, 10)
	det := NewDebuggingDetector(eventCh)

	// Mix of npm and cargo — neither reaches 3 alone.
	det.ProcessEvent(makeTerminalEvent("npm test", 1, "/project"))
	det.ProcessEvent(makeTerminalEvent("cargo build", 1, "/project"))
	det.ProcessEvent(makeTerminalEvent("npm run lint", 1, "/project"))
	det.ProcessEvent(makeTerminalEvent("cargo test", 0, "/project"))

	select {
	case event := <-eventCh:
		t.Errorf("unexpected session with mixed commands: %+v", event)
	case <-time.After(200 * time.Millisecond):
		// Expected.
	}
}

// T-180: tracks separate cwds independently
func TestDebuggingDetector_SeparateCwds(t *testing.T) {
	eventCh := make(chan CaptureEvent, 10)
	det := NewDebuggingDetector(eventCh)

	det.ProcessEvent(makeTerminalEvent("npm test", 1, "/project-a"))
	det.ProcessEvent(makeTerminalEvent("npm test", 1, "/project-b"))
	det.ProcessEvent(makeTerminalEvent("npm test --verbose", 1, "/project-a"))
	det.ProcessEvent(makeTerminalEvent("npm test --verbose", 1, "/project-b"))

	select {
	case event := <-eventCh:
		t.Errorf("unexpected session across cwds: %+v", event)
	case <-time.After(200 * time.Millisecond):
		// Expected.
	}

	// Now add a third to /project-a — should trigger.
	det.ProcessEvent(makeTerminalEvent("npm test --debug", 0, "/project-a"))

	select {
	case event := <-eventCh:
		if event.Type != "debugging_session" {
			t.Errorf("type = %q, want debugging_session", event.Type)
		}
		cwd, _ := event.Metadata["cwd"].(string)
		if cwd != "/project-a" {
			t.Errorf("cwd = %q, want /project-a", cwd)
		}
	case <-time.After(1 * time.Second):
		t.Fatal("timed out waiting for debugging session")
	}
}

func TestBaseCommand(t *testing.T) {
	tests := []struct {
		cmd  string
		want string
	}{
		{"npm test", "npm"},
		{"cargo build --release", "cargo"},
		{"python main.py", "python"},
		{"/usr/local/bin/node script.js", "node"},
		{"sudo npm install", "npm"},
		{"env VAR=1 go test", "go"},
		{"", ""},
	}

	for _, tt := range tests {
		got := baseCommand(tt.cmd)
		if got != tt.want {
			t.Errorf("baseCommand(%q) = %q, want %q", tt.cmd, got, tt.want)
		}
	}
}

func TestIsPathLike(t *testing.T) {
	tests := []struct {
		s    string
		want bool
	}{
		{"src/main.go", true},
		{"main.py", true},
		{"--verbose", false},
		{"test", false},
		{"./config.json", true},
	}

	for _, tt := range tests {
		got := isPathLike(tt.s)
		if got != tt.want {
			t.Errorf("isPathLike(%q) = %v, want %v", tt.s, got, tt.want)
		}
	}
}

func TestDebuggingDetector_SessionMetadata(t *testing.T) {
	eventCh := make(chan CaptureEvent, 10)
	det := NewDebuggingDetector(eventCh)

	det.ProcessEvent(makeTerminalEvent("go test ./...", 1, "/goproject"))
	det.ProcessEvent(makeTerminalEvent("go test -v ./...", 1, "/goproject"))
	det.ProcessEvent(makeTerminalEvent("go test -run TestFoo ./...", 0, "/goproject"))

	select {
	case event := <-eventCh:
		commands, ok := event.Metadata["commands"].([]string)
		if !ok {
			t.Fatal("commands metadata missing or wrong type")
		}
		if len(commands) != 3 {
			t.Errorf("commands count = %d, want 3", len(commands))
		}

		exitCodes, ok := event.Metadata["exit_codes"].([]int)
		if !ok {
			t.Fatal("exit_codes metadata missing or wrong type")
		}
		if len(exitCodes) != 3 {
			t.Errorf("exit_codes count = %d, want 3", len(exitCodes))
		}
		if exitCodes[0] != 1 || exitCodes[1] != 1 || exitCodes[2] != 0 {
			t.Errorf("exit_codes = %v, want [1, 1, 0]", exitCodes)
		}

		baseCmd, _ := event.Metadata["base_cmd"].(string)
		if baseCmd != "go" {
			t.Errorf("base_cmd = %q, want go", baseCmd)
		}

		resolutionCmd, _ := event.Metadata["resolution_cmd"].(string)
		if resolutionCmd != "go test -run TestFoo ./..." {
			t.Errorf("resolution_cmd = %q, want 'go test -run TestFoo ./...'", resolutionCmd)
		}
	case <-time.After(1 * time.Second):
		t.Fatal("timed out")
	}
}
