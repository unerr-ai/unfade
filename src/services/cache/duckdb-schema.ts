// FILE: src/services/cache/duckdb-schema.ts
// DuckDB analytical schema — typed columns for columnar aggregation, time-bucketing,
// and compute-pushdown. No json_extract() — every field the intelligence layer
// queries is a first-class typed column.

export const DUCKDB_EVENTS_DDL = `
CREATE TABLE IF NOT EXISTS events (
    id                          VARCHAR PRIMARY KEY,
    project_id                  VARCHAR NOT NULL,
    ts                          TIMESTAMP NOT NULL,
    source                      VARCHAR NOT NULL,
    type                        VARCHAR NOT NULL,
    content_summary             VARCHAR,
    content_detail              VARCHAR,
    content_branch              VARCHAR,
    content_project             VARCHAR,
    content_files               VARCHAR[],
    git_repo                    VARCHAR,
    git_branch                  VARCHAR,
    git_commit_hash             VARCHAR,
    ai_tool                     VARCHAR,
    session_id                  VARCHAR,
    conversation_id             VARCHAR,
    conversation_title          VARCHAR,
    turn_count                  INTEGER,
    model_id                    VARCHAR,
    environment                 VARCHAR,
    prompt_count                INTEGER,
    human_direction_score       FLOAT,
    prompt_specificity          FLOAT,
    modification_after_accept   BOOLEAN,
    course_correction           BOOLEAN,
    domain_injection            BOOLEAN,
    alternative_evaluation      BOOLEAN,
    rejection_count             INTEGER,
    execution_phase             VARCHAR,
    outcome                     VARCHAR,
    intent_summary              VARCHAR,
    tokens_in                   INTEGER,
    tokens_out                  INTEGER,
    estimated_cost              FLOAT,
    files_referenced            VARCHAR[],
    files_modified              VARCHAR[],
    metadata_extra              JSON,
    -- Classification columns (Sprint 16B)
    prompt_type                 VARCHAR,
    prompt_type_secondary       VARCHAR,
    prompt_type_confidence      FLOAT,
    prompt_specificity_v2       FLOAT,
    prompt_decomposition_depth  INTEGER,
    prompt_reference_density    INTEGER,
    prompt_constraint_type      VARCHAR,
    targeted_modules            VARCHAR,
    feature_group_id            VARCHAR,
    chain_pattern               VARCHAR,
    chain_effectiveness         FLOAT,
    prompt_response_effectiveness FLOAT
);
`;

export const DUCKDB_SESSIONS_DDL = `
CREATE TABLE IF NOT EXISTS sessions (
    id                  VARCHAR PRIMARY KEY,
    project_id          VARCHAR NOT NULL,
    start_ts            TIMESTAMP NOT NULL,
    end_ts              TIMESTAMP NOT NULL,
    event_count         INTEGER,
    turn_count          INTEGER,
    outcome             VARCHAR,
    estimated_cost      FLOAT,
    execution_phases    VARCHAR[],
    branch              VARCHAR,
    domain              VARCHAR,
    ai_tool             VARCHAR,
    avg_hds             FLOAT,
    feature_id          VARCHAR,
    updated_at          TIMESTAMP
);
`;

export const DUCKDB_DIRECTION_WINDOWS_DDL = `
CREATE TABLE IF NOT EXISTS direction_windows (
    window_size         VARCHAR NOT NULL,
    window_end          TIMESTAMP NOT NULL,
    project_id          VARCHAR NOT NULL DEFAULT '',
    direction_density   FLOAT,
    event_count         INTEGER,
    tool_mix            JSON,
    PRIMARY KEY (window_size, window_end, project_id)
);
`;

export const DUCKDB_COMPREHENSION_PROXY_DDL = `
CREATE TABLE IF NOT EXISTS comprehension_proxy (
    event_id            VARCHAR PRIMARY KEY,
    project_id          VARCHAR NOT NULL DEFAULT '',
    mod_depth           FLOAT,
    specificity         FLOAT,
    rejection           FLOAT,
    score               FLOAT,
    ts                  TIMESTAMP
);
`;

export const DUCKDB_COMPREHENSION_BY_MODULE_DDL = `
CREATE TABLE IF NOT EXISTS comprehension_by_module (
    module              VARCHAR,
    project_id          VARCHAR NOT NULL DEFAULT '',
    score               FLOAT,
    event_count         INTEGER,
    updated_at          TIMESTAMP,
    PRIMARY KEY (module, project_id)
);
`;

export const DUCKDB_DIRECTION_BY_FILE_DDL = `
CREATE TABLE IF NOT EXISTS direction_by_file (
    path                VARCHAR,
    project_id          VARCHAR NOT NULL DEFAULT '',
    direction_density   FLOAT,
    event_count         INTEGER,
    PRIMARY KEY (path, project_id)
);
`;

export const DUCKDB_TOKEN_PROXY_SPEND_DDL = `
CREATE TABLE IF NOT EXISTS token_proxy_spend (
    date                DATE NOT NULL,
    model               VARCHAR NOT NULL,
    project_id          VARCHAR NOT NULL DEFAULT '',
    count               INTEGER DEFAULT 0,
    estimated_cost      FLOAT DEFAULT 0,
    PRIMARY KEY (date, model, project_id)
);
`;

export const DUCKDB_METRIC_SNAPSHOTS_DDL = `
CREATE TABLE IF NOT EXISTS metric_snapshots (
    date                DATE,
    project_id          VARCHAR NOT NULL DEFAULT '',
    rdi                 FLOAT,
    dcs                 FLOAT,
    aq                  FLOAT,
    cwi                 FLOAT,
    api_score           FLOAT,
    decisions_count     INTEGER,
    labels              JSON,
    PRIMARY KEY (date, project_id)
);
`;

export const DUCKDB_DECISIONS_DDL = `
CREATE TABLE IF NOT EXISTS decisions (
    id                  VARCHAR PRIMARY KEY,
    project_id          VARCHAR NOT NULL DEFAULT '',
    date                DATE,
    domain              VARCHAR,
    description         VARCHAR,
    rationale           VARCHAR,
    alternatives_count  INTEGER,
    hds                 FLOAT,
    direction_class     VARCHAR
);
`;

export const DUCKDB_DECISION_EDGES_DDL = `
CREATE TABLE IF NOT EXISTS decision_edges (
    from_id             VARCHAR NOT NULL,
    to_id               VARCHAR NOT NULL,
    relation            VARCHAR,
    weight              FLOAT,
    match_type          VARCHAR,
    PRIMARY KEY (from_id, to_id)
);
`;

export const DUCKDB_EVENT_LINKS_DDL = `
CREATE TABLE IF NOT EXISTS event_links (
    from_event          VARCHAR NOT NULL,
    to_event            VARCHAR NOT NULL,
    link_type           VARCHAR NOT NULL,
    metadata            JSON,
    PRIMARY KEY (from_event, to_event, link_type)
);
`;

// ---------------------------------------------------------------------------
// Sprint 16B: Classification tables
// ---------------------------------------------------------------------------

export const DUCKDB_FEATURE_REGISTRY_DDL = `
CREATE TABLE IF NOT EXISTS feature_registry (
    id                  VARCHAR PRIMARY KEY,
    project_id          VARCHAR NOT NULL,
    name                VARCHAR NOT NULL,
    module_path         VARCHAR NOT NULL,
    source              VARCHAR NOT NULL,
    event_count         INTEGER DEFAULT 0,
    last_seen           TIMESTAMP,
    parent_id           VARCHAR,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

export const DUCKDB_PROMPT_RESPONSE_CORRELATIONS_DDL = `
CREATE TABLE IF NOT EXISTS prompt_response_correlations (
    event_id            VARCHAR PRIMARY KEY,
    prompt_type         VARCHAR NOT NULL,
    feature_group       VARCHAR,
    structural_features VARCHAR,
    specificity         FLOAT,
    outcome             VARCHAR,
    files_modified      INTEGER,
    tokens_out          INTEGER,
    turn_count          INTEGER,
    effectiveness_score FLOAT,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

export const DUCKDB_PROMPT_CHAINS_DDL = `
CREATE TABLE IF NOT EXISTS prompt_chains (
    session_id              VARCHAR PRIMARY KEY,
    chain_pattern           VARCHAR NOT NULL,
    turn_count              INTEGER,
    scope_evolution         VARCHAR,
    cross_feature           BOOLEAN,
    turns_to_first_accept   INTEGER,
    chain_direction_score   FLOAT,
    effort_amplification    FLOAT,
    refinement_value        VARCHAR,
    feature_trajectory      VARCHAR,
    created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

/** All DuckDB DDL statements in dependency order. */
export const ALL_DUCKDB_DDL = [
  DUCKDB_EVENTS_DDL,
  DUCKDB_SESSIONS_DDL,
  DUCKDB_DIRECTION_WINDOWS_DDL,
  DUCKDB_COMPREHENSION_PROXY_DDL,
  DUCKDB_COMPREHENSION_BY_MODULE_DDL,
  DUCKDB_DIRECTION_BY_FILE_DDL,
  DUCKDB_TOKEN_PROXY_SPEND_DDL,
  DUCKDB_METRIC_SNAPSHOTS_DDL,
  DUCKDB_DECISIONS_DDL,
  DUCKDB_DECISION_EDGES_DDL,
  DUCKDB_EVENT_LINKS_DDL,
  DUCKDB_FEATURE_REGISTRY_DDL,
  DUCKDB_PROMPT_RESPONSE_CORRELATIONS_DDL,
  DUCKDB_PROMPT_CHAINS_DDL,
] as const;

/** All DuckDB table names for DROP during rebuild. */
export const ALL_DUCKDB_TABLES = [
  "events",
  "sessions",
  "direction_windows",
  "comprehension_proxy",
  "comprehension_by_module",
  "direction_by_file",
  "token_proxy_spend",
  "metric_snapshots",
  "decisions",
  "decision_edges",
  "event_links",
  "feature_registry",
  "prompt_response_correlations",
  "prompt_chains",
] as const;

/**
 * Known metadata fields that are promoted to typed DuckDB columns.
 * Everything else goes into metadata_extra.
 */
export const KNOWN_METADATA_FIELDS = new Set([
  "ai_tool",
  "session_id",
  "conversation_id",
  "conversation_title",
  "turn_count",
  "model_id",
  "model",
  "environment",
  "prompt_count",
  "direction_signals",
  "execution_phase",
  "outcome",
  "intent_summary",
  "tokens_in",
  "tokens_out",
  "estimated_cost",
  "files_referenced",
  "files_modified",
]);
