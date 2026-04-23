// FILE: src/services/cache/schema.ts
// Drizzle ORM schema for the SQLite operational cache.
// Only operational tables: events (+ FTS), lineage, features, event_links.
// All analytical tables (sessions, direction_windows, comprehension, tokens,
// metrics, decisions) live in DuckDB — see duckdb-schema.ts.

import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    ts: text("ts"),
    source: text("source"),
    type: text("type"),
    contentSummary: text("content_summary"),
    contentDetail: text("content_detail"),
    gitRepo: text("git_repo"),
    gitBranch: text("git_branch"),
    metadata: text("metadata", { mode: "json" }),
  },
  (table) => [
    index("idx_events_project").on(table.projectId),
    index("idx_events_project_ts").on(table.projectId, table.ts),
    index("idx_events_ts").on(table.ts),
    index("idx_events_source").on(table.source),
  ],
);

export const eventInsightMap = sqliteTable(
  "event_insight_map",
  {
    eventId: text("event_id").notNull(),
    insightId: text("insight_id").notNull(),
    analyzer: text("analyzer").notNull(),
    contributionWeight: real("contribution_weight"),
    computedAt: text("computed_at"),
  },
  (table) => [index("idx_eim_insight").on(table.insightId)],
);

export const features = sqliteTable(
  "features",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    name: text("name").notNull(),
    branch: text("branch"),
    firstSeen: text("first_seen").notNull(),
    lastSeen: text("last_seen").notNull(),
    eventCount: integer("event_count").default(0),
    fileCount: integer("file_count").default(0),
    sessionCount: integer("session_count").default(0),
    status: text("status").default("active"),
  },
  (table) => [
    index("idx_features_project").on(table.projectId),
    index("idx_features_branch").on(table.branch),
    index("idx_features_status").on(table.status),
  ],
);

export const eventFeatures = sqliteTable("event_features", {
  eventId: text("event_id").notNull(),
  featureId: text("feature_id").notNull(),
});

export const eventLinks = sqliteTable("event_links", {
  fromEvent: text("from_event").notNull(),
  toEvent: text("to_event").notNull(),
  linkType: text("link_type").notNull(),
  metadata: text("metadata", { mode: "json" }),
});
