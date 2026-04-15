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

const DistillSchema = z.object({
  schedule: z.string().default("0 18 * * *"),
  provider: z.enum(["ollama", "openai", "anthropic", "custom"]).default("ollama"),
  model: z.string().default("llama3.2"),
  apiKey: z.string().optional(),
  apiBase: z.string().optional(),
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

export const UnfadeConfigSchema = z.object({
  version: z.literal(1).default(1),
  capture: CaptureSchema.default(() => CaptureSchema.parse({})),
  distill: DistillSchema.default(() => DistillSchema.parse({})),
  mcp: McpSchema.default(() => McpSchema.parse({})),
  notification: NotificationSchema.default(() => NotificationSchema.parse({})),
});

export type UnfadeConfig = z.infer<typeof UnfadeConfigSchema>;
