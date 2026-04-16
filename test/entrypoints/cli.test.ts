// T-001: CLI entry point: --help flag returns exit code 0 and includes "unfade" in output
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CLI_PATH = resolve(import.meta.dirname, "../../src/entrypoints/cli.ts");

describe("CLI entry point", () => {
  it("T-001: --help returns exit code 0 and includes 'unfade' in output", () => {
    const output = execFileSync("npx", ["tsx", CLI_PATH, "--help"], {
      encoding: "utf-8",
    });
    expect(output).toContain("unfade");
    expect(output).toContain("Commands:");
  });
});
