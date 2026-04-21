// FILE: daemon/cmd/unfade-send/main.go
// unfade-send — sends commands to the running unfaded daemon via IPC.
// Used by shell hooks and integrations to inject events or query status.
//
// Socket resolution (Phase 5.6):
//  1. If --project-dir is set, use <project-dir>/.unfade/state/daemon.sock
//  2. Otherwise, read registry.v1.json and find longest-prefix match for cwd
//  3. Fallback to ~/.unfade/state/daemon.sock
//
// Usage:
//
//	unfade-send status
//	unfade-send stop
//	unfade-send distill
//	echo '{"cmd":"status"}' | unfade-send --raw
package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type ipcRequest struct {
	Cmd  string         `json:"cmd"`
	Args map[string]any `json:"args,omitempty"`
}

type ipcResponse struct {
	OK    bool           `json:"ok"`
	Data  map[string]any `json:"data,omitempty"`
	Error string         `json:"error,omitempty"`
}

type registryV1 struct {
	SchemaVersion int         `json:"schemaVersion"`
	Repos         []repoEntry `json:"repos"`
}

type repoEntry struct {
	ID    string `json:"id"`
	Root  string `json:"root"`
	Label string `json:"label"`
}

func main() {
	var projectDir string
	var raw bool
	var timeout time.Duration
	flag.StringVar(&projectDir, "project-dir", "", "Path to the project root")
	flag.BoolVar(&raw, "raw", false, "Read raw JSON from stdin instead of using positional command")
	flag.DurationVar(&timeout, "timeout", 3*time.Second, "Connection timeout")
	flag.Parse()

	var req ipcRequest

	if raw {
		scanner := bufio.NewScanner(os.Stdin)
		if !scanner.Scan() {
			fmt.Fprintln(os.Stderr, "unfade-send: no input on stdin")
			os.Exit(1)
		}
		if err := json.Unmarshal(scanner.Bytes(), &req); err != nil {
			fmt.Fprintf(os.Stderr, "unfade-send: invalid JSON: %v\n", err)
			os.Exit(1)
		}
	} else {
		args := flag.Args()
		if len(args) == 0 {
			fmt.Fprintln(os.Stderr, "usage: unfade-send <command> [--project-dir <path>]")
			fmt.Fprintln(os.Stderr, "commands: status, stop, distill")
			os.Exit(1)
		}
		req = ipcRequest{Cmd: args[0]}
	}

	socketPath := resolveSocketPath(projectDir)

	resp, err := sendCommand(socketPath, req, timeout)
	if err != nil {
		fmt.Fprintf(os.Stderr, "unfade-send: %v\n", err)
		os.Exit(1)
	}

	out, _ := json.MarshalIndent(resp, "", "  ")
	fmt.Println(string(out))

	if !resp.OK {
		os.Exit(1)
	}
}

func sendCommand(socketPath string, req ipcRequest, timeout time.Duration) (*ipcResponse, error) {
	conn, err := net.DialTimeout("unix", socketPath, timeout)
	if err != nil {
		return nil, fmt.Errorf("capture engine is not running (socket: %s): %w", socketPath, err)
	}
	defer conn.Close()

	_ = conn.SetDeadline(time.Now().Add(timeout))

	data, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}
	data = append(data, '\n')
	if _, err := conn.Write(data); err != nil {
		return nil, fmt.Errorf("write to socket: %w", err)
	}

	scanner := bufio.NewScanner(conn)
	if !scanner.Scan() {
		if scanner.Err() != nil {
			return nil, fmt.Errorf("read response: %w", scanner.Err())
		}
		return nil, fmt.Errorf("daemon closed connection without response")
	}

	var resp ipcResponse
	if err := json.Unmarshal(scanner.Bytes(), &resp); err != nil {
		return nil, fmt.Errorf("invalid response from daemon: %w", err)
	}

	return &resp, nil
}

func resolveSocketPath(projectDir string) string {
	// Global-first: daemon sockets live at ~/.unfade/state/daemons/<projectId>/daemon.sock.
	// If --project-dir is given, find its projectId from the registry.
	// Otherwise, match cwd against registry entries.
	if projectDir != "" {
		if id := findProjectIdForPath(projectDir); id != "" {
			home, _ := os.UserHomeDir()
			return filepath.Join(home, ".unfade", "state", "daemons", id, "daemon.sock")
		}
	}

	if match := resolveFromRegistry(); match != "" {
		return match
	}

	// Fallback: global state socket
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".unfade", "state", "daemon.sock")
}

func findProjectIdForPath(targetPath string) string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	registryPath := filepath.Join(home, ".unfade", "state", "registry.v1.json")
	data, err := os.ReadFile(registryPath)
	if err != nil {
		return ""
	}
	var reg registryV1
	if err := json.Unmarshal(data, &reg); err != nil {
		return ""
	}
	abs, _ := filepath.Abs(targetPath)
	for _, repo := range reg.Repos {
		root, _ := filepath.Abs(repo.Root)
		if abs == root || strings.HasPrefix(abs, root+string(filepath.Separator)) {
			return repo.ID
		}
	}
	return ""
}

func resolveFromRegistry() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}

	registryPath := filepath.Join(home, ".unfade", "state", "registry.v1.json")
	data, err := os.ReadFile(registryPath)
	if err != nil {
		return ""
	}

	var reg registryV1
	if err := json.Unmarshal(data, &reg); err != nil || reg.SchemaVersion != 1 {
		return ""
	}

	if len(reg.Repos) == 0 {
		return ""
	}

	cwd, err := os.Getwd()
	if err != nil {
		return ""
	}
	cwd, _ = filepath.Abs(cwd)

	sort.Slice(reg.Repos, func(i, j int) bool {
		return len(reg.Repos[i].Root) > len(reg.Repos[j].Root)
	})

	for _, repo := range reg.Repos {
		root, _ := filepath.Abs(repo.Root)
		if cwd == root || strings.HasPrefix(cwd, root+string(filepath.Separator)) {
			return filepath.Join(home, ".unfade", "state", "daemons", repo.ID, "daemon.sock")
		}
	}

	return ""
}
