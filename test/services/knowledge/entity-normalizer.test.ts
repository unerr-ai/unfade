import { describe, expect, it } from "vitest";
import {
  normalizeEntityName,
  isAlias,
  computeLevenshteinDistance,
} from "../../../src/services/knowledge/entity-normalizer.js";

describe("entity-normalizer (KE-9.1)", () => {
  // ── normalizeEntityName ─────────────────────────────────────────────────

  describe("normalizeEntityName", () => {
    it("lowercases input", () => {
      expect(normalizeEntityName("Redis")).toBe("redis");
      expect(normalizeEntityName("React Hooks")).toBe("react hooks");
      expect(normalizeEntityName("JSON Web Token")).toBe("json web token");
    });

    it("strips trailing version numbers", () => {
      expect(normalizeEntityName("React 18")).toBe("react");
      expect(normalizeEntityName("Node.js 20.1.0")).toBe("node.js");
      expect(normalizeEntityName("Python 3.12")).toBe("python");
      expect(normalizeEntityName("TypeScript 5.4.2")).toBe("typescript");
      expect(normalizeEntityName("Vue 3")).toBe("vue");
    });

    it("strips version numbers with 'v' prefix", () => {
      expect(normalizeEntityName("Next.js v14")).toBe("next.js");
      expect(normalizeEntityName("Fastify v4.21.0")).toBe("fastify");
    });

    it("does not strip version-like strings embedded in words", () => {
      expect(normalizeEntityName("es2015")).toBe("es2015");
      expect(normalizeEntityName("h2o")).toBe("h2o");
    });

    it("trims and collapses whitespace", () => {
      expect(normalizeEntityName("  Redis  ")).toBe("redis");
      expect(normalizeEntityName("React   Hooks")).toBe("react hooks");
      expect(normalizeEntityName("  JSON  Web  Token  ")).toBe("json web token");
    });

    it("handles empty and whitespace-only input", () => {
      expect(normalizeEntityName("")).toBe("");
      expect(normalizeEntityName("   ")).toBe("");
    });

    it("normalizes 'React Hooks' and 'react hooks' to the same key", () => {
      expect(normalizeEntityName("React Hooks")).toBe(normalizeEntityName("react hooks"));
    });

    it("'redis' and 'Redis' normalize to same after lowercasing", () => {
      expect(normalizeEntityName("redis")).toBe(normalizeEntityName("Redis"));
    });
  });

  // ── computeLevenshteinDistance ──────────────────────────────────────────

  describe("computeLevenshteinDistance", () => {
    it("returns 0 for identical strings", () => {
      expect(computeLevenshteinDistance("redis", "redis")).toBe(0);
      expect(computeLevenshteinDistance("", "")).toBe(0);
    });

    it("returns string length when other string is empty", () => {
      expect(computeLevenshteinDistance("redis", "")).toBe(5);
      expect(computeLevenshteinDistance("", "react")).toBe(5);
    });

    it("computes single-character edit distances", () => {
      expect(computeLevenshteinDistance("redis", "redi")).toBe(1);
      expect(computeLevenshteinDistance("react", "reakt")).toBe(1);
      expect(computeLevenshteinDistance("vue", "vuw")).toBe(1);
    });

    it("computes multi-character edit distances", () => {
      expect(computeLevenshteinDistance("kitten", "sitting")).toBe(3);
      expect(computeLevenshteinDistance("saturday", "sunday")).toBe(3);
    });

    it("is symmetric", () => {
      expect(computeLevenshteinDistance("abc", "xyz")).toBe(
        computeLevenshteinDistance("xyz", "abc"),
      );
    });

    it("returns 0 for normalized 'redis' vs 'Redis' (after external normalization)", () => {
      const a = normalizeEntityName("redis");
      const b = normalizeEntityName("Redis");
      expect(computeLevenshteinDistance(a, b)).toBe(0);
    });
  });

  // ── isAlias ─────────────────────────────────────────────────────────────

  describe("isAlias", () => {
    it("returns false for identical names (same entity, not alias)", () => {
      expect(isAlias("Redis", "redis")).toBe(false);
      expect(isAlias("React", "react")).toBe(false);
    });

    it("detects known abbreviation pairs", () => {
      expect(isAlias("JWT", "JSON Web Token")).toBe(true);
      expect(isAlias("JSON Web Token", "JWT")).toBe(true);
      expect(isAlias("CSS", "Cascading Style Sheets")).toBe(true);
      expect(isAlias("API", "Application Programming Interface")).toBe(true);
      expect(isAlias("CLI", "Command Line Interface")).toBe(true);
      expect(isAlias("k8s", "Kubernetes")).toBe(true);
      expect(isAlias("SSR", "Server Side Rendering")).toBe(true);
    });

    it("detects word-boundary containment", () => {
      expect(isAlias("hooks", "React Hooks")).toBe(true);
      expect(isAlias("React Hooks", "hooks")).toBe(true);
    });

    it("does not match short substrings (< 3 chars)", () => {
      expect(isAlias("re", "react")).toBe(false);
    });

    it("does not match partial word matches", () => {
      expect(isAlias("red", "redux")).toBe(false);
    });

    it("detects Levenshtein-close names", () => {
      expect(isAlias("fastify", "fastfy")).toBe(true);
      expect(isAlias("expresss", "express")).toBe(true);
    });

    it("does not match unrelated names", () => {
      expect(isAlias("Redis", "PostgreSQL")).toBe(false);
      expect(isAlias("React", "Angular")).toBe(false);
      expect(isAlias("Docker", "Kubernetes")).toBe(false);
    });

    it("returns false for empty strings", () => {
      expect(isAlias("", "React")).toBe(false);
      expect(isAlias("Redis", "")).toBe(false);
      expect(isAlias("", "")).toBe(false);
    });

    it("handles version-stripped names in alias check", () => {
      expect(isAlias("React 18", "react")).toBe(false);
    });
  });
});
