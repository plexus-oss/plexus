import {
  pgTable,
  index,
  uniqueIndex,
  foreignKey,
  check,
  uuid,
  text,
  timestamp,
  bigint,
  doublePrecision,
  boolean,
  jsonb,
  unique,
  numeric,
  integer,
  date,
  primaryKey,
  pgView,
  pgEnum,
  customType,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Postgres tsvector — drizzle-kit introspect can't parse it (it emits a broken
// `unknown(...)`), so model it as a custom type. Preserves the generated
// full-text column on system_events + its GIN index. Keep this if you re-pull.
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const alertRuleOperator = pgEnum("alert_rule_operator", ["and", "or"]);
export const alertRuleType = pgEnum("alert_rule_type", [
  "threshold",
  "outlier",
  "compound",
  "offline",
]);
export const alertSeverity = pgEnum("alert_severity", [
  "critical",
  "warning",
  "info",
]);
export const alertStatus = pgEnum("alert_status", [
  "open",
  "acknowledged",
  "resolved",
]);
export const alertTriggerType = pgEnum("alert_trigger_type", [
  "limit_violation",
  "event",
  "alert_rule",
]);
export const feedback_type = pgEnum("feedback_type", [
  "bug",
  "feature",
  "general",
]);
export const shareLinkAccess = pgEnum("share_link_access", ["view", "edit"]);
export const shareLinkStatus = pgEnum("share_link_status", [
  "active",
  "expired",
  "revoked",
]);

export const dashboardPermissions = pgTable(
  "dashboard_permissions",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    org_id: text("org_id").notNull(),
    dashboard_id: uuid("dashboard_id").notNull(),
    user_id: text("user_id"),
    email: text(),
    access_level: shareLinkAccess("access_level").default("view").notNull(),
    invited_by: text("invited_by").notNull(),
    accepted_at: timestamp("accepted_at", {
      withTimezone: true,
      mode: "string",
    }),
    created_at: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    updated_at: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    role: text(),
  },
  (table) => [
    index("idx_dashboard_permissions_dashboard_id").using(
      "btree",
      table.dashboard_id.asc().nullsLast(),
    ),
    index("idx_dashboard_permissions_email").using(
      "btree",
      table.email.asc().nullsLast(),
    ),
    index("idx_dashboard_permissions_org_id").using(
      "btree",
      table.org_id.asc().nullsLast(),
    ),
    index("idx_dashboard_permissions_role").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.role.asc().nullsLast(),
    ),
    uniqueIndex("idx_dashboard_permissions_unique").using(
      "btree",
      sql`dashboard_id`,
      sql`COALESCE(user_id, ''::text)`,
      sql`COALESCE(email, ''::text)`,
      sql`COALESCE(role, ''::text)`,
    ),
    index("idx_dashboard_permissions_user_id").using(
      "btree",
      table.user_id.asc().nullsLast(),
    ),
    foreignKey({
      columns: [table.dashboard_id],
      foreignColumns: [dashboards.id],
      name: "dashboard_permissions_dashboard_id_fkey",
    }).onDelete("cascade"),
    check(
      "dashboard_permissions_grantee_present",
      sql`(user_id IS NOT NULL) OR (email IS NOT NULL) OR (role IS NOT NULL)`,
    ),
  ],
);

export const deviceSchemas = pgTable(
  "device_schemas",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    org_id: text("org_id").notNull(),
    source_id: text("source_id").notNull(),
    metric: text().notNull(),
    value_type: text("value_type").notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    sample_count: bigint("sample_count", { mode: "number" })
      .default(1)
      .notNull(),
    min_value: doublePrecision("min_value"),
    max_value: doublePrecision("max_value"),
    last_value_at: timestamp("last_value_at", {
      withTimezone: true,
      mode: "string",
    }),
    first_seen_at: timestamp("first_seen_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    created_at: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    updated_at: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
  },
  (table) => [
    index("idx_device_schemas_source").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.source_id.asc().nullsLast(),
    ),
    uniqueIndex("idx_device_schemas_unique").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.source_id.asc().nullsLast(),
      table.metric.asc().nullsLast(),
    ),
    check(
      "device_schemas_value_type_check",
      sql`value_type = ANY (ARRAY['number'::text, 'string'::text, 'boolean'::text, 'object'::text, 'array'::text])`,
    ),
  ],
);

export const eventMonitors = pgTable(
  "event_monitors",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    org_id: text("org_id").notNull(),
    source_id: uuid("source_id").notNull(),
    metric: text().notNull(),
    severity: text().default("info").notNull(),
    message: text(),
    enabled: boolean().default(true).notNull(),
    created_at: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    updated_at: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    visualization: jsonb(),
    // Explicit notification targets (slack/email/webhook integration ids).
    // NULL = default fan-out to every integration subscribed to the event type.
    notification_target_ids: uuid("notification_target_ids").array(),
    // Poll-based detection (connection sources): which table/column pair to
    // poll, and the high-water mark of the last row seen. poll_watermark is an
    // OPAQUE string rendered by the source DB itself (ts::text etc.) — never a
    // JS-derived ISO string, which loses sub-millisecond precision and would
    // re-match the same row forever.
    table_name: text("table_name"),
    time_column: text("time_column"),
    poll_watermark: text("poll_watermark"),
    last_polled_at: timestamp("last_polled_at", {
      withTimezone: true,
      mode: "string",
    }),
    // Extra columns from the monitored table fetched with each new row and
    // attached to the alert's context snapshot (e.g. email, name).
    context_columns: text("context_columns").array(),
    // Row predicate: [{column, op, value}] ANDed into the poll WHERE clause,
    // so "new signup" can mean `event_type = 'signup'`, not "any new row".
    filters: jsonb(),
    // "digest" (default): one alert per poll batch. "per_row": one alert per
    // matching row (capped), so 3 signups = 3 alerts, not one alert saying 3.
    delivery: text("delivery"),
    // Health: outcome of the most recent poll attempt (incl. skips/errors), so
    // the UI can show Working / Skipped: reason / Failing: reason.
    last_status: text("last_status"),
    last_error: text("last_error"),
    last_evaluated_at: timestamp("last_evaluated_at", {
      withTimezone: true,
      mode: "string",
    }),
  },
  (table) => [
    index("idx_event_monitors_enabled")
      .using(
        "btree",
        table.org_id.asc().nullsLast(),
        table.enabled.asc().nullsLast(),
      )
      .where(sql`(enabled = true)`),
    index("idx_event_monitors_source").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.source_id.asc().nullsLast(),
    ),
    uniqueIndex("idx_event_monitors_unique").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.source_id.asc().nullsLast(),
      table.metric.asc().nullsLast(),
    ),
    foreignKey({
      columns: [table.source_id],
      foreignColumns: [sources.id],
      name: "event_monitors_source_id_fkey",
    }).onDelete("cascade"),
    check(
      "event_monitors_severity_check",
      sql`severity = ANY (ARRAY['critical'::text, 'warning'::text, 'info'::text])`,
    ),
  ],
);

export const orgInvites = pgTable(
  "org_invites",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    org_id: text("org_id").notNull(),
    email: text().notNull(),
    role: text().default("org:viewer").notNull(),
    token_hash: text("token_hash").notNull(),
    invited_by: text("invited_by"),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    expires_at: timestamp("expires_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    accepted_at: timestamp("accepted_at", {
      withTimezone: true,
      mode: "string",
    }),
    // Scope applied to the member on accept. NULL = full access (the common
    // case); array (incl. empty) = restricted allow-list. Same semantics as
    // org_members.allowed_source_ids.
    allowed_source_ids: uuid("allowed_source_ids").array(),
  },
  (table) => [
    index("idx_org_invites_org_id").using(
      "btree",
      table.org_id.asc().nullsLast(),
    ),
    unique("org_invites_token_hash_key").on(table.token_hash),
  ],
);

export const slackOauthStates = pgTable(
  "slack_oauth_states",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    org_id: text("org_id").notNull(),
    user_id: text("user_id").notNull(),
    state: text().notNull(),
    created_at: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    expires_at: timestamp("expires_at", {
      withTimezone: true,
      mode: "string",
    }).default(sql`(now() + '00:10:00'::interval)`),
  },
  (table) => [
    index("slack_oauth_states_expires_idx").using(
      "btree",
      table.expires_at.asc().nullsLast(),
    ),
    index("slack_oauth_states_state_idx").using(
      "btree",
      table.state.asc().nullsLast(),
    ),
    unique("slack_oauth_states_state_key").on(table.state),
  ],
);

export const sourceLimits = pgTable(
  "source_limits",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    org_id: text("org_id").notNull(),
    source_id: uuid("source_id").notNull(),
    metric: text().notNull(),
    min: doublePrecision(),
    max: doublePrecision(),
    severity: alertSeverity().default("warning").notNull(),
    message: text(),
    created_at: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    updated_at: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    // Poll-based detection (connection sources) — same contract as
    // event_monitors: poll_watermark is an OPAQUE string rendered by the
    // source DB itself, never a JS-derived ISO string (µs precision).
    table_name: text("table_name"),
    time_column: text("time_column"),
    poll_watermark: text("poll_watermark"),
    last_polled_at: timestamp("last_polled_at", {
      withTimezone: true,
      mode: "string",
    }),
    // Health: outcome of the most recent poll attempt (incl. skips/errors), so
    // the UI can show Working / Skipped: reason / Failing: reason.
    last_status: text("last_status"),
    last_error: text("last_error"),
    last_evaluated_at: timestamp("last_evaluated_at", {
      withTimezone: true,
      mode: "string",
    }),
  },
  (table) => [
    index("idx_source_limits_org_source").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.source_id.asc().nullsLast(),
    ),
    index("idx_source_limits_source_id").using(
      "btree",
      table.source_id.asc().nullsLast(),
    ),
    foreignKey({
      columns: [table.source_id],
      foreignColumns: [sources.id],
      name: "source_limits_source_id_fkey",
    }).onDelete("cascade"),
    unique("source_limits_org_id_source_id_metric_key").on(
      table.org_id,
      table.source_id,
      table.metric,
    ),
  ],
);

export const terminalConversations = pgTable(
  "terminal_conversations",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    org_id: text("org_id").notNull(),
    user_id: text("user_id").notNull(),
    title: text().notNull(),
    messages: jsonb().default([]).notNull(),
    created_at: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    updated_at: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
  },
  (table) => [
    index("terminal_conversations_org_user_idx").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.user_id.asc().nullsLast(),
      table.updated_at.desc().nullsFirst(),
    ),
  ],
);

export const users = pgTable(
  "users",
  {
    id: text().primaryKey().notNull(),
    email: text().notNull(),
    email_verified: timestamp("email_verified", {
      withTimezone: true,
      mode: "string",
    }),
    first_name: text("first_name"),
    last_name: text("last_name"),
    image_url: text("image_url"),
    is_staff: boolean("is_staff").default(false).notNull(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  () => [
    uniqueIndex("users_email_lower_idx").using("btree", sql`lower(email)`),
  ],
);

export const alerts = pgTable(
  "alerts",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    org_id: text("org_id").notNull(),
    source_id: uuid("source_id"),
    trigger_type: alertTriggerType("trigger_type").notNull(),
    metric: text().notNull(),
    value: numeric({ mode: "number" }).notNull(),
    threshold: numeric({ mode: "number" }),
    bound: text(),
    severity: alertSeverity().default("warning").notNull(),
    status: alertStatus().default("open").notNull(),
    recommended_actions: jsonb("recommended_actions").default([]),
    alert_stats: jsonb("alert_stats").default([]),
    context_snapshot: jsonb("context_snapshot").default({}),
    limit_id: uuid("limit_id"),
    triggered_at: timestamp("triggered_at", {
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
    acknowledged_at: timestamp("acknowledged_at", {
      withTimezone: true,
      mode: "string",
    }),
    acknowledged_by: text("acknowledged_by"),
    resolved_at: timestamp("resolved_at", {
      withTimezone: true,
      mode: "string",
    }),
    resolved_by: text("resolved_by"),
    resolution_notes: text("resolution_notes"),
    created_at: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    updated_at: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    rule_id: uuid("rule_id"),
    is_alert_active: boolean("is_alert_active").default(false).notNull(),
    closed_at: timestamp("closed_at", { withTimezone: true, mode: "string" }),
    // Operator verdict — TEXT with a CHECK (current_verdict IN ('helpful','noise')),
    // added by Supabase migrations 00068/00069. The training signal for
    // default-silence; partial recency indexes on (org_id, rule_id|limit_id,
    // source_id, triggered_at DESC) WHERE current_verdict IS NOT NULL live in the DB.
    current_verdict: text("current_verdict"),
  },
  (table) => [
    index("alerts_org_id_idx").using("btree", table.org_id.asc().nullsLast()),
    index("alerts_org_status_idx").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.status.asc().nullsLast(),
    ),
    index("alerts_org_triggered_idx").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.triggered_at.desc().nullsFirst(),
    ),
    index("alerts_severity_idx").using(
      "btree",
      table.severity.asc().nullsLast(),
    ),
    index("alerts_source_id_idx").using(
      "btree",
      table.source_id.asc().nullsLast(),
    ),
    index("alerts_status_idx").using("btree", table.status.asc().nullsLast()),
    index("alerts_triggered_at_idx").using(
      "btree",
      table.triggered_at.desc().nullsFirst(),
    ),
    uniqueIndex("idx_alerts_one_open_per_rule_source")
      .using(
        "btree",
        table.org_id.asc().nullsLast(),
        table.rule_id.asc().nullsLast(),
        table.source_id.asc().nullsLast(),
      )
      .where(sql`((is_alert_active = true) AND (rule_id IS NOT NULL))`),
    foreignKey({
      columns: [table.limit_id],
      foreignColumns: [sourceLimits.id],
      name: "alerts_limit_id_fkey",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.rule_id],
      foreignColumns: [alertRules.id],
      name: "alerts_rule_id_fkey",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.source_id],
      foreignColumns: [sources.id],
      name: "alerts_source_id_fkey",
    }).onDelete("cascade"),
  ],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    session_token: text("session_token").primaryKey().notNull(),
    user_id: text("user_id").notNull(),
    expires: timestamp({ withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    index("idx_auth_sessions_user_id").using(
      "btree",
      table.user_id.asc().nullsLast(),
    ),
    foreignKey({
      columns: [table.user_id],
      foreignColumns: [users.id],
      name: "auth_sessions_user_id_fkey",
    }).onDelete("cascade"),
  ],
);

export const annotations = pgTable(
  "annotations",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    org_id: text("org_id").notNull(),
    source_type: text("source_type").default("device").notNull(),
    source_id: text("source_id"),
    telemetry_id: text("telemetry_id"),
    timestamp_start: timestamp("timestamp_start", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    timestamp_end: timestamp("timestamp_end", {
      withTimezone: true,
      mode: "string",
    }),
    metric_name: text("metric_name"),
    value_snapshot: jsonb("value_snapshot"),
    label: text().notNull(),
    notes: text(),
    color: text().default("amber"),
    run_id: uuid("run_id"),
    created_by: text("created_by"),
    created_at: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    updated_at: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
  },
  (table) => [
    index("idx_annotations_source_time").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.source_id.asc().nullsLast(),
      table.timestamp_start.asc().nullsLast(),
    ),
    index("idx_annotations_time_range")
      .using(
        "btree",
        table.org_id.asc().nullsLast(),
        table.timestamp_start.asc().nullsLast(),
        table.timestamp_end.asc().nullsLast(),
      )
      .where(sql`(timestamp_end IS NOT NULL)`),
    index("idx_annotations_run")
      .using(
        "btree",
        table.org_id.asc().nullsLast(),
        table.run_id.asc().nullsLast(),
      )
      .where(sql`(run_id IS NOT NULL)`),
    foreignKey({
      columns: [table.run_id],
      foreignColumns: [runs.id],
      name: "annotations_run_id_fkey",
    }).onDelete("set null"),
  ],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    org_id: text("org_id").notNull(),
    name: text().notNull(),
    key_hash: text("key_hash").notNull(),
    key_prefix: text("key_prefix").notNull(),
    scopes: text().array(),
    last_used_at: timestamp("last_used_at", {
      withTimezone: true,
      mode: "string",
    }),
    expires_at: timestamp("expires_at", { withTimezone: true, mode: "string" }),
    created_at: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    access_enabled: boolean("access_enabled").default(true).notNull(),
  },
  (table) => [
    index("idx_api_keys_hash").using("btree", table.key_hash.asc().nullsLast()),
    index("idx_api_keys_org_id").using("btree", table.org_id.asc().nullsLast()),
  ],
);

export const columnMetadata = pgTable(
  "column_metadata",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    org_id: text("org_id").notNull(),
    source_id: text("source_id").notNull(),
    column_key: text("column_key").notNull(),
    label: text(),
    description: text(),
    unit: text(),
    semantic_type: text("semantic_type"),
    ml_role: text("ml_role"),
    aggregation: text(),
    sensitivity: text().default("none").notNull(),
    expected_min: doublePrecision("expected_min"),
    expected_max: doublePrecision("expected_max"),
    categories: jsonb().default([]).notNull(),
    tags: jsonb().default([]).notNull(),
    extra: jsonb().default({}).notNull(),
    ai_suggested: jsonb("ai_suggested"),
    source_origin: text("source_origin").default("user").notNull(),
    created_by: text("created_by"),
    created_at: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    updated_at: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
  },
  (table) => [
    index("idx_column_metadata_source").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.source_id.asc().nullsLast(),
    ),
    uniqueIndex("idx_column_metadata_unique").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.source_id.asc().nullsLast(),
      table.column_key.asc().nullsLast(),
    ),
    check(
      "column_metadata_aggregation_check",
      sql`aggregation = ANY (ARRAY['avg'::text, 'sum'::text, 'min'::text, 'max'::text, 'last'::text, 'none'::text])`,
    ),
    check(
      "column_metadata_ml_role_check",
      sql`ml_role = ANY (ARRAY['feature'::text, 'target'::text, 'identifier'::text, 'ignore'::text])`,
    ),
    check(
      "column_metadata_semantic_type_check",
      sql`semantic_type = ANY (ARRAY['identifier'::text, 'category'::text, 'measurement'::text, 'status'::text, 'location'::text, 'timestamp'::text, 'text'::text, 'boolean'::text])`,
    ),
    check(
      "column_metadata_sensitivity_check",
      sql`sensitivity = ANY (ARRAY['none'::text, 'pii'::text, 'sensitive'::text])`,
    ),
    check(
      "column_metadata_source_origin_check",
      sql`source_origin = ANY (ARRAY['user'::text, 'ai'::text, 'ai_accepted'::text])`,
    ),
  ],
);

export const dashboardIconAssets = pgTable(
  "dashboard_icon_assets",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    org_id: text("org_id").notNull(),
    url: text().notNull(),
    storage_path: text("storage_path").notNull(),
    file_name: text("file_name"),
    content_type: text("content_type"),
    size_bytes: integer("size_bytes"),
    created_by: text("created_by"),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_dashboard_icon_assets_org").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.created_at.desc().nullsFirst(),
    ),
  ],
);

export const alertRules = pgTable(
  "alert_rules",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    org_id: text("org_id").notNull(),
    source_id: text("source_id").notNull(),
    type: alertRuleType().notNull(),
    metric: text(),
    conditions: jsonb().default({}).notNull(),
    operator: alertRuleOperator(),
    sub_rules: jsonb("sub_rules"),
    hysteresis_seconds: integer("hysteresis_seconds"),
    cooldown_seconds: integer("cooldown_seconds"),
    severity: text().default("warning").notNull(),
    enabled: boolean().default(true).notNull(),
    // Explicit notification targets (slack/email/webhook integration ids).
    // NULL = default fan-out to every integration subscribed to the event type.
    notification_target_ids: uuid("notification_target_ids").array(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_alert_rules_org")
      .using("btree", table.org_id.asc().nullsLast())
      .where(sql`enabled`),
    index("idx_alert_rules_org_source")
      .using(
        "btree",
        table.org_id.asc().nullsLast(),
        table.source_id.asc().nullsLast(),
      )
      .where(sql`enabled`),
    check("alert_rules_cooldown_seconds_check", sql`cooldown_seconds >= 0`),
    check("alert_rules_hysteresis_seconds_check", sql`hysteresis_seconds >= 0`),
    check(
      "alert_rules_type_shape",
      sql`((type = 'compound'::alert_rule_type) AND (metric IS NULL) AND (operator IS NOT NULL) AND (sub_rules IS NOT NULL)) OR ((type = ANY (ARRAY['threshold'::alert_rule_type, 'outlier'::alert_rule_type])) AND (metric IS NOT NULL) AND (operator IS NULL) AND (sub_rules IS NULL)) OR ((metric IS NULL) AND (operator IS NULL) AND (sub_rules IS NULL))`,
    ),
  ],
);

export const alertEvents = pgTable(
  "alert_events",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    org_id: text("org_id").notNull(),
    alert_id: uuid("alert_id").notNull(),
    event_type: text("event_type").notNull(),
    actor_id: text("actor_id"),
    message: text(),
    metadata: jsonb().default({}),
    created_at: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
  },
  (table) => [
    index("alert_events_alert_id_idx").using(
      "btree",
      table.alert_id.asc().nullsLast(),
    ),
    index("alert_events_created_at_idx").using(
      "btree",
      table.created_at.desc().nullsFirst(),
    ),
    index("alert_events_org_id_idx").using(
      "btree",
      table.org_id.asc().nullsLast(),
    ),
    foreignKey({
      columns: [table.alert_id],
      foreignColumns: [alerts.id],
      name: "alert_events_alert_id_fkey",
    }).onDelete("cascade"),
  ],
);

export const dashboardShareLinks = pgTable(
  "dashboard_share_links",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    org_id: text("org_id").notNull(),
    dashboard_id: uuid("dashboard_id").notNull(),
    token: text().notNull(),
    name: text(),
    access_level: shareLinkAccess("access_level").default("view").notNull(),
    status: shareLinkStatus().default("active").notNull(),
    password_hash: text("password_hash"),
    expires_at: timestamp("expires_at", { withTimezone: true, mode: "string" }),
    max_views: integer("max_views"),
    view_count: integer("view_count").default(0).notNull(),
    created_by: text("created_by").notNull(),
    created_at: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    updated_at: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
  },
  (table) => [
    index("idx_dashboard_share_links_dashboard_id").using(
      "btree",
      table.dashboard_id.asc().nullsLast(),
    ),
    index("idx_dashboard_share_links_org_id").using(
      "btree",
      table.org_id.asc().nullsLast(),
    ),
    index("idx_dashboard_share_links_token").using(
      "btree",
      table.token.asc().nullsLast(),
    ),
    foreignKey({
      columns: [table.dashboard_id],
      foreignColumns: [dashboards.id],
      name: "dashboard_share_links_dashboard_id_fkey",
    }).onDelete("cascade"),
    unique("dashboard_share_links_token_key").on(table.token),
  ],
);

export const emailIntegrations = pgTable(
  "email_integrations",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    org_id: text("org_id").notNull(),
    name: text().notNull(),
    email_address: text("email_address").notNull(),
    enabled: boolean().default(true).notNull(),
    events: text()
      .array()
      .default(["alert.triggered", "alert.resolved"])
      .notNull(),
    total_events: integer("total_events").default(0).notNull(),
    successful_events: integer("successful_events").default(0).notNull(),
    failed_events: integer("failed_events").default(0).notNull(),
    last_event_at: timestamp("last_event_at", {
      withTimezone: true,
      mode: "string",
    }),
    last_error: text("last_error"),
    created_at: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    updated_at: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    created_by: text("created_by"),
  },
  (table) => [
    index("email_integrations_enabled_idx")
      .using(
        "btree",
        table.org_id.asc().nullsLast(),
        table.enabled.asc().nullsLast(),
      )
      .where(sql`(enabled = true)`),
    index("email_integrations_org_id_idx").using(
      "btree",
      table.org_id.asc().nullsLast(),
    ),
    unique("email_integrations_org_id_email_address_key").on(
      table.org_id,
      table.email_address,
    ),
  ],
);

export const dashboards = pgTable(
  "dashboards",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    org_id: text("org_id").notNull(),
    name: text().notNull(),
    description: text(),
    config: jsonb().notNull(),
    created_at: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    updated_at: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    parent_id: uuid("parent_id"),
    icon: text(),
    icon_url: text("icon_url"),
    visibility: text().default("org").notNull(),
    created_by: text("created_by"),
  },
  (table) => [
    index("idx_dashboards_org_id").using(
      "btree",
      table.org_id.asc().nullsLast(),
    ),
    index("idx_dashboards_parent_id").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.parent_id.asc().nullsLast(),
    ),
    foreignKey({
      columns: [table.parent_id],
      foreignColumns: [table.id],
      name: "dashboards_parent_id_fkey",
    }).onDelete("set null"),
    check(
      "dashboards_visibility_chk",
      sql`visibility = ANY (ARRAY['org'::text, 'restricted'::text])`,
    ),
  ],
);

export const dashboardViews = pgTable(
  "dashboard_views",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    org_id: text("org_id").notNull(),
    dashboard_id: uuid("dashboard_id").notNull(),
    share_link_id: uuid("share_link_id"),
    viewer_id: text("viewer_id"),
    session_id: text("session_id").notNull(),
    ip_address: text("ip_address"),
    user_agent: text("user_agent"),
    referrer: text(),
    country: text(),
    city: text(),
    duration_seconds: integer("duration_seconds"),
    panels_viewed: jsonb("panels_viewed"),
    started_at: timestamp("started_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    ended_at: timestamp("ended_at", { withTimezone: true, mode: "string" }),
    created_at: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
  },
  (table) => [
    index("idx_dashboard_views_dashboard_id").using(
      "btree",
      table.dashboard_id.asc().nullsLast(),
    ),
    index("idx_dashboard_views_org_id").using(
      "btree",
      table.org_id.asc().nullsLast(),
    ),
    index("idx_dashboard_views_session_id").using(
      "btree",
      table.session_id.asc().nullsLast(),
    ),
    index("idx_dashboard_views_share_link_id").using(
      "btree",
      table.share_link_id.asc().nullsLast(),
    ),
    index("idx_dashboard_views_started_at").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.started_at.asc().nullsLast(),
    ),
    foreignKey({
      columns: [table.dashboard_id],
      foreignColumns: [dashboards.id],
      name: "dashboard_views_dashboard_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.share_link_id],
      foreignColumns: [dashboardShareLinks.id],
      name: "dashboard_views_share_link_id_fkey",
    }).onDelete("set null"),
  ],
);

export const deviceAuthRequests = pgTable(
  "device_auth_requests",
  {
    device_code: text("device_code").primaryKey().notNull(),
    user_code: text("user_code").notNull(),
    expires_at: timestamp("expires_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    status: text().default("pending").notNull(),
    org_id: text("org_id"),
    api_key_id: uuid("api_key_id"),
    requested_name: text("requested_name"),
    created_at: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
  },
  (table) => [
    index("idx_device_auth_expires").using(
      "btree",
      table.expires_at.asc().nullsLast(),
    ),
    uniqueIndex("idx_device_auth_user_code").using(
      "btree",
      table.user_code.asc().nullsLast(),
    ),
    foreignKey({
      columns: [table.api_key_id],
      foreignColumns: [apiKeys.id],
      name: "device_auth_requests_api_key_id_fkey",
    }).onDelete("set null"),
    check(
      "device_auth_requests_status_check",
      sql`status = ANY (ARRAY['pending'::text, 'approved'::text, 'denied'::text, 'expired'::text])`,
    ),
  ],
);

export const orgBilling = pgTable("org_billing", {
  org_id: text("org_id").primaryKey().notNull(),
  org_name: text("org_name"),
  // Public URL of the org logo in the icons bucket ({orgId}/logo/{uuid}.{ext}).
  logo_url: text("logo_url"),
  tier: text().default("tier_1").notNull(),
  stripe_customer_id: text("stripe_customer_id"),
  stripe_subscription_status: text("stripe_subscription_status"),
  enterprise_info: jsonb("enterprise_info"),
  monthly_spend_cap_usd: numeric("monthly_spend_cap_usd", { mode: "number" }),
  platform_fee_usd: numeric("platform_fee_usd", { mode: "number" }),
  free_tier_revoked_key_ids: text("free_tier_revoked_key_ids")
    .array()
    .default([])
    .notNull(),
  spend_cap_revoked_key_ids: text("spend_cap_revoked_key_ids")
    .array()
    .default([])
    .notNull(),
  high_burn_thresholds_alerted: jsonb("high_burn_thresholds_alerted"),
  free_tier_breach_email_sent_for_month: text(
    "free_tier_breach_email_sent_for_month",
  ),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  org_created_at: timestamp("org_created_at", {
    withTimezone: true,
    mode: "string",
  }),
  drip_markers: jsonb("drip_markers").default({}).notNull(),
});

export const recordings = pgTable(
  "recordings",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    org_id: text("org_id").notNull(),
    // The device/source this camera belongs to. Nullable: cameras are
    // WS-discovered and camera_id is not globally unique, so a recording is
    // only reliably tied to its device when source_id is captured at create
    // time. Legacy rows stay null and surface device-scoped via camera_id only.
    source_id: text("source_id"),
    camera_id: text("camera_id").notNull(),
    gateway_api_key_id: uuid("gateway_api_key_id"),
    status: text().default("requested").notNull(),
    expires_at: timestamp("expires_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    started_at: timestamp("started_at", { withTimezone: true, mode: "string" }),
    finished_at: timestamp("finished_at", {
      withTimezone: true,
      mode: "string",
    }),
    playback_url: text("playback_url"),
    error_message: text("error_message"),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("recordings_expires_idx")
      .using("btree", table.expires_at.asc().nullsLast())
      .where(sql`(status = ANY (ARRAY['requested'::text, 'recording'::text]))`),
    index("recordings_org_status_idx").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.status.asc().nullsLast(),
    ),
    index("recordings_org_source_idx").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.source_id.asc().nullsLast(),
    ),
  ],
);

// A test run: a named, org-scoped time window on a source. Created by test
// scripts via /api/runs (API-key auth) or from the dashboard time-range picker
// ("Save as run"). Drives run recall (/runs) and run-compare chart overlays.
// pass_criteria/test_result carry the structured-validation design from the
// original table (supabase/00022); evaluation on close is a later phase.
export const runs = pgTable(
  "runs",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    org_id: text("org_id").notNull(),
    name: text().notNull(),
    source_id: uuid("source_id"),
    status: text().default("active").notNull(),
    started_at: timestamp("started_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    ended_at: timestamp("ended_at", { withTimezone: true, mode: "string" }),
    tags: jsonb(),
    metadata: jsonb(),
    // Array of {metric, operator, value, label?} — see PassCriterionSchema.
    pass_criteria: jsonb("pass_criteria").default([]).notNull(),
    // {passed, evaluated_at, criteria_results[]} once evaluated.
    test_result: jsonb("test_result"),
    created_by: text("created_by"),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("runs_org_started_idx").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.started_at.desc().nullsFirst(),
    ),
    index("runs_org_status_idx").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.status.asc().nullsLast(),
    ),
    index("runs_org_source_idx").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.source_id.asc().nullsLast(),
    ),
    foreignKey({
      columns: [table.source_id],
      foreignColumns: [sources.id],
      name: "runs_source_id_fkey",
    }).onDelete("set null"),
    check(
      "runs_valid_status",
      sql`status = ANY (ARRAY['active'::text, 'completed'::text, 'aborted'::text])`,
    ),
  ],
).enableRLS();

export const slackIntegrations = pgTable(
  "slack_integrations",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    org_id: text("org_id").notNull(),
    team_id: text("team_id").notNull(),
    team_name: text("team_name").notNull(),
    channel_id: text("channel_id").notNull(),
    channel_name: text("channel_name").notNull(),
    webhook_url_encrypted: text("webhook_url_encrypted").notNull(),
    access_token_encrypted: text("access_token_encrypted"),
    enabled: boolean().default(true).notNull(),
    events: text()
      .array()
      .default(["alert.triggered", "device.offline"])
      .notNull(),
    created_at: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    updated_at: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    created_by: text("created_by"),
    total_events: integer("total_events").default(0).notNull(),
    successful_events: integer("successful_events").default(0).notNull(),
    failed_events: integer("failed_events").default(0).notNull(),
    last_event_at: timestamp("last_event_at", {
      withTimezone: true,
      mode: "string",
    }),
    last_error: text("last_error"),
  },
  (table) => [
    index("slack_integrations_enabled_idx")
      .using(
        "btree",
        table.org_id.asc().nullsLast(),
        table.enabled.asc().nullsLast(),
      )
      .where(sql`(enabled = true)`),
    index("slack_integrations_org_id_idx").using(
      "btree",
      table.org_id.asc().nullsLast(),
    ),
    index("slack_integrations_team_id_idx").using(
      "btree",
      table.team_id.asc().nullsLast(),
    ),
    unique("slack_integrations_org_id_team_id_channel_id_key").on(
      table.org_id,
      table.team_id,
      table.channel_id,
    ),
  ],
);

export const feedback = pgTable(
  "feedback",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    org_id: text("org_id"),
    user_id: text("user_id"),
    user_email: text("user_email"),
    feedback_type: feedback_type("feedback_type").default("general").notNull(),
    title: text().notNull(),
    message: text().notNull(),
    page_url: text("page_url"),
    user_agent: text("user_agent"),
    metadata: jsonb().default({}),
    created_at: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
  },
  (table) => [
    index("idx_feedback_created_at").using(
      "btree",
      table.created_at.asc().nullsLast(),
    ),
    index("idx_feedback_org_id").using("btree", table.org_id.asc().nullsLast()),
    index("idx_feedback_type").using(
      "btree",
      table.feedback_type.asc().nullsLast(),
    ),
    index("idx_feedback_user_id").using(
      "btree",
      table.user_id.asc().nullsLast(),
    ),
  ],
);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    org_id: text("org_id").notNull(),
    channel: text().notNull(),
    integration_id: uuid("integration_id").notNull(),
    event_type: text("event_type").notNull(),
    payload: jsonb().notNull(),
    status: text().default("pending").notNull(),
    attempt_count: integer("attempt_count").default(0).notNull(),
    max_attempts: integer("max_attempts").default(3).notNull(),
    response_status: integer("response_status"),
    response_body: text("response_body"),
    response_time_ms: integer("response_time_ms"),
    error: text(),
    scheduled_at: timestamp("scheduled_at", {
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
    next_retry_at: timestamp("next_retry_at", {
      withTimezone: true,
      mode: "string",
    }),
    delivered_at: timestamp("delivered_at", {
      withTimezone: true,
      mode: "string",
    }),
    created_at: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
  },
  (table) => [
    index("notification_deliveries_integration_idx").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.integration_id.asc().nullsLast(),
      table.created_at.desc().nullsFirst(),
    ),
    index("notification_deliveries_org_created_idx").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.created_at.desc().nullsFirst(),
    ),
    index("notification_deliveries_pending_retry_idx")
      .using(
        "btree",
        table.status.asc().nullsLast(),
        table.next_retry_at.asc().nullsLast(),
      )
      .where(sql`(status = ANY (ARRAY['pending'::text, 'retrying'::text]))`),
    check(
      "notification_deliveries_channel_check",
      sql`channel = ANY (ARRAY['slack'::text, 'email'::text, 'pagerduty'::text])`,
    ),
    check(
      "notification_deliveries_status_check",
      sql`status = ANY (ARRAY['pending'::text, 'retrying'::text, 'delivered'::text, 'failed'::text])`,
    ),
  ],
);

export const sourcePermissions = pgTable(
  "source_permissions",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    org_id: text("org_id").notNull(),
    source_id: uuid("source_id"),
    source_group_id: uuid("source_group_id"),
    user_id: text("user_id"),
    email: text(),
    access_level: text("access_level").default("view").notNull(),
    invited_by: text("invited_by"),
    accepted_at: timestamp("accepted_at", {
      withTimezone: true,
      mode: "string",
    }),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    role: text(),
  },
  (table) => [
    index("idx_source_permissions_group").using(
      "btree",
      table.source_group_id.asc().nullsLast(),
    ),
    index("idx_source_permissions_org").using(
      "btree",
      table.org_id.asc().nullsLast(),
    ),
    index("idx_source_permissions_role").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.role.asc().nullsLast(),
    ),
    index("idx_source_permissions_source").using(
      "btree",
      table.source_id.asc().nullsLast(),
    ),
    uniqueIndex("idx_source_permissions_unique").using(
      "btree",
      sql`COALESCE((source_id)::text, ''::text)`,
      sql`COALESCE((source_group_id)::text, ''::text)`,
      sql`COALESCE(user_id, ''::text)`,
      sql`COALESCE(email, ''::text)`,
      sql`COALESCE(role, ''::text)`,
    ),
    index("idx_source_permissions_user").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.user_id.asc().nullsLast(),
    ),
    foreignKey({
      columns: [table.source_group_id],
      foreignColumns: [sourceGroups.id],
      name: "source_permissions_source_group_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.source_id],
      foreignColumns: [sources.id],
      name: "source_permissions_source_id_fkey",
    }).onDelete("cascade"),
    check(
      "source_permissions_access_chk",
      sql`access_level = ANY (ARRAY['view'::text, 'edit'::text])`,
    ),
    check(
      "source_permissions_grantee_present",
      sql`(user_id IS NOT NULL) OR (email IS NOT NULL) OR (role IS NOT NULL)`,
    ),
    check(
      "source_permissions_one_resource",
      sql`(source_id IS NOT NULL) <> (source_group_id IS NOT NULL)`,
    ),
  ],
);

export const sources = pgTable(
  "sources",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    org_id: text("org_id").notNull(),
    source_type: text("source_type").notNull(),
    slug: text().notNull(),
    name: text(),
    description: text(),
    status: text().default("pending").notNull(),
    last_seen_at: timestamp("last_seen_at", {
      withTimezone: true,
      mode: "string",
    }),
    last_connected_at: timestamp("last_connected_at", {
      withTimezone: true,
      mode: "string",
    }),
    last_error: text("last_error"),
    device_type: text("device_type"),
    connection_type: text("connection_type"),
    credentials_encrypted: text("credentials_encrypted"),
    config: jsonb().default({ recording: false }).notNull(),
    metadata: jsonb().default({}).notNull(),
    created_at: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    updated_at: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    health_score: integer("health_score"),
    tags: text().array().default([]),
    is_telemetry_store: boolean("is_telemetry_store").default(false).notNull(),
    ssh_credentials_encrypted: text("ssh_credentials_encrypted"),
    visibility: text().default("org").notNull(),
    created_by: text("created_by"),
  },
  (table) => [
    index("idx_sources_connection_type")
      .using(
        "btree",
        table.org_id.asc().nullsLast(),
        table.connection_type.asc().nullsLast(),
      )
      .where(sql`(source_type = 'connection'::text)`),
    index("idx_sources_last_seen")
      .using(
        "btree",
        table.org_id.asc().nullsLast(),
        table.last_seen_at.desc().nullsLast(),
      )
      .where(sql`(source_type = 'device'::text)`),
    index("idx_sources_org_id").using("btree", table.org_id.asc().nullsLast()),
    index("idx_sources_org_slug").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.slug.asc().nullsLast(),
    ),
    index("idx_sources_org_status").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.status.asc().nullsLast(),
    ),
    index("idx_sources_org_type").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.source_type.asc().nullsLast(),
    ),
    index("idx_sources_telemetry_store")
      .using(
        "btree",
        table.org_id.asc().nullsLast(),
        table.is_telemetry_store.asc().nullsLast(),
      )
      .where(sql`(is_telemetry_store = true)`),
    uniqueIndex("idx_sources_telemetry_store_unique")
      .using("btree", table.org_id.asc().nullsLast())
      .where(sql`(is_telemetry_store = true)`),
    index("sources_device_type_idx").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.device_type.asc().nullsLast(),
    ),
    index("sources_health_score_idx").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.health_score.asc().nullsLast(),
    ),
    index("sources_tags_idx").using(
      "gin",
      table.tags.asc().nullsLast().op("array_ops"),
    ),
    unique("sources_unique_org_slug").on(table.org_id, table.slug),
    check(
      "sources_telemetry_store_connection_only",
      sql`(is_telemetry_store = false) OR (source_type = 'connection'::text)`,
    ),
    check(
      "sources_valid_status",
      sql`status = ANY (ARRAY['pending'::text, 'online'::text, 'offline'::text, 'error'::text])`,
    ),
    check(
      "sources_valid_type",
      sql`source_type = ANY (ARRAY['device'::text, 'connection'::text, 'recording'::text, 'import'::text])`,
    ),
    check(
      "sources_visibility_chk",
      sql`visibility = ANY (ARRAY['org'::text, 'restricted'::text])`,
    ),
  ],
);

export const sourceGroups = pgTable(
  "source_groups",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    org_id: text("org_id").notNull(),
    name: text().notNull(),
    description: text(),
    filter_criteria: jsonb("filter_criteria").default({}),
    static_member_ids: uuid("static_member_ids").array().default([]),
    color: text(),
    icon: text(),
    created_at: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    updated_at: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    source_types: text("source_types").array(),
  },
  (table) => [
    index("device_groups_name_idx").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.name.asc().nullsLast(),
    ),
    index("device_groups_org_id_idx").using(
      "btree",
      table.org_id.asc().nullsLast(),
    ),
  ],
);

export const systemEvents = pgTable(
  "system_events",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    org_id: text("org_id").notNull(),
    event_type: text("event_type").notNull(),
    category: text().notNull(),
    title: text().notNull(),
    description: text(),
    severity: text().default("info").notNull(),
    source_id: uuid("source_id"),
    source_name: text("source_name"),
    source_slug: text("source_slug"),
    entity_id: text("entity_id"),
    entity_type: text("entity_type"),
    actor_id: text("actor_id"),
    metadata: jsonb().default({}),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    search_vector: tsvector("search_vector").generatedAlwaysAs(
      sql`((setweight(to_tsvector('english'::regconfig, COALESCE(title, ''::text)), 'A'::"char") || setweight(to_tsvector('english'::regconfig, COALESCE(description, ''::text)), 'B'::"char")) || setweight(to_tsvector('english'::regconfig, COALESCE(source_name, ''::text)), 'C'::"char"))`,
    ),
  },
  (table) => [
    index("idx_system_events_org_category").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.category.asc().nullsLast(),
      table.created_at.desc().nullsFirst(),
    ),
    index("idx_system_events_org_created").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.created_at.desc().nullsFirst(),
    ),
    index("idx_system_events_org_severity").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.severity.asc().nullsLast(),
      table.created_at.desc().nullsFirst(),
    ),
    index("idx_system_events_org_source").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.source_id.asc().nullsLast(),
      table.created_at.desc().nullsFirst(),
    ),
    index("idx_system_events_org_type").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.event_type.asc().nullsLast(),
      table.created_at.desc().nullsFirst(),
    ),
    index("idx_system_events_search").using(
      "gin",
      table.search_vector.asc().nullsLast().op("tsvector_ops"),
    ),
  ],
);

export const sourceAssociations = pgTable(
  "source_associations",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    org_id: text("org_id").notNull(),
    entity_type: text("entity_type").notNull(),
    entity_id: uuid("entity_id").notNull(),
    connection_id: uuid("connection_id").notNull(),
    table_name: text("table_name").notNull(),
    table_schema: text("table_schema"),
    filter_column: text("filter_column"),
    filter_value: text("filter_value"),
    label: text(),
    created_at: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    updated_at: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    query_template: text("query_template"),
  },
  (table) => [
    index("idx_source_assoc_connection").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.connection_id.asc().nullsLast(),
    ),
    index("idx_source_assoc_entity").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.entity_type.asc().nullsLast(),
      table.entity_id.asc().nullsLast(),
    ),
    uniqueIndex("idx_source_assoc_unique").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.entity_id.asc().nullsLast(),
      table.connection_id.asc().nullsLast(),
      table.table_name.asc().nullsLast(),
    ),
    foreignKey({
      columns: [table.connection_id],
      foreignColumns: [sources.id],
      name: "source_associations_connection_id_fkey",
    }).onDelete("cascade"),
    check(
      "source_associations_entity_type_check",
      sql`entity_type = ANY (ARRAY['device'::text, 'satellite'::text])`,
    ),
  ],
);

export const sourceContext = pgTable(
  "source_context",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    org_id: text("org_id").notNull(),
    source_id: uuid("source_id").notNull(),
    context_type: text("context_type").notNull(),
    name: text().notNull(),
    description: text(),
    file_url: text("file_url"),
    file_key: text("file_key"),
    file_size: integer("file_size"),
    mime_type: text("mime_type"),
    link_url: text("link_url"),
    content: text(),
    created_by: text("created_by"),
    created_at: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    updated_at: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
  },
  (table) => [
    index("idx_source_context_org").using(
      "btree",
      table.org_id.asc().nullsLast(),
    ),
    index("idx_source_context_source").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.source_id.asc().nullsLast(),
    ),
    index("idx_source_context_type").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.source_id.asc().nullsLast(),
      table.context_type.asc().nullsLast(),
    ),
    foreignKey({
      columns: [table.source_id],
      foreignColumns: [sources.id],
      name: "source_context_source_id_fkey",
    }).onDelete("cascade"),
    check(
      "source_context_file_has_url",
      sql`(context_type <> 'file'::text) OR ((file_url IS NOT NULL) AND (file_key IS NOT NULL))`,
    ),
    check(
      "source_context_link_has_url",
      sql`(context_type <> 'link'::text) OR (link_url IS NOT NULL)`,
    ),
    check(
      "source_context_note_has_content",
      sql`(context_type <> 'note'::text) OR (content IS NOT NULL)`,
    ),
    check(
      "source_context_valid_type",
      sql`context_type = ANY (ARRAY['file'::text, 'link'::text, 'note'::text])`,
    ),
  ],
);

// Per-org monthly Anthropic token usage, keyed by (org, month, model). Written
// fire-and-forget from each AI call site (lib/ai/usage.ts recordAiTokens); summed
// by report-usage for the proposed AI meter. See BILLING.md.
export const aiUsage = pgTable(
  "ai_usage",
  {
    org_id: text("org_id").notNull(),
    period_start: date("period_start").notNull(),
    model: text("model").notNull(),
    input_tokens: bigint("input_tokens", { mode: "number" }).default(0).notNull(),
    output_tokens: bigint("output_tokens", { mode: "number" })
      .default(0)
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.org_id, table.period_start, table.model] }),
  ],
).enableRLS();

export const usage = pgTable(
  "usage",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    org_id: text("org_id").notNull(),
    period_start: date("period_start").notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    data_points_ingested: bigint("data_points_ingested", { mode: "number" })
      .default(0)
      .notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    bytes_ingested: bigint("bytes_ingested", { mode: "number" })
      .default(0)
      .notNull(),
    devices_active: integer("devices_active").default(0).notNull(),
    sessions_created: integer("sessions_created").default(0).notNull(),
    created_at: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    updated_at: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
  },
  (table) => [
    index("idx_usage_org_id").using("btree", table.org_id.asc().nullsLast()),
    index("idx_usage_period").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.period_start.desc().nullsFirst(),
    ),
    unique("usage_org_id_period_start_key").on(
      table.org_id,
      table.period_start,
    ),
  ],
);

export const webhooks = pgTable(
  "webhooks",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    org_id: text("org_id").notNull(),
    name: text().notNull(),
    description: text(),
    url: text().notNull(),
    secret: text().notNull(),
    events: text().array().default([]).notNull(),
    source_filter: jsonb("source_filter"),
    custom_headers: jsonb("custom_headers").default({}),
    enabled: boolean().default(true).notNull(),
    total_deliveries: integer("total_deliveries").default(0).notNull(),
    successful_deliveries: integer("successful_deliveries")
      .default(0)
      .notNull(),
    failed_deliveries: integer("failed_deliveries").default(0).notNull(),
    last_triggered_at: timestamp("last_triggered_at", {
      withTimezone: true,
      mode: "string",
    }),
    last_success_at: timestamp("last_success_at", {
      withTimezone: true,
      mode: "string",
    }),
    last_failure_at: timestamp("last_failure_at", {
      withTimezone: true,
      mode: "string",
    }),
    last_error: text("last_error"),
    created_by: text("created_by").notNull(),
    created_at: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    updated_at: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    secret_prefix: text("secret_prefix").notNull(),
  },
  (table) => [
    index("webhooks_enabled_idx").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.enabled.asc().nullsLast(),
    ),
    index("webhooks_events_idx").using(
      "gin",
      table.events.asc().nullsLast().op("array_ops"),
    ),
    index("webhooks_org_id_idx").using("btree", table.org_id.asc().nullsLast()),
  ],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    org_id: text("org_id").notNull(),
    webhook_id: uuid("webhook_id").notNull(),
    event_type: text("event_type").notNull(),
    event_id: text("event_id").notNull(),
    payload: jsonb().notNull(),
    status: text().default("pending").notNull(),
    attempt_count: integer("attempt_count").default(0).notNull(),
    max_attempts: integer("max_attempts").default(3).notNull(),
    response_status: integer("response_status"),
    response_body: text("response_body"),
    response_time_ms: integer("response_time_ms"),
    error: text(),
    scheduled_at: timestamp("scheduled_at", {
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
    next_retry_at: timestamp("next_retry_at", {
      withTimezone: true,
      mode: "string",
    }),
    delivered_at: timestamp("delivered_at", {
      withTimezone: true,
      mode: "string",
    }),
    created_at: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
  },
  (table) => [
    index("webhook_deliveries_created_at_idx").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.created_at.desc().nullsFirst(),
    ),
    index("webhook_deliveries_event_type_idx").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.event_type.asc().nullsLast(),
    ),
    index("webhook_deliveries_org_id_idx").using(
      "btree",
      table.org_id.asc().nullsLast(),
    ),
    index("webhook_deliveries_pending_retry_idx")
      .using(
        "btree",
        table.status.asc().nullsLast(),
        table.next_retry_at.asc().nullsLast(),
      )
      .where(sql`((status = 'pending'::text) OR (status = 'retrying'::text))`),
    index("webhook_deliveries_status_idx").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.status.asc().nullsLast(),
    ),
    index("webhook_deliveries_webhook_id_idx").using(
      "btree",
      table.webhook_id.asc().nullsLast(),
    ),
    foreignKey({
      columns: [table.webhook_id],
      foreignColumns: [webhooks.id],
      name: "webhook_deliveries_webhook_id_fkey",
    }).onDelete("cascade"),
  ],
);

export const userSettings = pgTable(
  "user_settings",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    user_id: text("user_id").notNull(),
    timezone: text().default("UTC").notNull(),
    use_12_hour_format: boolean("use_12_hour_format").default(false).notNull(),
    created_at: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    updated_at: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
  },
  (table) => [
    index("idx_user_settings_user_id").using(
      "btree",
      table.user_id.asc().nullsLast(),
    ),
    unique("user_settings_user_id_key").on(table.user_id),
  ],
);

export const authVerificationTokens = pgTable(
  "auth_verification_tokens",
  {
    identifier: text().notNull(),
    token: text().notNull(),
    expires: timestamp({ withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.identifier, table.token],
      name: "auth_verification_tokens_pkey",
    }),
  ],
);

export const userNotificationState = pgTable(
  "user_notification_state",
  {
    user_id: text("user_id").notNull(),
    org_id: text("org_id").notNull(),
    alerts_last_seen_at: timestamp("alerts_last_seen_at", {
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("user_notification_state_org_id_idx").using(
      "btree",
      table.org_id.asc().nullsLast(),
    ),
    primaryKey({
      columns: [table.user_id, table.org_id],
      name: "user_notification_state_pkey",
    }),
  ],
);

// Custom roles: name + base (viewer or editor) + per-action exceptions.
// Built-in roles are fixed at manifest defaults; ALL customization lives here.
export const orgRoles = pgTable(
  "org_roles",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    org_id: text("org_id").notNull(),
    name: text().notNull(),
    // Resource-level semantics (public-resource edit rights, rank checks)
    // resolve through the base; the matrix column starts as a copy of it.
    base_role: text("base_role").default("org:viewer").notNull(),
    description: text(),
    created_by: text("created_by"),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_org_roles_org_id").using("btree", table.org_id.asc().nullsLast()),
    unique("org_roles_org_name_key").on(table.org_id, table.name),
    check(
      "org_roles_base_chk",
      sql`base_role = ANY (ARRAY['org:viewer'::text, 'org:editor'::text])`,
    ),
  ],
).enableRLS();

// Per-action exceptions relative to the role's base default.
export const orgRolePermissions = pgTable(
  "org_role_permissions",
  {
    org_id: text("org_id").notNull(),
    role_id: uuid("role_id").notNull(),
    action_id: text("action_id").notNull(),
    allowed: boolean().notNull(),
  },
  (table) => [
    index("idx_org_role_permissions_org").using(
      "btree",
      table.org_id.asc().nullsLast(),
    ),
    foreignKey({
      columns: [table.role_id],
      foreignColumns: [orgRoles.id],
      name: "org_role_permissions_role_id_fkey",
    }).onDelete("cascade"),
    primaryKey({
      columns: [table.role_id, table.action_id],
      name: "org_role_permissions_pkey",
    }),
  ],
).enableRLS();

export const orgMembers = pgTable(
  "org_members",
  {
    org_id: text("org_id").notNull(),
    user_id: text("user_id").notNull(),
    email: text(),
    first_name: text("first_name"),
    last_name: text("last_name"),
    role: text().default("org:viewer").notNull(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    image_url: text("image_url"),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    // NULL = full org access; array (incl. empty) = restricted to exactly
    // these source ids. Entity sources imply row-filtered visibility of their
    // connection (lib/access/scope.ts + entity-scope.ts).
    allowed_source_ids: uuid("allowed_source_ids").array(),
  },
  (table) => [
    index("idx_org_members_org_role").using(
      "btree",
      table.org_id.asc().nullsLast(),
      table.role.asc().nullsLast(),
    ),
    index("idx_org_members_user_id").using(
      "btree",
      table.user_id.asc().nullsLast(),
    ),
    primaryKey({
      columns: [table.org_id, table.user_id],
      name: "org_members_pkey",
    }),
  ],
);

export const authAccounts = pgTable(
  "auth_accounts",
  {
    provider: text().notNull(),
    provider_account_id: text("provider_account_id").notNull(),
    user_id: text("user_id").notNull(),
    type: text().notNull(),
    access_token: text("access_token"),
    refresh_token: text("refresh_token"),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    expires_at: bigint("expires_at", { mode: "number" }),
    token_type: text("token_type"),
    scope: text(),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [
    index("idx_auth_accounts_user_id").using(
      "btree",
      table.user_id.asc().nullsLast(),
    ),
    foreignKey({
      columns: [table.user_id],
      foreignColumns: [users.id],
      name: "auth_accounts_user_id_fkey",
    }).onDelete("cascade"),
    primaryKey({
      columns: [table.provider, table.provider_account_id],
      name: "auth_accounts_pkey",
    }),
  ],
);
export const usageMonthly = pgView("usage_monthly", {
  org_id: text("org_id"),
  month: timestamp({ withTimezone: true, mode: "string" }),
  total_data_points: numeric("total_data_points", { mode: "number" }),
  total_bytes: numeric("total_bytes", { mode: "number" }),
  peak_devices: integer("peak_devices"),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  total_sessions: bigint("total_sessions", { mode: "number" }),
})
  .with({ securityInvoker: true })
  .as(
    sql`SELECT org_id, date_trunc('month'::text, period_start::timestamp with time zone) AS month, sum(data_points_ingested) AS total_data_points, sum(bytes_ingested) AS total_bytes, max(devices_active) AS peak_devices, sum(sessions_created) AS total_sessions FROM usage GROUP BY org_id, (date_trunc('month'::text, period_start::timestamp with time zone))`,
  );
