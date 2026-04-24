// FILE: src/schemas/config.ts
// UnfadeConfig — configuration schema with full defaults.
// An empty object `{}` parsed through this schema produces a complete valid config.

import { z } from "zod";

const SourcesSchema = z.object({
  git: z.boolean().default(true),
  aiSession: z.boolean().default(true),
  terminal: z.boolean().default(false),
  browser: z.boolean().default(false),
});

const CaptureSchema = z.object({
  sources: SourcesSchema.default(() => SourcesSchema.parse({})),
  aiSessionPaths: z.array(z.string()).default(["~/.cursor/logs/", "~/.claude/sessions/"]),
  ignore: z.array(z.string()).default(["node_modules", ".git", "dist", "build"]),
});

/** Per-model limits for rate limiting and prompt sizing. */
const ModelLimitsSchema = z.object({
  /** Context window size in tokens. Used to cap prompt size. */
  contextWindow: z.number().int().positive().optional(),
  /** Maximum output tokens the model supports. */
  maxOutputTokens: z.number().int().positive().optional(),
  /** Maximum prompt characters (rough: 1 token ≈ 4 chars). Overrides auto-calculation from contextWindow. */
  maxPromptChars: z.number().int().positive().optional(),
  /** Requests per minute. Used for rate limiting synthesis calls. */
  rpm: z.number().int().positive().optional(),
  /** Tokens per minute. Used for rate limiting. */
  tpm: z.number().int().positive().optional(),
});

/**
 * Minimum context window (in tokens) required for reliable LLM-based processing.
 * All batching, prompt sizing, and synthesis operations assume at least this capacity.
 * Models below this threshold risk truncation, incomplete reasoning extraction, or silent failures.
 */
export const MIN_CONTEXT_WINDOW = 128_000;

/**
 * Known model defaults — used when no explicit modelLimits are configured.
 * Conservative estimates to avoid hitting provider limits.
 */
export const KNOWN_MODEL_DEFAULTS: Record<string, z.infer<typeof ModelLimitsSchema>> = {
  // OpenAI
  "gpt-4o": { contextWindow: 128_000, maxOutputTokens: 16_384, rpm: 500, tpm: 800_000 },
  "gpt-4o-mini": { contextWindow: 128_000, maxOutputTokens: 16_384, rpm: 500, tpm: 2_000_000 },
  "gpt-4-turbo": { contextWindow: 128_000, maxOutputTokens: 4_096, rpm: 500, tpm: 300_000 },
  "o3-mini": { contextWindow: 200_000, maxOutputTokens: 100_000, rpm: 500, tpm: 800_000 },
  // Anthropic
  "claude-sonnet-4-20250514": {
    contextWindow: 200_000,
    maxOutputTokens: 16_384,
    rpm: 50,
    tpm: 80_000,
  },
  "claude-haiku-3-5-20241022": {
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    rpm: 50,
    tpm: 100_000,
  },
  "claude-opus-4-20250514": {
    contextWindow: 200_000,
    maxOutputTokens: 16_384,
    rpm: 50,
    tpm: 40_000,
  },
  // Common custom/Fireworks models
  "accounts/fireworks/models/qwen3-vl-30b-a3b-instruct": {
    contextWindow: 32_768,
    maxOutputTokens: 8_192,
    maxPromptChars: 15_000,
    rpm: 600,
    tpm: 1_000_000,
  },
  // Ollama defaults (conservative)
  "llama3.2": { contextWindow: 8_192, maxOutputTokens: 4_096, rpm: 60, tpm: 100_000 },
  "llama3.1": { contextWindow: 128_000, maxOutputTokens: 4_096, rpm: 60, tpm: 100_000 },
};

const DistillSchema = z.object({
  schedule: z.string().default("0 18 * * *"),
  provider: z.enum(["ollama", "openai", "anthropic", "custom", "none"]).default("none"),
  model: z.string().default("llama3.2"),
  apiKey: z.string().optional(),
  apiBase: z.string().optional(),
  /** Override model limits. Auto-detected from known models if not set. */
  modelLimits: ModelLimitsSchema.optional(),
});

const McpSchema = z.object({
  enabled: z.boolean().default(true),
  transport: z.enum(["stdio", "http"]).default("stdio"),
  httpPort: z.number().default(7654),
});

const NotificationSchema = z.object({
  enabled: z.boolean().default(true),
  sound: z.boolean().default(false),
});

const SiteSchema = z.object({
  outputDir: z.string().default(".unfade/site"),
});

const PricingSchema = z.record(z.string(), z.number()).default({
  "claude-code": 0.01,
  cursor: 0.005,
  codex: 0.008,
  aider: 0.006,
});

const ActionsSchema = z.object({
  enabled: z.boolean().default(false),
  autoRules: z.boolean().default(false),
  ruleTarget: z.string().nullable().default(null),
  sessionContext: z.boolean().default(false),
  weeklyDigest: z.boolean().default(false),
  digestDay: z
    .enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"])
    .default("monday"),
});

const ExportSchema = z.object({
  requireConsent: z.boolean().default(true),
  redactionPolicy: z
    .enum(["aggregates-only", "with-labels", "with-names"])
    .default("aggregates-only"),
});

export const UnfadeConfigSchema = z.object({
  version: z.literal(2).default(2),
  capture: CaptureSchema.default(() => CaptureSchema.parse({})),
  distill: DistillSchema.default(() => DistillSchema.parse({})),
  mcp: McpSchema.default(() => McpSchema.parse({})),
  notification: NotificationSchema.default(() => NotificationSchema.parse({})),
  site: SiteSchema.default(() => SiteSchema.parse({})),
  pricing: PricingSchema.describe("Model pricing table: model name → cost per 1K tokens"),
  actions: ActionsSchema.default(() => ActionsSchema.parse({})),
  export: ExportSchema.default(() => ExportSchema.parse({})),
});

export type UnfadeConfig = z.infer<typeof UnfadeConfigSchema>;
