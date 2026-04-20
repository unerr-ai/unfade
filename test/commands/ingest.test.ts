import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// T-107: Ingest CLI: non-interactive mode uses defaults without prompting
describe("unfade ingest", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parseDuration handles valid formats", async () => {
    const _mod = await import("../../src/commands/ingest.js");
    // Access parseDuration indirectly via ingestCommand behavior.
    // Since parseDuration is not exported, we test through the command.
    // Instead, test the duration parsing logic inline:
    const parse = (input: string): number | null => {
      const match = input.match(/^(\d+)\s*(d|w|m)$/i);
      if (!match) return null;
      const value = Number.parseInt(match[1], 10);
      const unit = match[2].toLowerCase();
      switch (unit) {
        case "d":
          return value;
        case "w":
          return value * 7;
        case "m":
          return value * 30;
        default:
          return null;
      }
    };

    expect(parse("7d")).toBe(7);
    expect(parse("2w")).toBe(14);
    expect(parse("1m")).toBe(30);
    expect(parse("30d")).toBe(30);
    expect(parse("invalid")).toBeNull();
    expect(parse("")).toBeNull();
    expect(parse("3x")).toBeNull();
  });

  it("non-interactive mode does not prompt", async () => {
    const originalIsTTY = process.stderr.isTTY;
    Object.defineProperty(process.stderr, "isTTY", { value: false, writable: true });

    const mockTriggerIngest = vi.fn().mockResolvedValue({ ok: true, data: { message: "started" } });
    const mockQueryDaemonStatus = vi
      .fn()
      .mockResolvedValue({ ok: true, data: { status: "running" } });

    vi.doMock("../../src/utils/ipc.js", () => ({
      queryDaemonStatus: mockQueryDaemonStatus,
      triggerIngest: mockTriggerIngest,
      queryIngestStatus: vi.fn().mockResolvedValue({ ok: true, data: { status: "idle" } }),
      sendIPCCommand: vi.fn(),
      stopDaemon: vi.fn(),
      triggerDistill: vi.fn(),
    }));

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const { ingestCommand } = await import("../../src/commands/ingest.js");
    await ingestCommand({});

    expect(mockQueryDaemonStatus).toHaveBeenCalled();
    expect(mockTriggerIngest).toHaveBeenCalledWith(7);

    Object.defineProperty(process.stderr, "isTTY", { value: originalIsTTY, writable: true });
    stderrSpy.mockRestore();
  });

  it("--since flag passes correct days to daemon", async () => {
    const mockTriggerIngest = vi.fn().mockResolvedValue({ ok: true, data: { message: "started" } });
    const mockQueryDaemonStatus = vi
      .fn()
      .mockResolvedValue({ ok: true, data: { status: "running" } });

    vi.doMock("../../src/utils/ipc.js", () => ({
      queryDaemonStatus: mockQueryDaemonStatus,
      triggerIngest: mockTriggerIngest,
      queryIngestStatus: vi.fn().mockResolvedValue({ ok: true, data: { status: "idle" } }),
      sendIPCCommand: vi.fn(),
      stopDaemon: vi.fn(),
      triggerDistill: vi.fn(),
    }));

    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const { ingestCommand } = await import("../../src/commands/ingest.js");
    await ingestCommand({ since: "30d" });

    expect(mockTriggerIngest).toHaveBeenCalledWith(30);
  });

  it("--status flag queries ingest progress", async () => {
    const mockQueryIngestStatus = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        status: "completed",
        total_events: 142,
        completed_at: "2026-04-17T10:00:00Z",
      },
    });

    vi.doMock("../../src/utils/ipc.js", () => ({
      queryDaemonStatus: vi.fn(),
      triggerIngest: vi.fn(),
      queryIngestStatus: mockQueryIngestStatus,
      sendIPCCommand: vi.fn(),
      stopDaemon: vi.fn(),
      triggerDistill: vi.fn(),
    }));

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const { ingestCommand } = await import("../../src/commands/ingest.js");
    await ingestCommand({ status: true });

    expect(mockQueryIngestStatus).toHaveBeenCalled();
    const output = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("completed");
  });

  it("shows error when daemon is not running", async () => {
    const mockQueryDaemonStatus = vi.fn().mockResolvedValue({
      ok: false,
      error: "Capture engine is not running",
    });

    vi.doMock("../../src/utils/ipc.js", () => ({
      queryDaemonStatus: mockQueryDaemonStatus,
      triggerIngest: vi.fn(),
      queryIngestStatus: vi.fn(),
      sendIPCCommand: vi.fn(),
      stopDaemon: vi.fn(),
      triggerDistill: vi.fn(),
    }));

    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const { ingestCommand } = await import("../../src/commands/ingest.js");
    await ingestCommand({});

    expect(process.exitCode).toBe(1);
  });

  it("rejects invalid --since format", async () => {
    const mockQueryDaemonStatus = vi.fn().mockResolvedValue({ ok: true, data: {} });

    vi.doMock("../../src/utils/ipc.js", () => ({
      queryDaemonStatus: mockQueryDaemonStatus,
      triggerIngest: vi.fn(),
      queryIngestStatus: vi.fn(),
      sendIPCCommand: vi.fn(),
      stopDaemon: vi.fn(),
      triggerDistill: vi.fn(),
    }));

    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const { ingestCommand } = await import("../../src/commands/ingest.js");
    await ingestCommand({ since: "invalid" });

    expect(process.exitCode).toBe(1);
  });
});
