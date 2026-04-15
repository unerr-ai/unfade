package platform

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"testing"
	"time"
)

// testSocketPath creates a short socket path under /tmp to avoid macOS 104-byte limit.
func testSocketPath(t *testing.T, name string) string {
	t.Helper()
	path := fmt.Sprintf("/tmp/uf-%s-%d.sock", name, os.Getpid())
	t.Cleanup(func() { os.Remove(path) })
	return path
}

func TestIPCServer_HandlesStatusCommand(t *testing.T) {
	socketPath := testSocketPath(t, "stat")
	log := NewLogger(LevelError)

	handler := func(req IPCRequest) IPCResponse {
		if req.Cmd == "status" {
			return IPCResponse{OK: true, Data: map[string]any{"status": "running"}}
		}
		return IPCResponse{OK: false, Error: "unknown"}
	}

	srv := NewIPCServer(socketPath, handler, log)
	if err := srv.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer srv.Stop()

	time.Sleep(10 * time.Millisecond)

	resp := sendTestCommand(t, socketPath, IPCRequest{Cmd: "status"})
	if !resp.OK {
		t.Errorf("expected ok=true, got false: %s", resp.Error)
	}
	if resp.Data["status"] != "running" {
		t.Errorf("status = %v, want running", resp.Data["status"])
	}
}

func TestIPCServer_HandlesUnknownCommand(t *testing.T) {
	socketPath := testSocketPath(t, "unk")
	log := NewLogger(LevelError)

	handler := func(req IPCRequest) IPCResponse {
		return IPCResponse{OK: false, Error: "unknown command: " + req.Cmd}
	}

	srv := NewIPCServer(socketPath, handler, log)
	if err := srv.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer srv.Stop()

	time.Sleep(10 * time.Millisecond)

	resp := sendTestCommand(t, socketPath, IPCRequest{Cmd: "bogus"})
	if resp.OK {
		t.Error("expected ok=false for unknown command")
	}
}

func TestIPCServer_HandlesInvalidJSON(t *testing.T) {
	socketPath := testSocketPath(t, "inv")
	log := NewLogger(LevelError)

	srv := NewIPCServer(socketPath, func(req IPCRequest) IPCResponse {
		return IPCResponse{OK: true}
	}, log)
	if err := srv.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer srv.Stop()

	time.Sleep(10 * time.Millisecond)

	conn, err := net.Dial("unix", socketPath)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	_, _ = conn.Write([]byte("not json\n"))

	scanner := bufio.NewScanner(conn)
	if !scanner.Scan() {
		t.Fatal("expected response for invalid JSON")
	}

	var resp IPCResponse
	if err := json.Unmarshal(scanner.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if resp.OK {
		t.Error("expected ok=false for invalid JSON")
	}
}

func TestIPCServer_StopCleansUpSocket(t *testing.T) {
	socketPath := testSocketPath(t, "stop")
	log := NewLogger(LevelError)

	srv := NewIPCServer(socketPath, func(req IPCRequest) IPCResponse {
		return IPCResponse{OK: true}
	}, log)
	if err := srv.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}

	srv.Stop()

	_, err := net.Dial("unix", socketPath)
	if err == nil {
		t.Error("socket should be removed after Stop")
	}
}

func TestIPCServer_MultipleConcurrentConnections(t *testing.T) {
	socketPath := testSocketPath(t, "conc")
	log := NewLogger(LevelError)

	handler := func(req IPCRequest) IPCResponse {
		return IPCResponse{OK: true, Data: map[string]any{"cmd": req.Cmd}}
	}

	srv := NewIPCServer(socketPath, handler, log)
	if err := srv.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer srv.Stop()

	time.Sleep(10 * time.Millisecond)

	done := make(chan bool, 5)
	for i := 0; i < 5; i++ {
		go func() {
			resp := sendTestCommand(t, socketPath, IPCRequest{Cmd: "status"})
			done <- resp.OK
		}()
	}

	for i := 0; i < 5; i++ {
		if ok := <-done; !ok {
			t.Error("concurrent request failed")
		}
	}
}

func sendTestCommand(t *testing.T, socketPath string, req IPCRequest) IPCResponse {
	t.Helper()

	conn, err := net.DialTimeout("unix", socketPath, 2*time.Second)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	_ = conn.SetDeadline(time.Now().Add(2 * time.Second))

	data, _ := json.Marshal(req)
	data = append(data, '\n')
	if _, err := conn.Write(data); err != nil {
		t.Fatalf("write: %v", err)
	}

	scanner := bufio.NewScanner(conn)
	if !scanner.Scan() {
		t.Fatal("no response from server")
	}

	var resp IPCResponse
	if err := json.Unmarshal(scanner.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return resp
}
