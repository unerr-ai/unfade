import { describe, expect, it, vi } from "vitest";
import {
  projectTo64d,
  cosineSimilarity,
  createEntityEmbedFn,
  createFactEmbedFn,
  type EmbeddingModel,
} from "../../../src/services/knowledge/embedding.js";

// ─── Pure Math Tests ────────────────────────────────────────────────────────

describe("embedding (KE-16)", () => {
  describe("projectTo64d", () => {
    it("reduces 384d vector to 64d via mean-pooling", () => {
      const vec384 = Array.from({ length: 384 }, (_, i) => i / 384);
      const vec64 = projectTo64d(vec384);

      expect(vec64).toHaveLength(64);
    });

    it("preserves information — each output is mean of 6 consecutive inputs", () => {
      const vec384 = new Array(384).fill(0);
      // Set first chunk (indices 0-5) to [6, 6, 6, 6, 6, 6]
      for (let i = 0; i < 6; i++) vec384[i] = 6;
      // Set second chunk (indices 6-11) to [3, 3, 3, 3, 3, 3]
      for (let i = 6; i < 12; i++) vec384[i] = 3;

      const vec64 = projectTo64d(vec384);
      expect(vec64[0]).toBe(6);
      expect(vec64[1]).toBe(3);
      expect(vec64[2]).toBe(0);
    });

    it("throws for wrong input dimension", () => {
      expect(() => projectTo64d([1, 2, 3])).toThrow("Expected 384d");
    });

    it("handles all-zero vector", () => {
      const vec384 = new Array(384).fill(0);
      const vec64 = projectTo64d(vec384);
      expect(vec64.every((v) => v === 0)).toBe(true);
    });

    it("output values are averages, not sums", () => {
      const vec384 = new Array(384).fill(1.0);
      const vec64 = projectTo64d(vec384);
      expect(vec64[0]).toBeCloseTo(1.0, 10);
    });
  });

  describe("cosineSimilarity", () => {
    it("identical vectors → similarity 1.0", () => {
      const v = [0.1, 0.2, 0.3, 0.4, 0.5];
      expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
    });

    it("opposite vectors → similarity -1.0", () => {
      const a = [1, 0, 0];
      const b = [-1, 0, 0];
      expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
    });

    it("orthogonal vectors → similarity 0.0", () => {
      const a = [1, 0, 0];
      const b = [0, 1, 0];
      expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
    });

    it("similar vectors → high similarity", () => {
      const a = [0.9, 0.1, 0.3];
      const b = [0.85, 0.15, 0.28];
      expect(cosineSimilarity(a, b)).toBeGreaterThan(0.99);
    });

    it("empty vectors → similarity 0.0", () => {
      expect(cosineSimilarity([], [])).toBe(0);
    });

    it("mismatched lengths → similarity 0.0", () => {
      expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    });

    it("zero vector → similarity 0.0", () => {
      expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    });
  });

  // ── Adapter Functions ───────────────────────────────────────────────

  describe("createEntityEmbedFn", () => {
    it("returns 64d projected vector", async () => {
      const mockModel: EmbeddingModel = {
        embed: vi.fn().mockResolvedValue(Array.from({ length: 384 }, () => 0.5)),
        embedBatch: vi.fn(),
        isLoaded: () => true,
        unload: () => {},
      };

      const embedFn = createEntityEmbedFn(mockModel);
      const result = await embedFn("Redis");

      expect(result).toHaveLength(64);
      expect(mockModel.embed).toHaveBeenCalledWith("Redis");
    });
  });

  describe("createFactEmbedFn", () => {
    it("returns native 384d vector", async () => {
      const vec384 = Array.from({ length: 384 }, (_, i) => i * 0.001);
      const mockModel: EmbeddingModel = {
        embed: vi.fn().mockResolvedValue(vec384),
        embedBatch: vi.fn(),
        isLoaded: () => true,
        unload: () => {},
      };

      const embedFn = createFactEmbedFn(mockModel);
      const result = await embedFn("project USES Redis");

      expect(result).toHaveLength(384);
      expect(result).toEqual(vec384);
    });
  });

  // ── Model Interface Contract ─────────────────────────────────────────

  describe("EmbeddingModel interface", () => {
    it("mock model satisfies the EmbeddingModel contract", async () => {
      const mockModel: EmbeddingModel = {
        embed: vi.fn().mockResolvedValue(new Array(384).fill(0.1)),
        embedBatch: vi.fn().mockResolvedValue([
          new Array(384).fill(0.1),
          new Array(384).fill(0.2),
        ]),
        isLoaded: () => true,
        unload: vi.fn(),
      };

      const single = await mockModel.embed("test");
      expect(single).toHaveLength(384);

      const batch = await mockModel.embedBatch(["test1", "test2"]);
      expect(batch).toHaveLength(2);
      expect(batch[0]).toHaveLength(384);

      expect(mockModel.isLoaded()).toBe(true);

      mockModel.unload();
      expect(mockModel.unload).toHaveBeenCalled();
    });
  });

  // ── Similarity Properties ──────────────────────────────────────────

  describe("embedding similarity properties", () => {
    it("projected 64d vectors preserve relative similarity ordering", () => {
      const vecA = Array.from({ length: 384 }, (_, i) => Math.sin(i * 0.1));
      const vecB = Array.from({ length: 384 }, (_, i) => Math.sin(i * 0.1 + 0.01));
      const vecC = Array.from({ length: 384 }, (_, i) => Math.cos(i * 0.5));

      const sim384_AB = cosineSimilarity(vecA, vecB);
      const sim384_AC = cosineSimilarity(vecA, vecC);

      const projA = projectTo64d(vecA);
      const projB = projectTo64d(vecB);
      const projC = projectTo64d(vecC);

      const sim64_AB = cosineSimilarity(projA, projB);
      const sim64_AC = cosineSimilarity(projA, projC);

      // Similar vectors should still be more similar than dissimilar ones after projection
      if (sim384_AB > sim384_AC) {
        expect(sim64_AB).toBeGreaterThan(sim64_AC);
      }
    });
  });
});
