import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UnfadeConfigSchema } from "../../../src/schemas/config.js";
import {
  applyWizardSelectionToConfig,
  type WizardLlmSelection,
} from "../../../src/services/init/llm-wizard.js";

describe("applyWizardSelectionToConfig", () => {
  let tmp: string;
  let prevCwd: string;

  beforeEach(() => {
    prevCwd = process.cwd();
    tmp = join(tmpdir(), `uf-llm-wiz-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(tmp, ".unfade"), { recursive: true });
    process.chdir(tmp);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  function readDistill(): WizardLlmSelection & Record<string, unknown> {
    const raw = JSON.parse(readFileSync(join(tmp, ".unfade", "config.json"), "utf-8"));
    return raw.distill;
  }

  it("writes ollama with api base", () => {
    const sel: WizardLlmSelection = {
      provider: "ollama",
      model: "mistral",
      apiBase: "http://localhost:11434/api",
    };
    applyWizardSelectionToConfig(tmp, sel);
    const d = readDistill();
    expect(d.provider).toBe("ollama");
    expect(d.model).toBe("mistral");
    expect(d.apiBase).toBe("http://localhost:11434/api");
    expect(d.apiKey).toBeUndefined();
    UnfadeConfigSchema.parse(
      JSON.parse(readFileSync(join(tmp, ".unfade", "config.json"), "utf-8")),
    );
  });

  it("writes custom OpenAI-compatible endpoint and optional key", () => {
    applyWizardSelectionToConfig(tmp, {
      provider: "custom",
      model: "local-model",
      apiBase: "http://127.0.0.1:9999/v1",
      apiKey: "sk-test",
    });
    const d = readDistill();
    expect(d.provider).toBe("custom");
    expect(d.model).toBe("local-model");
    expect(d.apiBase).toBe("http://127.0.0.1:9999/v1");
    expect(d.apiKey).toBe("sk-test");
  });

  it("clears keys for none", () => {
    writeFileSync(
      join(tmp, ".unfade", "config.json"),
      `${JSON.stringify(
        UnfadeConfigSchema.parse({
          distill: {
            provider: "openai",
            model: "gpt-4o-mini",
            apiKey: "x",
            apiBase: "https://api.openai.com/v1",
          },
        }),
        null,
        2,
      )}\n`,
      "utf-8",
    );
    applyWizardSelectionToConfig(tmp, { provider: "none", model: null });
    const d = readDistill();
    expect(d.provider).toBe("none");
    expect(d.apiKey).toBeUndefined();
    expect(d.apiBase).toBeUndefined();
  });
});
