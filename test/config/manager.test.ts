import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/manager.js";

function makeTmpDir(): string {
  const dir = join(tmpdir(), `unfade-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("loadConfig", () => {
  let userDir: string;
  let projectDir: string;

  beforeEach(() => {
    userDir = makeTmpDir();
    projectDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(userDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("returns valid config with all defaults from empty input", () => {
    const config = loadConfig({ userConfigDir: userDir, projectDataDir: projectDir });
    expect(config.version).toBe(2);
    expect(config.capture.sources.git).toBe(true);
    expect(config.capture.sources.aiSession).toBe(true);
    expect(config.capture.sources.terminal).toBe(false);
    expect(config.distill.provider).toBe("ollama");
    expect(config.distill.model).toBe("llama3.2");
    expect(config.mcp.enabled).toBe(true);
    expect(config.mcp.httpPort).toBe(7654);
  });

  it("loads user config and merges with defaults", () => {
    writeFileSync(
      join(userDir, "config.json"),
      JSON.stringify({ distill: { provider: "anthropic", model: "claude-3" } }),
    );
    const config = loadConfig({ userConfigDir: userDir, projectDataDir: projectDir });
    expect(config.distill.provider).toBe("anthropic");
    expect(config.distill.model).toBe("claude-3");
    expect(config.capture.sources.git).toBe(true); // default preserved
  });

  it("project config overrides user config", () => {
    writeFileSync(
      join(userDir, "config.json"),
      JSON.stringify({ distill: { model: "user-model" } }),
    );
    writeFileSync(
      join(projectDir, "config.json"),
      JSON.stringify({ distill: { model: "project-model" } }),
    );
    const config = loadConfig({ userConfigDir: userDir, projectDataDir: projectDir });
    expect(config.distill.model).toBe("project-model");
  });

  it("env vars override all config files", () => {
    writeFileSync(join(projectDir, "config.json"), JSON.stringify({ mcp: { httpPort: 9999 } }));
    const config = loadConfig({
      userConfigDir: userDir,
      projectDataDir: projectDir,
      env: { UNFADE_MCP__HTTP_PORT: "8888" },
    });
    expect(config.mcp.httpPort).toBe(8888);
  });

  it("ignores malformed config files gracefully", () => {
    writeFileSync(join(userDir, "config.json"), "not json at all");
    const config = loadConfig({ userConfigDir: userDir, projectDataDir: projectDir });
    expect(config.version).toBe(2); // still valid defaults
  });

  it("ignores config files that are arrays", () => {
    writeFileSync(join(projectDir, "config.json"), JSON.stringify([1, 2, 3]));
    const config = loadConfig({ userConfigDir: userDir, projectDataDir: projectDir });
    expect(config.version).toBe(2);
  });

  it("handles missing config directories gracefully", () => {
    const config = loadConfig({
      userConfigDir: "/tmp/nonexistent-unfade-dir",
      projectDataDir: "/tmp/nonexistent-unfade-proj",
    });
    expect(config.version).toBe(2);
  });

  it("coerces env var boolean and number values", () => {
    const config = loadConfig({
      userConfigDir: userDir,
      projectDataDir: projectDir,
      env: {
        UNFADE_CAPTURE__SOURCES__TERMINAL: "true",
        UNFADE_MCP__HTTP_PORT: "7700",
      },
    });
    expect(config.capture.sources.terminal).toBe(true);
    expect(config.mcp.httpPort).toBe(7700);
  });
});
