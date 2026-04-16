// T-229, T-230, T-231: Config migration infrastructure tests
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyMigrations,
  CONFIG_MIGRATIONS,
  LATEST_CONFIG_VERSION,
  migrateConfigOnDisk,
} from "../../src/config/config-migrations.js";

function makeTmpDir(): string {
  const dir = join(tmpdir(), `unfade-test-migrations-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("Config migrations (UF-088)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // T-229: v1 → v2 migration adds site section
  it("T-229: migrates v1 config to v2 with site section", () => {
    const v1Config = {
      version: 1,
      capture: { sources: { git: true, aiSession: true, terminal: false, browser: false } },
      distill: { provider: "ollama", model: "llama3.2" },
    };

    const { config, fromVersion, toVersion } = applyMigrations(v1Config as Record<string, unknown>);

    expect(fromVersion).toBe(1);
    expect(toVersion).toBe(2);
    expect(config.version).toBe(2);
    expect(config.site).toEqual({ outputDir: ".unfade/site" });
  });

  // T-230: migration preserves existing user values
  it("T-230: preserves existing values during v1 → v2 migration", () => {
    const v1Config = {
      version: 1,
      capture: { sources: { git: false, aiSession: true, terminal: true, browser: false } },
      distill: { provider: "anthropic", model: "claude-3", apiKey: "sk-test" },
      mcp: { enabled: false, httpPort: 9999 },
    };

    const { config } = applyMigrations(v1Config as Record<string, unknown>);

    // All original values preserved
    expect(config.version).toBe(2);
    expect((config.capture as Record<string, unknown>).sources).toEqual({
      git: false,
      aiSession: true,
      terminal: true,
      browser: false,
    });
    expect((config.distill as Record<string, unknown>).provider).toBe("anthropic");
    expect((config.distill as Record<string, unknown>).model).toBe("claude-3");
    expect((config.distill as Record<string, unknown>).apiKey).toBe("sk-test");
    expect((config.mcp as Record<string, unknown>).enabled).toBe(false);
    expect((config.mcp as Record<string, unknown>).httpPort).toBe(9999);

    // New field added
    expect(config.site).toEqual({ outputDir: ".unfade/site" });
  });

  // T-231: creates backup before migrating on disk
  it("T-231: creates config.backup.json before migrating on disk", () => {
    const v1Config = { version: 1, distill: { provider: "ollama" } };
    const configPath = join(tmpDir, "config.json");
    const backupPath = join(tmpDir, "config.backup.json");

    writeFileSync(configPath, JSON.stringify(v1Config, null, 2));

    const result = migrateConfigOnDisk(tmpDir);

    // Migration should have occurred
    expect(result).not.toBeNull();
    expect(result!.migrated).toBe(true);
    expect(result!.fromVersion).toBe(1);
    expect(result!.toVersion).toBe(2);
    expect(result!.backupPath).toBe(backupPath);

    // Backup should exist with original content
    expect(existsSync(backupPath)).toBe(true);
    const backup = JSON.parse(readFileSync(backupPath, "utf-8"));
    expect(backup.version).toBe(1);

    // Migrated config should be v2
    const migrated = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(migrated.version).toBe(2);
    expect(migrated.site).toEqual({ outputDir: ".unfade/site" });
    expect(migrated.distill.provider).toBe("ollama");
  });

  it("skips migration when config is already at latest version", () => {
    const v2Config = { version: LATEST_CONFIG_VERSION, distill: { provider: "ollama" } };
    writeFileSync(join(tmpDir, "config.json"), JSON.stringify(v2Config));

    const result = migrateConfigOnDisk(tmpDir);
    expect(result).toBeNull();
  });

  it("returns null when config.json does not exist", () => {
    const result = migrateConfigOnDisk(tmpDir);
    expect(result).toBeNull();
  });

  it("handles malformed JSON gracefully", () => {
    writeFileSync(join(tmpDir, "config.json"), "not json");
    const result = migrateConfigOnDisk(tmpDir);
    expect(result).toBeNull();
  });

  it("handles array JSON gracefully", () => {
    writeFileSync(join(tmpDir, "config.json"), "[1,2,3]");
    const result = migrateConfigOnDisk(tmpDir);
    expect(result).toBeNull();
  });

  it("defaults missing version to 1", () => {
    const noVersionConfig = { distill: { provider: "ollama" } };
    const { fromVersion, toVersion } = applyMigrations(noVersionConfig as Record<string, unknown>);
    expect(fromVersion).toBe(1);
    expect(toVersion).toBe(2);
  });

  it("migration registry covers all versions up to latest", () => {
    expect(CONFIG_MIGRATIONS.length).toBeGreaterThan(0);
    const lastMigration = CONFIG_MIGRATIONS[CONFIG_MIGRATIONS.length - 1];
    expect(lastMigration.to).toBe(LATEST_CONFIG_VERSION);
  });
});
