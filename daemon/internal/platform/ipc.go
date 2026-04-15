// FILE: daemon/internal/platform/ipc.go
// IPC server for CLI ↔ daemon communication over Unix domain socket.
// Protocol: one JSON line request, one JSON line response, then close.

package platform

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sync"
)

// IPCRequest is the JSON structure sent by CLI clients.
type IPCRequest struct {
	Cmd  string         `json:"cmd"`
	Args map[string]any `json:"args,omitempty"`
}

// IPCResponse is the JSON structure returned to CLI clients.
type IPCResponse struct {
	OK    bool           `json:"ok"`
	Data  map[string]any `json:"data,omitempty"`
	Error string         `json:"error,omitempty"`
}

// IPCHandler processes an IPC request and returns a response.
type IPCHandler func(req IPCRequest) IPCResponse

// IPCServer listens on a Unix domain socket and dispatches commands.
type IPCServer struct {
	socketPath string
	listener   net.Listener
	handler    IPCHandler
	logger     *Logger
	wg         sync.WaitGroup
	done       chan struct{}
}

// NewIPCServer creates an IPC server bound to the given socket path.
// The handler is called for each incoming request.
func NewIPCServer(socketPath string, handler IPCHandler, logger *Logger) *IPCServer {
	return &IPCServer{
		socketPath: socketPath,
		handler:    handler,
		logger:     logger,
		done:       make(chan struct{}),
	}
}

// Start begins listening on the Unix socket.
// Blocks until Stop is called or an error occurs during listen.
func (s *IPCServer) Start() error {
	dir := filepath.Dir(s.socketPath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create socket directory: %w", err)
	}

	// Remove stale socket file if it exists.
	_ = os.Remove(s.socketPath)

	ln, err := net.Listen("unix", s.socketPath)
	if err != nil {
		return fmt.Errorf("listen on socket %s: %w", s.socketPath, err)
	}
	s.listener = ln

	s.logger.Info("IPC server listening", map[string]any{"socket": s.socketPath})

	// Accept loop.
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				select {
				case <-s.done:
					return // Normal shutdown.
				default:
					s.logger.Error("IPC accept error", map[string]any{"error": err.Error()})
					return
				}
			}
			s.wg.Add(1)
			go s.handleConn(conn)
		}
	}()

	return nil
}

// Stop gracefully shuts down the IPC server.
func (s *IPCServer) Stop() {
	close(s.done)
	if s.listener != nil {
		_ = s.listener.Close()
	}
	s.wg.Wait()
	_ = os.Remove(s.socketPath)
	s.logger.Info("IPC server stopped")
}

// SocketPath returns the path to the Unix socket.
func (s *IPCServer) SocketPath() string {
	return s.socketPath
}

func (s *IPCServer) handleConn(conn net.Conn) {
	defer s.wg.Done()
	defer conn.Close()

	scanner := bufio.NewScanner(conn)
	if !scanner.Scan() {
		return
	}

	line := scanner.Bytes()
	var req IPCRequest
	if err := json.Unmarshal(line, &req); err != nil {
		resp := IPCResponse{OK: false, Error: "invalid JSON request"}
		data, _ := json.Marshal(resp)
		data = append(data, '\n')
		_, _ = conn.Write(data)
		return
	}

	s.logger.Debug("IPC request", map[string]any{"cmd": req.Cmd})

	resp := s.handler(req)
	data, err := json.Marshal(resp)
	if err != nil {
		resp = IPCResponse{OK: false, Error: "internal serialization error"}
		data, _ = json.Marshal(resp)
	}
	data = append(data, '\n')
	_, _ = conn.Write(data)
}
