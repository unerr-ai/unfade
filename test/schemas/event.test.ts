// T-007, T-008: CaptureEvent schema tests
import { describe, expect, it } from "vitest";
import { CaptureEventSchema } from "../../src/schemas/event.js";

const validEvent = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  projectId: "test-project-id",
  timestamp: "2026-04-15T10:30:00Z",
  source: "git" as const,
  type: "commit" as const,
  content: {
    summary: "Refactored auth middleware to use JWT validation",
    detail: "Replaced session-based auth with stateless JWT tokens",
    files: ["src/middleware/auth.ts", "src/utils/jwt.ts"],
    branch: "feat/jwt-auth",
    project: "unfade-cli",
  },
  gitContext: {
    repo: "unfade-io/unfade-cli",
    branch: "feat/jwt-auth",
    commitHash: "abc123def456",
  },
};

describe("CaptureEventSchema", () => {
  it("T-007: valid CaptureEvent passes validation", () => {
    const result = CaptureEventSchema.safeParse(validEvent);
    expect(result.success).toBe(true);
  });

  it("T-008: CaptureEvent with missing source fails validation", () => {
    const { source: _, ...eventWithoutSource } = validEvent;
    const result = CaptureEventSchema.safeParse(eventWithoutSource);
    expect(result.success).toBe(false);
  });
});
