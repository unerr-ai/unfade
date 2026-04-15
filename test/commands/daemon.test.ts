// T-039: daemon command tests — verify stderr output, not stdout
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { daemonStatusCommand, daemonStopCommand } from "../../src/commands/daemon.js";

describe("daemonStopCommand", () => {
  let stderrOutput: string;
  const originalWrite = process.stderr.write;

  beforeEach(() => {
    stderrOutput = "";
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrOutput += String(chunk);
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stderr.write = originalWrite;
    process.exitCode = undefined;
  });

  it("T-039a: writes to stderr (not stdout) and handles no-daemon case", async () => {
    await daemonStopCommand();
    // With no daemon running, should show failure output on stderr.
    expect(stderrOutput.length).toBeGreaterThan(0);
    // Should contain the stop attempt message or error.
    expect(stderrOutput).toContain("capture engine");
  });
});

describe("daemonStatusCommand", () => {
  let stderrOutput: string;
  const originalWrite = process.stderr.write;

  beforeEach(() => {
    stderrOutput = "";
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrOutput += String(chunk);
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stderr.write = originalWrite;
  });

  it("T-039b: shows stopped status when daemon is not running", async () => {
    await daemonStatusCommand();
    // Should show stopped indicator on stderr.
    expect(stderrOutput.length).toBeGreaterThan(0);
    expect(stderrOutput).toContain("○");
  });
});
