// FILE: src/services/cache/schema.ts
// Drizzle ORM schema definition for the unfade SQLite cache.
// This is the single source of truth for the materialized cache schema.

import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
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
    index("idx_events_ts").on(table.ts),
    index("idx_events_source").on(table.source),
  ],
);

export const decisions = sqliteTable(
  "decisions",
  {
    id: text("id").primaryKey(),
    date: text("date"),
    domain: text("domain"),
    description: text("description"),
    rationale: text("rationale"),
    alternativesCount: integer("alternatives_count"),
    hds: real("hds"),
    directionClass: text("direction_class"),
  },
  (table) => [
    index("idx_decisions_domain").on(table.domain),
    index("idx_decisions_date").on(table.date),
  ],
);

export const decisionEdges = sqliteTable("decision_edges", {
  fromId: text("from_id"),
  toId: text("to_id"),
  relation: text("relation"),
  weight: real("weight"),
  matchType: text("match_type"),
});

export const metricSnapshots = sqliteTable("metric_snapshots", {
  date: text("date").primaryKey(),
  rdi: real("rdi"),
  dcs: real("dcs"),
  aq: real("aq"),
  cwi: real("cwi"),
  apiScore: real("api_score"),
  decisionsCount: integer("decisions_count"),
  labels: text("labels", { mode: "json" }),
});

export const directionWindows = sqliteTable("direction_windows", {
  windowSize: text("window_size").notNull(),
  windowEnd: text("window_end").notNull(),
  directionDensity: real("direction_density"),
  eventCount: integer("event_count"),
  toolMix: text("tool_mix", { mode: "json" }),
});

export const comprehensionProxy = sqliteTable("comprehension_proxy", {
  eventId: text("event_id").primaryKey(),
  modDepth: real("mod_depth"),
  specificity: real("specificity"),
  rejection: real("rejection"),
  score: real("score"),
});

export const comprehensionByModule = sqliteTable("comprehension_by_module", {
  module: text("module").primaryKey(),
  score: real("score"),
  eventCount: integer("event_count"),
  updatedAt: text("updated_at"),
});

export const directionByFile = sqliteTable("direction_by_file", {
  path: text("path").primaryKey(),
  directionDensity: real("direction_density"),
  eventCount: integer("event_count"),
});

export const tokenProxySpend = sqliteTable("token_proxy_spend", {
  date: text("date").notNull(),
  model: text("model").notNull(),
  count: integer("count").default(0),
  estimatedCost: real("estimated_cost").default(0),
});

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
