// T-036: autostart tests
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installAutostart } from "../../../src/services/init/autostart.js";

describe("installAutostart", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `unfade-test-autostart-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("T-036a: returns a valid AutostartResult", () => {
    const result = installAutostart(
      join(tempDir, "unfaded"),
      join(tempDir, "project"),
      join(tempDir, "state"),
    );

    expect(result.platform).toBeTruthy();
    // On macOS should be "darwin", on Linux "linux", otherwise unsupported.
    if (process.platform === "darwin" || process.platform === "linux") {
      // May or may not install depending on existing state, but should not throw.
      expect(typeof result.installed).toBe("boolean");
    } else {
      expect(result.installed).toBe(false);
    }
  });
});
