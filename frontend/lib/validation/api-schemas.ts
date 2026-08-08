/**
 * Zod schemas for API request bodies.
 *
 * Used with validateBody() for consistent server-side validation.
 */

import { z } from "zod";
import { ACTION_IDS, type ActionId } from "@/lib/manifest/types";
import { GRANT_KIND_VALUES } from "@/lib/access/resource-kinds";
import { isUuid } from "@/lib/utils/uuid";
import { SOURCE_KIND_IDS } from "@/lib/sources/kinds";

/**
 * Source slug pattern — must match C SDK's url-safe charset: [a-zA-Z0-9._-]
 * Slugs are lowercase by convention.
 */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const SLUG_ERROR =
  "Must be lowercase letters, numbers, hyphens, dots, or underscores (no spaces)";

// =============================================================================
// Ingest
// =============================================================================

const FlexValueSchema = z.union([
  z.number().finite(),
  z.string(),
  z.boolean(),
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
]);

const IngestPointSchema = z.object({
  metric: z.string().min(1, "metric is required"),
  value: FlexValueSchema,
  source_id: z
    .string()
    .min(1, "source_id is required")
    .regex(SLUG_PATTERN, SLUG_ERROR),
  timestamp: z.number().optional(),
  tags: z.record(z.string(), z.string()).optional(),
});

export const IngestBodySchema = z.object({
  points: z
    .array(IngestPointSchema)
    .min(1, "'points' array is required")
    .max(10_000, "Maximum 10,000 points per request"),
});
export type IngestBody = z.infer<typeof IngestBodySchema>;

// =============================================================================
// Sources
// =============================================================================

export const SSHTunnelSchema = z.object({
  enabled: z.boolean(),
  host: z.string().min(1, "Bastion host is required"),
  port: z.number().int().min(1).max(65535).default(22),
  username: z.string().min(1, "SSH username is required"),
  authMethod: z.enum(["private_key", "password"]),
});

export const CreateSourceSchema = z.object({
  source_type: z.enum(["device", "connection"]),
  slug: z
    .string()
    .min(1, "slug is required")
    .regex(SLUG_PATTERN, SLUG_ERROR)
    // A uuid-shaped slug is unreachable: every resolver treats uuid-shaped
    // refs as internal ids (see lib/utils/uuid.ts).
    .refine((s) => !isUuid(s), "Slug must not look like a UUID"),
  name: z.string().optional(),
  description: z.string().optional(),
  // Creation offers the enumerated kinds (lib/sources/kinds.ts). PATCH stays
  // free-form for external writers (server-side classification).
  device_type: z
    .string()
    .optional()
    .refine(
      (v) => !v || SOURCE_KIND_IDS.includes(v),
      "Unknown device_type — see lib/sources/kinds.ts",
    ),
  connection_type: z.string().optional(),
  // Legacy: full connection URL (still accepted)
  connectionString: z.string().optional(),
  // Structured input: non-sensitive config fields + credentials separately
  connectionConfig: z.record(z.string(), z.unknown()).optional(),
  credentials: z.record(z.string(), z.unknown()).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  sshTunnel: SSHTunnelSchema.optional(),
  sshCredential: z.string().optional(),
});
export type CreateSource = z.infer<typeof CreateSourceSchema>;

// =============================================================================
// Dashboards
// =============================================================================

export const CreateDashboardSchema = z.object({
  name: z
    .string()
    .min(1, "Dashboard name is required")
    .transform((s) => s.trim()),
  description: z.string().optional(),
  icon: z.string().optional(),
  parent_id: z.string().uuid().optional(),
});
export type CreateDashboard = z.infer<typeof CreateDashboardSchema>;

/**
 * Grafana dashboard import (POST /api/dashboards/import/grafana).
 * `dashboard` is deliberately unvalidated JSON — the converter
 * (lib/import/grafana.ts) is total and reports malformed shapes instead of
 * rejecting them. Omitting `bindings` makes the request a dry run.
 */
export const GrafanaImportSchema = z.object({
  dashboard: z.unknown(),
  bindings: z
    .record(
      z.string(),
      z.object({
        sourceRef: z
          .string()
          .min(1)
          .regex(SLUG_PATTERN, SLUG_ERROR),
        metric: z.string().min(1),
      }),
    )
    .optional(),
  name: z.string().max(120).optional(),
});
export type GrafanaImport = z.infer<typeof GrafanaImportSchema>;

export const UpdateDashboardSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  icon: z.string().optional(),
  config: z
    .object({
      panels: z.array(z.unknown()),
      timeRange: z.object({
        type: z.enum(["relative", "absolute"]),
        value: z.string(),
      }),
    })
    .optional(),
});
export type UpdateDashboard = z.infer<typeof UpdateDashboardSchema>;

// =============================================================================
// Alerts
// =============================================================================

export const CreateAlertSchema = z.object({
  source_id: z.string().optional(),
  trigger_type: z.enum(["limit_violation"]),
  metric: z.string().min(1, "metric is required"),
  value: z.unknown(),
  threshold: z.number().optional(),
  bound: z.enum(["min", "max"]).optional(),
  severity: z.enum(["info", "warning", "critical"]).default("warning"),
  limit_id: z.string().uuid().optional(),
  alert_stats: z.array(z.unknown()).optional(),
  context_snapshot: z.record(z.string(), z.unknown()).optional(),
});
export type CreateAlert = z.infer<typeof CreateAlertSchema>;

// =============================================================================
// API Keys
// =============================================================================

export const CreateApiKeySchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .transform((s) => s.trim()),
  scopes: z.array(z.string()).optional(),
  expires_at: z.string().datetime().optional(),
});
export type CreateApiKey = z.infer<typeof CreateApiKeySchema>;

// =============================================================================
// Webhooks
// =============================================================================

const WebhookEventTypeSchema = z.enum([
  "alert.triggered",
  "alert.resolved",
  "alert.acknowledged",
  "device.online",
  "device.offline",
  "threshold.warning",
  "threshold.critical",
]);

export const CreateWebhookSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .transform((s) => s.trim()),
  description: z.string().optional(),
  url: z.string().url("Invalid URL format"),
  events: z
    .array(WebhookEventTypeSchema)
    .min(1, "At least one event type is required"),
  sourceFilter: z.string().optional(),
  customHeaders: z.record(z.string(), z.string()).optional(),
});
export type CreateWebhook = z.infer<typeof CreateWebhookSchema>;

// =============================================================================
// Sources - Update
// =============================================================================

export const UpdateSourceSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  status: z.string().optional(),
  device_type: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateSource = z.infer<typeof UpdateSourceSchema>;

// =============================================================================
// Monitors
// =============================================================================

export const CreateMonitorSchema = z
  .object({
    source_id: z.string().min(1, "source_id is required"),
    metric: z.string().min(1).optional(),
    // Explicit notification targets (slack/email/webhook integration ids) for
    // the created monitor. Omitted/null = default fan-out to every integration
    // subscribed to the event type.
    notification_targets: z
      .array(z.string().uuid())
      .min(1)
      .nullable()
      .optional(),
    threshold: z
      .object({
        min: z.number().nullable().optional(),
        max: z.number().nullable().optional(),
        severity: z.enum(["info", "warning", "critical"]).default("warning"),
        message: z.string().nullable().optional(),
        // Connection sources: which table the metric column belongs to, so the
        // poll loop doesn't have to guess from the schema snapshot.
        table: z.string().min(1).optional(),
      })
      .nullable()
      .optional(),
    event: z
      .object({
        severity: z.enum(["info", "warning", "critical"]).default("info"),
        message: z.string().nullable().optional(),
        enabled: z.boolean().default(true),
        // Connection sources: which table the metric column belongs to, so the
        // poll loop doesn't have to guess from the schema snapshot.
        table: z.string().min(1).optional(),
        visualization: z
          .object({
            panel_type: z.string(),
            panel_config: z.record(z.string(), z.unknown()).default({}),
          })
          .nullable()
          .optional(),
      })
      .nullable()
      .optional(),
    offline: z
      .object({
        timeout_seconds: z.number().int().positive().default(300),
        severity: z.enum(["info", "warning", "critical"]).default("warning"),
        message: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
  })
  .refine((data) => data.threshold || data.event || data.offline, {
    message: "At least one of threshold, event, or offline must be provided",
  })
  .refine((data) => !(data.threshold || data.event) || !!data.metric, {
    message: "metric is required for a threshold or event monitor",
  });
export type CreateMonitor = z.infer<typeof CreateMonitorSchema>;

/**
 * PATCH /api/monitors — update a monitor's notification targets in place.
 * Metric monitors are addressed by (source_id, metric); offline monitors by
 * their alert_rules row id. null clears explicit targets (default fan-out).
 */
export const UpdateMonitorTargetsSchema = z
  .object({
    source_id: z.string().min(1).optional(),
    metric: z.string().min(1).optional(),
    offline_id: z.string().uuid().optional(),
    notification_targets: z.array(z.string().uuid()).min(1).nullable(),
  })
  .refine((data) => data.offline_id || (data.source_id && data.metric), {
    message: "Provide offline_id, or source_id and metric",
  });
export type UpdateMonitorTargets = z.infer<typeof UpdateMonitorTargetsSchema>;

// =============================================================================
// Annotations
// =============================================================================

export const CreateAnnotationSchema = z.object({
  source_id: z.string().min(1, "source_id is required"),
  timestamp_start: z.string().min(1, "timestamp_start is required"),
  timestamp_end: z.string().nullable().optional(),
  label: z.string().min(1, "label is required").max(500),
  color: z
    .enum(["amber", "blue", "green", "red", "purple", "gray"])
    .default("amber"),
  notes: z.string().max(2000).nullable().optional(),
  metric_name: z.string().nullable().optional(),
  run_id: z.string().uuid().nullable().optional(),
});
export type CreateAnnotation = z.infer<typeof CreateAnnotationSchema>;

export const UpdateAnnotationSchema = z.object({
  label: z.string().min(1).max(500).optional(),
  color: z.enum(["amber", "blue", "green", "red", "purple", "gray"]).optional(),
  notes: z.string().max(2000).nullable().optional(),
  timestamp_start: z.string().optional(),
  timestamp_end: z.string().nullable().optional(),
});
export type UpdateAnnotation = z.infer<typeof UpdateAnnotationSchema>;

// =============================================================================
// Batch Query
// =============================================================================

const BatchQueryItemSchema = z.object({
  id: z.string(),
  metrics: z.array(z.string()).min(1),
  timeRange: z.string(),
  sourceId: z.string().optional(),
});

export const BatchQuerySchema = z.object({
  queries: z.array(BatchQueryItemSchema).min(1).max(50),
});
export type BatchQuery = z.infer<typeof BatchQuerySchema>;

// =============================================================================
// Import
// =============================================================================

export const ImportPreviewSchema = z.object({
  columnMapping: z.object({
    timestamp: z.string().min(1),
    metric: z.string().optional(),
    value: z.string().min(1),
    source_id: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }),
  staticSourceId: z.string().optional(),
  staticMetric: z.string().optional(),
});
export type ImportPreview = z.infer<typeof ImportPreviewSchema>;

// =============================================================================
// Runs (UI-created)
// =============================================================================

const PassCriterionSchema = z.object({
  metric: z.string().min(1),
  operator: z.enum([">", ">=", "<", "<=", "=", "!="]),
  value: z.number(),
  label: z.string().optional(),
});

export const UpdateRunCriteriaSchema = z.object({
  pass_criteria: z.array(PassCriterionSchema),
});
export type UpdateRunCriteria = z.infer<typeof UpdateRunCriteriaSchema>;

export const CreateRunSchema = z.object({
  name: z.string().min(1, "name is required").max(200),
  // Accepts a source slug or UUID; resolved via resolveRef at the route.
  source_id: z.string().min(1).nullable().optional(),
  status: z.enum(["active", "completed", "aborted"]).default("active"),
  started_at: z.string().datetime({ offset: true }).optional(),
  ended_at: z.string().datetime({ offset: true }).nullable().optional(),
  tags: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  pass_criteria: z.array(PassCriterionSchema).default([]),
});
export type CreateRun = z.infer<typeof CreateRunSchema>;

export const UpdateRunSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  status: z.enum(["active", "completed", "aborted"]).optional(),
  started_at: z.string().datetime({ offset: true }).optional(),
  ended_at: z.string().datetime({ offset: true }).nullable().optional(),
  tags: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  pass_criteria: z.array(PassCriterionSchema).optional(),
});
export type UpdateRun = z.infer<typeof UpdateRunSchema>;

// =============================================================================
// Data Management
// =============================================================================

export const DeleteDataSchema = z.object({
  sourceIds: z.array(z.string().min(1)).min(1, "At least one device required"),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
});

export const DeleteAccountSchema = z.object({
  // Typed confirmation string — the UI requires the user to type it verbatim.
  confirm: z.literal("delete my account"),
  // Explicit acknowledgment of each sole-member org that will be purged.
  deleteOrgIds: z.array(z.string().min(1)).default([]),
});

export const InternalOrgDeleteSchema = z.object({
  // Must equal the org's name (or id when unnamed) — the route re-checks;
  // can't be z.literal since the expected value is per-org.
  confirm: z.string().min(1),
  // Also delete member accounts whose only membership is this org.
  deleteUsers: z.boolean().default(false),
});

// =============================================================================
// Alert Rules (alert-service integration)
// =============================================================================

const SubRuleSchema = z.object({
  type: z.enum(["threshold", "outlier"]),
  metric: z.string().min(1),
  conditions: z.object({
    min: z.number().optional(),
    max: z.number().optional(),
    z_score: z.number().positive().optional(),
    min_samples: z.number().int().min(1).optional(),
  }),
});

export const CreateAlertRuleSchema = z
  .object({
    source_id: z.string().uuid("source_id must be a UUID"),
    type: z.enum(["threshold", "outlier", "compound"]),
    metric: z.string().min(1).optional(),
    conditions: z
      .object({
        min: z.number().optional(),
        max: z.number().optional(),
        z_score: z.number().positive().optional(),
        min_samples: z.number().int().min(1).optional(),
      })
      .optional(),
    operator: z.enum(["and", "or"]).optional(),
    sub_rules: z.array(SubRuleSchema).min(1).max(20).optional(),
    hysteresis_seconds: z.number().int().min(0).optional(),
    cooldown_seconds: z.number().int().min(0).optional(),
    severity: z.enum(["critical", "warning", "info"]).default("warning"),
    enabled: z.boolean().default(true),
  })
  .superRefine((data, ctx) => {
    if (data.type === "threshold") {
      if (!data.metric) {
        ctx.addIssue({
          code: "custom",
          message: "metric is required for threshold rules",
          path: ["metric"],
        });
      }
      if (
        !data.conditions?.min &&
        data.conditions?.min !== 0 &&
        !data.conditions?.max &&
        data.conditions?.max !== 0
      ) {
        ctx.addIssue({
          code: "custom",
          message:
            "at least one of conditions.min or conditions.max is required",
          path: ["conditions"],
        });
      }
      if (data.operator) {
        ctx.addIssue({
          code: "custom",
          message: "operator is not allowed for threshold rules",
          path: ["operator"],
        });
      }
      if (data.sub_rules) {
        ctx.addIssue({
          code: "custom",
          message: "sub_rules is not allowed for threshold rules",
          path: ["sub_rules"],
        });
      }
    } else if (data.type === "outlier") {
      if (!data.metric) {
        ctx.addIssue({
          code: "custom",
          message: "metric is required for outlier rules",
          path: ["metric"],
        });
      }
      if (data.operator) {
        ctx.addIssue({
          code: "custom",
          message: "operator is not allowed for outlier rules",
          path: ["operator"],
        });
      }
      if (data.sub_rules) {
        ctx.addIssue({
          code: "custom",
          message: "sub_rules is not allowed for outlier rules",
          path: ["sub_rules"],
        });
      }
    } else if (data.type === "compound") {
      if (!data.operator) {
        ctx.addIssue({
          code: "custom",
          message: "operator is required for compound rules",
          path: ["operator"],
        });
      }
      if (!data.sub_rules || data.sub_rules.length === 0) {
        ctx.addIssue({
          code: "custom",
          message: "sub_rules is required for compound rules (1-20 entries)",
          path: ["sub_rules"],
        });
      }
      if (data.metric) {
        ctx.addIssue({
          code: "custom",
          message:
            "metric is not allowed for compound rules (set on sub_rules)",
          path: ["metric"],
        });
      }
      if (data.conditions && Object.keys(data.conditions).length > 0) {
        ctx.addIssue({
          code: "custom",
          message:
            "conditions is not allowed for compound rules (set on sub_rules)",
          path: ["conditions"],
        });
      }
    }
  });
export type CreateAlertRule = z.infer<typeof CreateAlertRuleSchema>;

export const UpdateAlertRuleSchema = z.object({
  type: z.enum(["threshold", "outlier", "compound"]).optional(),
  metric: z.string().min(1).optional().nullable(),
  conditions: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
      z_score: z.number().positive().optional(),
      min_samples: z.number().int().min(1).optional(),
    })
    .optional(),
  operator: z.enum(["and", "or"]).optional().nullable(),
  sub_rules: z.array(SubRuleSchema).min(1).max(20).optional().nullable(),
  hysteresis_seconds: z.number().int().min(0).optional().nullable(),
  cooldown_seconds: z.number().int().min(0).optional().nullable(),
  severity: z.enum(["critical", "warning", "info"]).optional(),
  enabled: z.boolean().optional(),
});

// =============================================================================
// Column metadata (annotations authored on the Data tab → better inference)
// =============================================================================

export const ColumnSemanticTypeSchema = z.enum([
  "identifier",
  "category",
  "measurement",
  "status",
  "location",
  "timestamp",
  "text",
  "boolean",
]);
export const ColumnMlRoleSchema = z.enum([
  "feature",
  "target",
  "identifier",
  "ignore",
]);
export const ColumnAggregationSchema = z.enum([
  "avg",
  "sum",
  "min",
  "max",
  "last",
  "none",
]);
export const ColumnSensitivitySchema = z.enum(["none", "pii", "sensitive"]);

/** Single-column annotation patch (column_key comes from the URL param). */
export const UpsertColumnMetadataSchema = z
  .object({
    label: z.string().max(200).nullish(),
    description: z.string().max(2000).nullish(),
    unit: z.string().max(64).nullish(),
    semantic_type: ColumnSemanticTypeSchema.nullish(),
    ml_role: ColumnMlRoleSchema.nullish(),
    aggregation: ColumnAggregationSchema.nullish(),
    sensitivity: ColumnSensitivitySchema.optional(),
    expected_min: z.number().finite().nullish(),
    expected_max: z.number().finite().nullish(),
    categories: z.array(z.string().max(100)).max(200).optional(),
    tags: z.array(z.string().max(50)).max(100).optional(),
    source_origin: z.enum(["user", "ai", "ai_accepted"]).optional(),
  })
  .strict();
export type UpsertColumnMetadata = z.infer<typeof UpsertColumnMetadataSchema>;

// column_key is schema-derived text (e.g. "public.users.email"), not a slug.
const ColumnKeySchema = z.string().min(1).max(256);

/** Bulk upsert — used by "accept all AI suggestions". */
export const BulkUpsertColumnMetadataSchema = z.object({
  columns: z
    .array(
      UpsertColumnMetadataSchema.extend({ column_key: ColumnKeySchema })
    )
    .min(1)
    .max(500),
});
export type BulkUpsertColumnMetadata = z.infer<
  typeof BulkUpsertColumnMetadataSchema
>;

/** Request body for POST .../columns/suggest. */
export const SuggestColumnsSchema = z.object({
  columns: z
    .array(
      z.object({
        column_key: ColumnKeySchema,
        inferred_type: z.string().max(64),
        sample_values: z.array(z.unknown()).max(20).optional(),
        min: z.number().finite().nullish(),
        max: z.number().finite().nullish(),
      })
    )
    .min(1)
    .max(200),
});
export type SuggestColumns = z.infer<typeof SuggestColumnsSchema>;

/** Validates one AI-produced suggestion before it reaches the client. */
export const ColumnSuggestionSchema = z.object({
  column_key: ColumnKeySchema,
  label: z.string().max(200).optional(),
  unit: z.string().max(64).optional(),
  semantic_type: ColumnSemanticTypeSchema.optional(),
  ml_role: ColumnMlRoleSchema.optional(),
  aggregation: ColumnAggregationSchema.optional(),
  description: z.string().max(2000).optional(),
  confidence: z.number(),
});

// =============================================================================
// Access grants (RBAC)
// =============================================================================

const GrantKindSchema = z.enum(GRANT_KIND_VALUES);
const AccessLevelSchema = z.enum(["view", "edit"]);

export const AddGrantSchema = z.object({
  kind: GrantKindSchema,
  resourceId: z.string().min(1),
  accessLevel: AccessLevelSchema.optional(),
});
export type AddGrant = z.infer<typeof AddGrantSchema>;

export const UpdateGrantSchema = z.object({
  kind: GrantKindSchema,
  accessLevel: AccessLevelSchema,
});
export type UpdateGrant = z.infer<typeof UpdateGrantSchema>;

const ActionIdSchema = z.custom<ActionId>(
  (v) => typeof v === "string" && (ACTION_IDS as readonly string[]).includes(v),
  "Unknown action id",
);

/** Replace a team's capability set (group Permissions). Manifest actions only. */
export const SetCapabilitiesSchema = z.object({
  actionIds: z.array(ActionIdSchema),
});
export type SetCapabilities = z.infer<typeof SetCapabilitiesSchema>;

// =============================================================================
// Access overrides (RBAC Role Matrix)
// =============================================================================

/**
 * One Role Matrix edit. Exactly one of:
 *   - reset: true            → delete the override (revert to manifest default)
 *   - requiredRole: <role>   → set the minimum role
 *   - requiredRole: null     → make the action available to all roles
 */
export const AccessOverridePatchSchema = z
  .object({
    actionId: ActionIdSchema,
    requiredRole: z
      .enum(["org:viewer", "org:editor", "org:admin"])
      .nullable()
      .optional(),
    reset: z.boolean().optional(),
  })
  .refine((b) => b.reset === true || b.requiredRole !== undefined, {
    message: "Provide requiredRole (role or null) or reset: true",
  });
export type AccessOverridePatch = z.infer<typeof AccessOverridePatchSchema>;
