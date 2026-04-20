// Tests for UF-079: Pattern feedback mechanism
// T-205
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DomainDistributionV2 } from "../../../src/schemas/profile.js";
import {
  detectBlindSpots,
  type FeedbackEntry,
  getFeedbackThreshold,
  readFeedback,
  storeFeedback,
} from "../../../src/services/personalization/feedback.js";

let tmpDir: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-feedback-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

beforeEach(() => {
  tmpDir = makeTmpDir();
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe("storeFeedback / readFeedback", () => {
  it("stores and reads feedback entries", () => {
    storeFeedback(
      { connection_id: "conn-001", helpful: true, timestamp: "2026-04-15T12:00:00Z" },
      tmpDir,
    );
    storeFeedback(
      {
        connection_id: "conn-002",
        helpful: false,
        timestamp: "2026-04-15T13:00:00Z",
        domain: "auth",
      },
      tmpDir,
    );

    const entries = readFeedback(tmpDir);
    expect(entries).toHaveLength(2);
    expect(entries[0].connection_id).toBe("conn-001");
    expect(entries[0].helpful).toBe(true);
    expect(entries[1].connection_id).toBe("conn-002");
    expect(entries[1].helpful).toBe(false);
    expect(entries[1].domain).toBe("auth");
  });

  it("returns empty array when no feedback file", () => {
    const entries = readFeedback(tmpDir);
    expect(entries).toEqual([]);
  });

  it("writes to amplification/feedback.jsonl", () => {
    storeFeedback(
      { connection_id: "conn-001", helpful: true, timestamp: "2026-04-15T12:00:00Z" },
      tmpDir,
    );
    const filePath = join(tmpDir, ".unfade", "amplification", "feedback.jsonl");
    expect(existsSync(filePath)).toBe(true);
  });
});

describe("getFeedbackThreshold", () => {
  // T-205: correction adjusts confidence scores
  it("T-205: raises threshold when >30% feedback is unhelpful", () => {
    const feedback: FeedbackEntry[] = [
      { connection_id: "c1", helpful: true, timestamp: "2026-04-15T10:00:00Z" },
      { connection_id: "c2", helpful: false, timestamp: "2026-04-15T11:00:00Z" },
      { connection_id: "c3", helpful: false, timestamp: "2026-04-15T12:00:00Z" },
      { connection_id: "c4", helpful: false, timestamp: "2026-04-15T13:00:00Z" },
      { connection_id: "c5", helpful: true, timestamp: "2026-04-15T14:00:00Z" },
    ];

    // 3/5 = 60% unhelpful → above 30% threshold
    const threshold = getFeedbackThreshold(feedback);
    expect(threshold).toBeGreaterThan(0.3);
    // Threshold should be raised but not exceed 0.6
    expect(threshold).toBeLessThanOrEqual(0.6);
  });

  it("returns default threshold when feedback is mostly helpful", () => {
    const feedback: FeedbackEntry[] = [
      { connection_id: "c1", helpful: true, timestamp: "2026-04-15T10:00:00Z" },
      { connection_id: "c2", helpful: true, timestamp: "2026-04-15T11:00:00Z" },
      { connection_id: "c3", helpful: true, timestamp: "2026-04-15T12:00:00Z" },
      { connection_id: "c4", helpful: false, timestamp: "2026-04-15T13:00:00Z" },
    ];

    // 1/4 = 25% unhelpful → below 30% threshold
    const threshold = getFeedbackThreshold(feedback);
    expect(threshold).toBe(0.3);
  });

  it("returns default threshold for empty feedback", () => {
    expect(getFeedbackThreshold([])).toBe(0.3);
  });

  it("filters by domain when provided", () => {
    const feedback: FeedbackEntry[] = [
      { connection_id: "c1", helpful: false, timestamp: "t", domain: "auth" },
      { connection_id: "c2", helpful: false, timestamp: "t", domain: "auth" },
      { connection_id: "c3", helpful: true, timestamp: "t", domain: "infra" },
      { connection_id: "c4", helpful: true, timestamp: "t", domain: "infra" },
    ];

    // Auth domain: 100% unhelpful → raised threshold
    const authThreshold = getFeedbackThreshold(feedback, "auth");
    expect(authThreshold).toBeGreaterThan(0.3);

    // Infra domain: 100% helpful → default threshold
    const infraThreshold = getFeedbackThreshold(feedback, "infra");
    expect(infraThreshold).toBe(0.3);
  });
});

describe("detectBlindSpots", () => {
  it("detects domains with high frequency but low alternatives", () => {
    const domains: DomainDistributionV2[] = [
      {
        domain: "frontend",
        frequency: 10,
        percentageOfTotal: 0.5,
        lastSeen: "2026-04-15",
        depth: "moderate",
        depthTrend: "stable",
        avgAlternativesInDomain: 1.0,
      },
      {
        domain: "backend",
        frequency: 20,
        percentageOfTotal: 0.4,
        lastSeen: "2026-04-15",
        depth: "deep",
        depthTrend: "stable",
        avgAlternativesInDomain: 3.5,
      },
    ];

    const spots = detectBlindSpots(domains);
    expect(spots).toHaveLength(1);
    expect(spots[0].domain).toBe("frontend");
    expect(spots[0].severity).toBe(10); // 10 * (1/1.0)
    expect(spots[0].message).toContain("Blind spot");
    expect(spots[0].message).toContain("frontend");
  });

  it("returns empty when all domains have high exploration", () => {
    const domains: DomainDistributionV2[] = [
      {
        domain: "backend",
        frequency: 20,
        percentageOfTotal: 1,
        lastSeen: "2026-04-15",
        depth: "deep",
        depthTrend: "stable",
        avgAlternativesInDomain: 3.5,
      },
    ];

    expect(detectBlindSpots(domains)).toEqual([]);
  });

  it("ignores domains with fewer than 5 decisions", () => {
    const domains: DomainDistributionV2[] = [
      {
        domain: "devops",
        frequency: 3,
        percentageOfTotal: 0.1,
        lastSeen: "2026-04-15",
        depth: "shallow",
        depthTrend: "stable",
        avgAlternativesInDomain: 0.5,
      },
    ];

    expect(detectBlindSpots(domains)).toEqual([]);
  });

  it("sorts blind spots by severity descending", () => {
    const domains: DomainDistributionV2[] = [
      {
        domain: "frontend",
        frequency: 5,
        percentageOfTotal: 0.25,
        lastSeen: "2026-04-15",
        depth: "shallow",
        depthTrend: "stable",
        avgAlternativesInDomain: 1.0,
      },
      {
        domain: "devops",
        frequency: 15,
        percentageOfTotal: 0.5,
        lastSeen: "2026-04-15",
        depth: "moderate",
        depthTrend: "stable",
        avgAlternativesInDomain: 0.5,
      },
    ];

    const spots = detectBlindSpots(domains);
    expect(spots).toHaveLength(2);
    // devops: 15 * (1/0.5) = 30, frontend: 5 * (1/1.0) = 5
    expect(spots[0].domain).toBe("devops");
    expect(spots[1].domain).toBe("frontend");
  });
});
