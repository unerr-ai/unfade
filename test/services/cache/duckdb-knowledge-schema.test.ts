import { describe, expect, it } from "vitest";
import {
  ALL_DUCKDB_DDL,
  ALL_DUCKDB_TABLES,
  DUCKDB_COMPREHENSION_ASSESSMENT_DDL,
  DUCKDB_COMPREHENSION_SCORES_DDL,
  DUCKDB_DOMAIN_COMPREHENSION_DDL,
  DUCKDB_EXTRACTION_STATUS_DDL,
  DUCKDB_METACOGNITIVE_SIGNALS_DDL,
  DUCKDB_SEGMENT_AGENCY_DDL,
} from "../../../src/services/cache/duckdb-schema.js";

describe("DuckDB knowledge extraction tables (KE-3)", () => {
  // ── Table count alignment ──────────────────────────────────────────────

  it("ALL_DUCKDB_DDL and ALL_DUCKDB_TABLES have matching lengths", () => {
    expect(ALL_DUCKDB_DDL.length).toBe(ALL_DUCKDB_TABLES.length);
  });

  it("every DDL creates a table named in ALL_DUCKDB_TABLES", () => {
    for (const ddl of ALL_DUCKDB_DDL) {
      const match = ddl.match(/CREATE TABLE IF NOT EXISTS (\w+)/);
      expect(match, `DDL does not match pattern: ${ddl.slice(0, 60)}`).toBeTruthy();
      expect(ALL_DUCKDB_TABLES).toContain(match![1]);
    }
  });

  it("no old comprehension_proxy or comprehension_by_module tables", () => {
    const allDdl = ALL_DUCKDB_DDL.join("\n");
    expect(allDdl).not.toContain("comprehension_proxy");
    expect(allDdl).not.toContain("comprehension_by_module");
    expect(ALL_DUCKDB_TABLES).not.toContain("comprehension_proxy");
    expect(ALL_DUCKDB_TABLES).not.toContain("comprehension_by_module");
  });

  // ── comprehension_assessment ───────────────────────────────────────────

  it("comprehension_assessment has 5 dimensions + overall score", () => {
    const ddl = DUCKDB_COMPREHENSION_ASSESSMENT_DDL;
    expect(ddl).toContain("episode_id");
    expect(ddl).toContain("steering");
    expect(ddl).toContain("understanding");
    expect(ddl).toContain("metacognition");
    expect(ddl).toContain("independence");
    expect(ddl).toContain("engagement");
    expect(ddl).toContain("overall_score");
    expect(ddl).toContain("rubber_stamp_count");
    expect(ddl).toContain("pushback_count");
    expect(ddl).toContain("assessment_method");
  });

  it("comprehension_assessment has episode_id as PRIMARY KEY", () => {
    expect(DUCKDB_COMPREHENSION_ASSESSMENT_DDL).toContain("episode_id          VARCHAR PRIMARY KEY");
  });

  // ── domain_comprehension ───────────────────────────────────────────────

  it("domain_comprehension has FSRS decay columns", () => {
    const ddl = DUCKDB_DOMAIN_COMPREHENSION_DDL;
    expect(ddl).toContain("base_score");
    expect(ddl).toContain("stability");
    expect(ddl).toContain("complexity_modifier");
    expect(ddl).toContain("floor_value");
    expect(ddl).toContain("engagement_quality");
    expect(ddl).toContain("current_score");
    expect(ddl).toContain("interaction_count");
    expect(ddl).toContain("last_touch");
  });

  it("domain_comprehension has composite PK (domain, project_id)", () => {
    expect(DUCKDB_DOMAIN_COMPREHENSION_DDL).toContain("PRIMARY KEY (domain, project_id)");
  });

  // ── comprehension_scores ───────────────────────────────────────────────

  it("comprehension_scores is a time-series with trend", () => {
    const ddl = DUCKDB_COMPREHENSION_SCORES_DDL;
    expect(ddl).toContain("date");
    expect(ddl).toContain("score");
    expect(ddl).toContain("trend");
    expect(ddl).toContain("top_domain");
    expect(ddl).toContain("weak_domain");
    expect(ddl).toContain("PRIMARY KEY (date, project_id)");
  });

  // ── extraction_status ──────────────────────────────────────────────────

  it("extraction_status tracks per-event extraction state", () => {
    const ddl = DUCKDB_EXTRACTION_STATUS_DDL;
    expect(ddl).toContain("event_id            VARCHAR PRIMARY KEY");
    expect(ddl).toContain("status");
    expect(ddl).toContain("retry_count");
    expect(ddl).toContain("error");
    expect(ddl).toContain("DEFAULT 'pending'");
  });

  // ── metacognitive_signals ──────────────────────────────────────────────

  it("metacognitive_signals has composite PK (episode_id, turn_index)", () => {
    const ddl = DUCKDB_METACOGNITIVE_SIGNALS_DDL;
    expect(ddl).toContain("signal_type");
    expect(ddl).toContain("quote");
    expect(ddl).toContain("strength");
    expect(ddl).toContain("PRIMARY KEY (episode_id, turn_index)");
  });

  // ── segment_agency ─────────────────────────────────────────────────────

  it("segment_agency has classification and reasoning", () => {
    const ddl = DUCKDB_SEGMENT_AGENCY_DDL;
    expect(ddl).toContain("segment_id          VARCHAR PRIMARY KEY");
    expect(ddl).toContain("episode_id");
    expect(ddl).toContain("classification");
    expect(ddl).toContain("reasoning");
  });
});
