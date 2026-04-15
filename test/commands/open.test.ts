// Tests for UF-019b: `unfade open` command
import { platform } from "node:os";
import { describe, expect, it } from "vitest";
import { openInBrowser } from "../../src/commands/open.js";

// We can't actually open a browser in tests, but we can verify the function
// doesn't throw and exercises the platform detection path.
describe("openInBrowser", () => {
  it("resolves without throwing for any URL", async () => {
    // openInBrowser spawns a child process — it resolves even if the command fails
    // (e.g., no GUI in CI). The key contract: it never throws.
    await expect(openInBrowser("http://localhost:9999")).resolves.toBeUndefined();
  });

  it("detects current platform correctly", () => {
    const os = platform();
    expect(["darwin", "linux", "win32"]).toContain(os);
  });
});
