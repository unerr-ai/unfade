// T-002, T-003: Logger tests
import { describe, expect, it, vi } from "vitest";

// We need a fresh logger for each test to avoid shared state
async function createLogger(config: { verbose?: boolean; quiet?: boolean }) {
  // Re-import to get a fresh module — but logger is a singleton.
  // Instead, we'll import and reconfigure.
  const { logger } = await import("../../src/utils/logger.js");
  logger.configure({ verbose: config.verbose ?? false, quiet: config.quiet ?? false });
  return logger;
}

describe("Logger", () => {
  it("T-002: info-level message writes to stderr, not stdout", async () => {
    const logger = await createLogger({});

    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    logger.info("test message");

    expect(stderrWrite).toHaveBeenCalled();
    const written = stderrWrite.mock.calls[0]?.[0] as string;
    expect(written).toContain("test message");

    expect(stdoutWrite).not.toHaveBeenCalled();

    stderrWrite.mockRestore();
    stdoutWrite.mockRestore();
  });

  it("T-003: debug-level message suppressed when verbose is false", async () => {
    const logger = await createLogger({ verbose: false });

    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    logger.debug("should not appear");

    expect(stderrWrite).not.toHaveBeenCalled();

    stderrWrite.mockRestore();
  });
});
