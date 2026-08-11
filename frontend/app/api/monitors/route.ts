/**
 * GET    /api/monitors — List all monitors (grouped limits + event monitors by source_id + metric)
 * POST   /api/monitors — Create a monitor (writes to source_limits and/or event_monitors)
 * DELETE  /api/monitors?source_id=X&metric=Y — Delete a monitor from all tables
 *
 * SOURCE IDENTITY CONTRACT (the one authoritative statement — see also
 * docs/STANDARDS.md "Source identity"):
 * - Inbound `source_id` may be a slug or uuid; it is resolved exactly once via
 *   adminSourceQueries.resolveRef at the top of each handler.
 * - Writes: thresholds → `source_limits` (uuid FK) AND `alert_rules` (SLUG —
 *   the alert-service/gateway wire convention); event monitors →
 *   `event_monitors` (uuid FK); offline monitors → `alert_rules` type=offline
 *   (slug).
 * - Payloads carry `source_id` (uuid) plus `source_slug`/`source_name`.
 */

import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { withDualAuth, requirePermission } from "@/lib/api/with-auth";
import {
  sourceLimitQueries,
  eventMonitorQueries,
  alertRuleQueries,
  sourceQueries,
  runWithServiceRole,
} from "@/lib/db";
import { db } from "@/lib/db/client";
import {
  sources,
  sources as sourcesTable,
  sourceLimits,
  slackIntegrations,
  emailIntegrations,
  webhooks,
} from "@/lib/db/schema";
import {
  adminSourceLimitQueries,
  adminEventMonitorQueries,
  adminAlertRuleQueries,
  adminSourceQueries,
} from "@/lib/db/server";
import {
  CreateMonitorSchema,
  UpdateMonitorTargetsSchema,
} from "@/lib/validation/api-schemas";
import {
  loadAllowedSourceIds,
  filterAccessibleSlugs,
} from "@/lib/access/sources";
import { pushOrgRulesToAlertService } from "@/lib/alerts/push-rules-to-alert-service";
import { detectTimeColumn } from "@/lib/dashboard/column-roles";
import type { SchemaInfo } from "@/lib/db/drivers/types";

/**
 * Explicit notification targets must be this org's integrations (slack, email,
 * or webhook). Disabled integrations are accepted (they may be re-enabled
 * later); delivery skips them at send time. Returns an error response to
 * short-circuit with, or null when the targets are valid.
 */
/**
 * Scoped members can only manage monitors on sources in their allow-list.
 * Returns a 404 response to short-circuit with, or null when in scope.
 */
async function monitorScopeError(
  ctx: {
    orgId: string;
    userId?: string | null;
    isApiKeyAuth?: boolean;
  },
  sourceUuid: string,
): Promise<NextResponse | null> {
  if (ctx.isApiKeyAuth || !ctx.userId) return null;
  const allowed = await loadAllowedSourceIds(ctx.orgId, ctx.userId);
  if (allowed && !allowed.has(sourceUuid)) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }
  return null;
}

/**
 * Same guard for offline monitors addressed by alert_rules row id — the rule
 * stores a source SLUG, so bridge through filterAccessibleSlugs.
 */
async function offlineRuleScopeError(
  ctx: {
    orgId: string;
    userId?: string | null;
    orgRole?: string;
    isApiKeyAuth?: boolean;
  },
  ruleId: string,
): Promise<NextResponse | null> {
  if (ctx.isApiKeyAuth || !ctx.userId) return null;
  const slug = await adminAlertRuleQueries.findSourceSlugById(
    ctx.orgId,
    ruleId,
  );
  if (!slug) return null; // missing rule → downstream 404 handles it
  const ok = await filterAccessibleSlugs(
    {
      orgId: ctx.orgId,
      userId: ctx.userId,
      orgRole: ctx.orgRole,
      isApiKeyAuth: ctx.isApiKeyAuth ?? false,
    },
    [slug],
  );
  if (!ok.has(slug)) {
    return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
  }
  return null;
}

async function validateTargetOwnership(
  orgId: string,
  targetIds: string[] | null,
): Promise<NextResponse | null> {
  if (!targetIds) return null;
  const [slackIds, emailIds, webhookIds] = await Promise.all([
    db
      .select({ id: slackIntegrations.id })
      .from(slackIntegrations)
      .where(
        and(
          eq(slackIntegrations.org_id, orgId),
          inArray(slackIntegrations.id, targetIds),
        ),
      ),
    db
      .select({ id: emailIntegrations.id })
      .from(emailIntegrations)
      .where(
        and(
          eq(emailIntegrations.org_id, orgId),
          inArray(emailIntegrations.id, targetIds),
        ),
      ),
    db
      .select({ id: webhooks.id })
      .from(webhooks)
      .where(and(eq(webhooks.org_id, orgId), inArray(webhooks.id, targetIds))),
  ]);
  const known = new Set(
    [...slackIds, ...emailIds, ...webhookIds].map((r) => r.id),
  );
  const unknown = targetIds.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    return NextResponse.json(
      {
        error: "Unknown notification target(s) for this org",
        unknown_target_ids: unknown,
      },
      { status: 422 },
    );
  }
  return null;
}

/** UI-facing poll health for a monitor row. */
interface MonitorHealth {
  state: "working" | "skipped" | "failing" | "pending";
  reason: string | null;
  checked_at: string | null;
}

/**
 * Turn the raw last-poll outcome into a UI state. An unpinned connection
 * monitor that hasn't been evaluated yet is reported as skipped up front (the
 * poller will skip it every tick), rather than a misleading "pending".
 */
function deriveHealth(
  h: { status: string | null; error: string | null; at: string | null },
  unpinned: boolean,
): MonitorHealth {
  switch (h.status) {
    case "error":
      return { state: "failing", reason: h.error, checked_at: h.at };
    case "skipped":
      return { state: "skipped", reason: h.error, checked_at: h.at };
    case "ok":
      return { state: "working", reason: null, checked_at: h.at };
    default:
      if (unpinned) {
        return {
          state: "skipped",
          reason: "Not scanning — the metric isn't pinned to a table",
          checked_at: null,
        };
      }
      return { state: "pending", reason: null, checked_at: null };
  }
}

/** The single snapshot table containing the column, or undefined if 0/many. */
function uniqueTableWithColumn(
  snapshot: SchemaInfo | undefined,
  column: string,
): SchemaInfo["tables"][number] | undefined {
  const matches =
    snapshot?.tables?.filter((t) =>
      t.columns.some((c) => c.name === column),
    ) ?? [];
  return matches.length === 1 ? matches[0] : undefined;
}

export const GET = withDualAuth(async (_req, { orgId, userId, isApiKeyAuth }) => {
  let limits: Array<{
    id: string;
    org_id: string;
    source_id: string;
    metric: string;
    min: number | null;
    max: number | null;
    severity: string;
    message: string | null;
    created_at: string;
    table_name?: string | null;
    time_column?: string | null;
    last_status?: string | null;
    last_error?: string | null;
    last_evaluated_at?: string | null;
    sources?: { slug: string; name: string | null };
  }> = [];
  try {
    if (isApiKeyAuth) {
      limits = await adminSourceLimitQueries.findByOrg(orgId);
    } else {
      const rows = await db
        .select({
          id: sourceLimits.id,
          org_id: sourceLimits.org_id,
          source_id: sourceLimits.source_id,
          metric: sourceLimits.metric,
          min: sourceLimits.min,
          max: sourceLimits.max,
          severity: sourceLimits.severity,
          message: sourceLimits.message,
          created_at: sourceLimits.created_at,
          table_name: sourceLimits.table_name,
          time_column: sourceLimits.time_column,
          last_status: sourceLimits.last_status,
          last_error: sourceLimits.last_error,
          last_evaluated_at: sourceLimits.last_evaluated_at,
          slug: sources.slug,
          name: sources.name,
        })
        .from(sourceLimits)
        .innerJoin(sources, eq(sourceLimits.source_id, sources.id))
        .where(eq(sourceLimits.org_id, orgId))
        .orderBy(desc(sourceLimits.created_at));
      limits = rows.map((r) => ({
        id: r.id,
        org_id: r.org_id,
        source_id: r.source_id,
        metric: r.metric,
        min: r.min,
        max: r.max,
        severity: r.severity,
        message: r.message,
        created_at: r.created_at,
        table_name: r.table_name,
        time_column: r.time_column,
        last_status: r.last_status,
        last_error: r.last_error,
        last_evaluated_at: r.last_evaluated_at,
        sources: { slug: r.slug, name: r.name },
      })) as typeof limits;
    }
  } catch (err) {
    console.error("Failed to fetch limits:", err);
  }

  let eventMonitors: Awaited<ReturnType<typeof eventMonitorQueries.findByOrg>> =
    [];
  try {
    eventMonitors = isApiKeyAuth
      ? await adminEventMonitorQueries.findByOrg(orgId)
      : await eventMonitorQueries.findByOrg(orgId);
  } catch (err) {
    console.error("Failed to fetch event monitors:", err);
  }

  // Scope: external/guest users see only monitors for their allow-listed sources.
  if (!isApiKeyAuth && userId) {
    const allowed = await loadAllowedSourceIds(orgId, userId);
    if (allowed) {
      limits = limits.filter((l) => allowed.has(l.source_id));
      eventMonitors = eventMonitors.filter((e) => allowed.has(e.source_id));
    }
  }

  const allSourceIds = new Set([
    ...eventMonitors.map((e) => e.source_id),
    ...limits.map((l) => l.source_id),
  ]);
  const sourceNames: Record<string, string> = {};
  const sourceSlugs: Record<string, string> = {};
  const sourceTypes: Record<string, string> = {};
  if (allSourceIds.size > 0) {
    let sources:
      | Array<{ id: string; slug: string; name: string | null; source_type: string }>
      | null = null;
    if (isApiKeyAuth) {
      const resolved = await runWithServiceRole(() =>
        sourceQueries.findByIds(orgId, [...allSourceIds]),
      );
      sources = resolved.map((s) => ({
        id: s.id,
        slug: s.slug,
        name: s.name,
        source_type: s.source_type as string,
      }));
    } else {
      const data = await db
        .select({
          id: sourcesTable.id,
          slug: sourcesTable.slug,
          name: sourcesTable.name,
          source_type: sourcesTable.source_type,
        })
        .from(sourcesTable)
        .where(
          and(
            eq(sourcesTable.org_id, orgId),
            inArray(sourcesTable.id, [...allSourceIds]),
          ),
        );
      sources = data;
    }
    if (sources) {
      for (const s of sources) {
        sourceNames[s.id] = s.name || s.slug;
        sourceSlugs[s.id] = s.slug;
        sourceTypes[s.id] = s.source_type;
      }
    }
  }

  for (const l of (limits || []) as Array<Record<string, unknown>>) {
    const src = l.sources as Record<string, string> | undefined;
    if (src && l.source_id) {
      sourceNames[l.source_id as string] = src.name || src.slug;
      sourceSlugs[l.source_id as string] = src.slug;
    }
  }

  const monitorMap = new Map<
    string,
    {
      source_id: string;
      source_slug: string;
      source_name: string;
      metric: string;
      threshold: {
        id: string;
        min?: number | null;
        max?: number | null;
        severity: string;
        message?: string | null;
        notification_target_ids?: string[] | null;
      } | null;
      event: {
        id: string;
        severity: string;
        message: string | null;
        enabled: boolean;
        visualization: {
          panel_type: string;
          panel_config: Record<string, unknown>;
        } | null;
        notification_target_ids: string[] | null;
        context_columns: string[] | null;
        filters: unknown;
        delivery: string | null;
        time_column: string | null;
      } | null;
      /** Connection monitor missing table/time-column — the poller skips it. */
      unpinned: boolean;
      /** Worst poll outcome across this monitor's records (see mergeHealth). */
      _health: {
        status: string | null;
        error: string | null;
        at: string | null;
      };
      created_at: string;
    }
  >();

  // A connection monitor without a pinned (table, time column) is skipped by
  // the poll loop on every tick — surface that instead of hiding it.
  const isUnpinned = (
    sourceId: string,
    tableName?: string | null,
    timeColumn?: string | null,
  ): boolean =>
    sourceTypes[sourceId] === "connection" && !(tableName && timeColumn);

  // Keep the more alarming of two poll outcomes when a (source, metric) has
  // both a threshold and an event record: error > skipped > ok > unknown.
  const HEALTH_RANK: Record<string, number> = { error: 4, skipped: 3, ok: 2 };
  const mergeHealth = (
    cur: { status: string | null; error: string | null; at: string | null },
    next: {
      status?: string | null;
      error?: string | null;
      at?: string | null;
    },
  ) => {
    const nextStatus = next.status ?? null;
    if ((HEALTH_RANK[nextStatus ?? ""] ?? 1) >= (HEALTH_RANK[cur.status ?? ""] ?? 1)) {
      return {
        status: nextStatus,
        error: next.error ?? null,
        at: next.at ?? null,
      };
    }
    return cur;
  };

  // Threshold routing targets live on the alert_rules threshold row (keyed by
  // slug), not on source_limits — resolve them per (slug, metric).
  const thresholdTargets = new Map<string, string[] | null>();
  try {
    for (const t of await adminAlertRuleQueries.findThresholdTargetsByOrg(
      orgId,
    )) {
      if (t.metric) {
        thresholdTargets.set(
          `${t.source_id}::${t.metric}`,
          t.notification_target_ids,
        );
      }
    }
  } catch (err) {
    console.error("Failed to fetch threshold targets:", err);
  }

  for (const l of (limits || []) as Array<Record<string, unknown>>) {
    const key = `${l.source_id}::${l.metric}`;
    const src = l.sources as Record<string, string> | undefined;
    const slug = src?.slug || sourceSlugs[l.source_id as string] || "";
    monitorMap.set(key, {
      source_id: l.source_id as string,
      source_slug: slug,
      source_name: src?.name || src?.slug || String(l.source_id),
      metric: l.metric as string,
      threshold: {
        id: l.id as string,
        min: l.min as number | null,
        max: l.max as number | null,
        severity: (l.severity as string) || "warning",
        message: l.message as string | null,
        notification_target_ids:
          thresholdTargets.get(`${slug}::${l.metric}`) ?? null,
      },
      event: null,
      unpinned: isUnpinned(
        l.source_id as string,
        l.table_name as string | null | undefined,
        l.time_column as string | null | undefined,
      ),
      _health: {
        status: (l.last_status as string | null) ?? null,
        error: (l.last_error as string | null) ?? null,
        at: (l.last_evaluated_at as string | null) ?? null,
      },
      created_at: l.created_at as string,
    });
  }

  for (const e of eventMonitors) {
    const key = `${e.source_id}::${e.metric}`;
    const existing = monitorMap.get(key);
    const eventUnpinned = isUnpinned(e.source_id, e.table_name, e.time_column);
    if (existing) {
      existing.event = {
        id: e.id,
        severity: e.severity,
        message: e.message,
        enabled: e.enabled,
        visualization: e.visualization,
        notification_target_ids: e.notification_target_ids,
        context_columns: e.context_columns,
        filters: e.filters,
        delivery: e.delivery,
        time_column: e.time_column,
      };
      existing.unpinned = existing.unpinned || eventUnpinned;
      existing._health = mergeHealth(existing._health, {
        status: e.last_status,
        error: e.last_error,
        at: e.last_evaluated_at,
      });
      if (new Date(e.created_at) < new Date(existing.created_at)) {
        existing.created_at = e.created_at;
      }
    } else {
      monitorMap.set(key, {
        source_id: e.source_id,
        source_slug: sourceSlugs[e.source_id] || "",
        source_name: sourceNames[e.source_id] || e.source_id,
        metric: e.metric,
        threshold: null,
        event: {
          id: e.id,
          severity: e.severity,
          message: e.message,
          enabled: e.enabled,
          visualization: e.visualization,
          notification_target_ids: e.notification_target_ids,
          context_columns: e.context_columns,
          filters: e.filters,
          delivery: e.delivery,
          time_column: e.time_column,
        },
        unpinned: eventUnpinned,
        _health: {
          status: e.last_status ?? null,
          error: e.last_error ?? null,
          at: e.last_evaluated_at ?? null,
        },
        created_at: e.created_at,
      });
    }
  }

  const monitors = [...monitorMap.values()].map((m) => {
    const hasThreshold = !!m.threshold;
    const hasEvent = !!m.event;

    let type: string;
    if (hasThreshold && hasEvent) {
      type = "both";
    } else if (hasThreshold) {
      type = "threshold";
    } else {
      type = "event";
    }

    const { _health, ...rest } = m;
    return {
      ...rest,
      type,
      health: deriveHealth(_health, m.unpinned) as MonitorHealth | null,
      offline: null as {
        id: string;
        timeout_seconds: number;
        severity: string;
        enabled: boolean;
        notification_target_ids?: string[] | null;
      } | null,
    };
  });

  // Offline ("stream stopped") monitors — metric-less, source-level. Live in
  // alert_rules (type "offline"), not the metric tables above.
  try {
    const offlineRules = await adminAlertRuleQueries.findOfflineByOrgWithSlug(orgId);
    for (const o of offlineRules) {
      monitors.push({
        source_id: o.source_id,
        source_slug: o.slug,
        source_name: o.name || o.slug,
        metric: "",
        threshold: null,
        event: null,
        unpinned: false,
        // Offline monitors are evaluated by the separate offline loop, not the
        // poll loop that records health here.
        health: null as MonitorHealth | null,
        offline: {
          id: o.id,
          timeout_seconds: o.timeout_seconds,
          severity: o.severity,
          enabled: o.enabled,
          notification_target_ids: o.notification_target_ids,
        },
        type: "offline",
        created_at: o.created_at,
      });
    }
  } catch (err) {
    console.error("Failed to fetch offline monitors:", err);
  }

  monitors.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  return NextResponse.json({ monitors });
});

export const POST = withDualAuth(async (request, { orgId, userId, orgRole, isApiKeyAuth }) => {
  // Monitors are alert rules — share the alert capability.
  if (!isApiKeyAuth) {
    await requirePermission({ orgId, orgRole, userId }, "action-new-alert");
  }
  const body = await request.json();
  const parsed = CreateMonitorSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { source_id, metric, threshold, event, offline, notification_targets } =
    parsed.data;

  // One bridge for both source_id conventions: UUID tables use src.id, while
  // alert_rules stores src.slug (migration 00037). See resolveRef's doc.
  const src = await adminSourceQueries.resolveRef(orgId, source_id);
  if (!src) {
    return NextResponse.json(
      { error: `Source '${source_id}' not found in org` },
      { status: 404 },
    );
  }
  const scopeError = await monitorScopeError({ orgId, userId, isApiKeyAuth }, src.id);
  if (scopeError) return scopeError;
  const sourceUuid = src.id;

  // Three-state: string[] = set explicit targets, null = clear (default
  // fan-out), undefined = leave any existing targets untouched (so a
  // reconfigure through the create dialog can't silently wipe routing).
  const targetIds = notification_targets;
  const rejectedTargets = await validateTargetOwnership(orgId, targetIds ?? null);
  if (rejectedTargets) return rejectedTargets;

  // Connection sources are evaluated by the poll loop, which needs to know
  // which table/time column to scan. Pin them here when we can (from the
  // request or a unique schema-snapshot match); the poller backfills the
  // rest from the snapshot on its first tick.
  const pinPollTarget = (
    requestedTable: string | null | undefined,
    m: string,
    requestedTimeColumn?: string | null,
  ): { table_name: string | null; time_column: string | null } => {
    if (src.source_type !== "connection") {
      return { table_name: null, time_column: null };
    }
    let tableName: string | null = requestedTable ?? null;
    const snapshot = (src.config as Record<string, unknown> | null)
      ?.schemaSnapshot as SchemaInfo | undefined;
    const table = tableName
      ? snapshot?.tables?.find((t) => t.name === tableName)
      : uniqueTableWithColumn(snapshot, m);
    // An explicit cursor ("watch for new rows by") always wins over the guess.
    let timeColumn: string | null = requestedTimeColumn ?? null;
    if (table) {
      tableName ??= table.name;
      timeColumn ??= detectTimeColumn(table.columns) ?? null;
    }
    return { table_name: tableName, time_column: timeColumn };
  };

  // A connection monitor the poller can never resolve is worse than an error:
  // it saves fine, shows as active, and silently never fires. When the schema
  // snapshot proves the metric column is ambiguous (or absent) and no table
  // was specified, reject with the candidates instead of accepting dead config.
  const unpinnableError = (
    requestedTable: string | null | undefined,
    m: string,
  ): NextResponse | null => {
    if (src.source_type !== "connection" || requestedTable) return null;
    const snapshot = (src.config as Record<string, unknown> | null)
      ?.schemaSnapshot as SchemaInfo | undefined;
    if (!snapshot?.tables?.length) return null; // resolvable later via live fetch
    const matches = snapshot.tables.filter((t) =>
      t.columns.some((c) => c.name === m),
    );
    if (matches.length === 1) return null;
    return NextResponse.json(
      {
        error:
          matches.length === 0
            ? `Column '${m}' not found in any table of this connection's schema`
            : `Column '${m}' exists in ${matches.length} tables — specify which table to monitor`,
        candidate_tables: matches.map((t) => t.name),
      },
      { status: 422 },
    );
  };

  if (threshold) {
    const m = metric as string; // guaranteed by schema refine
    const rejected = unpinnableError(threshold.table, m);
    if (rejected) return rejected;
    const pinned = pinPollTarget(threshold.table, m);
    if (isApiKeyAuth) {
      await adminSourceLimitQueries.upsert(orgId, sourceUuid, m, {
        min: threshold.min ?? null,
        max: threshold.max ?? null,
        severity: threshold.severity,
        message: threshold.message ?? null,
        ...pinned,
      });
    } else {
      await sourceLimitQueries.upsert(orgId, sourceUuid, m, {
        min: threshold.min ?? null,
        max: threshold.max ?? null,
        severity: threshold.severity,
        message: threshold.message ?? null,
        ...pinned,
      });
    }

    await adminAlertRuleQueries.upsertThreshold(
      orgId,
      src.slug,
      m,
      { min: threshold.min ?? null, max: threshold.max ?? null },
      threshold.severity,
      targetIds,
    );
    pushOrgRulesToAlertService(orgId).catch((err) =>
      console.error("[monitors] failed to push rules to alert-service:", err),
    );
  }

  if (event) {
    const m = metric as string; // guaranteed by schema refine
    const rejected = unpinnableError(event.table, m);
    if (rejected) return rejected;
    const pinned = pinPollTarget(event.table, m, event.time_column ?? null);
    const contextColumns = event.context_columns ?? null;
    const filters = event.filters ?? null;

    // Every referenced column (cursor, context, filters) must exist on the
    // pinned table when the snapshot can prove it — a bad column would make
    // every poll tick error out.
    if (pinned.table_name) {
      const snapshot = (src.config as Record<string, unknown> | null)
        ?.schemaSnapshot as SchemaInfo | undefined;
      const table = snapshot?.tables?.find(
        (t) => t.name === pinned.table_name,
      );
      const referenced = [
        ...(event.time_column ? [event.time_column] : []),
        ...(contextColumns ?? []),
        ...(filters ?? []).map((f) => f.column),
      ];
      const unknown = table
        ? referenced.filter(
            (c) => !table.columns.some((col) => col.name === c),
          )
        : [];
      if (unknown.length > 0) {
        return NextResponse.json(
          {
            error: `Column(s) not found on table '${pinned.table_name}': ${[...new Set(unknown)].join(", ")}`,
          },
          { status: 422 },
        );
      }
    }

    const monitorConfig = {
      source_id: sourceUuid,
      metric: m,
      severity: event.severity,
      message: event.message ?? null,
      enabled: event.enabled,
      visualization: event.visualization ?? null,
      notification_target_ids: targetIds,
      context_columns: contextColumns,
      filters,
      delivery: event.delivery ?? null,
      ...pinned,
    };
    if (isApiKeyAuth) {
      await adminEventMonitorQueries.upsert(orgId, monitorConfig);
    } else {
      await eventMonitorQueries.upsert(orgId, monitorConfig);
    }
  }

  // Offline / "stream stopped" monitor: an alert_rules row of type "offline".
  // Evaluated by /api/internal/detect-offline (a periodic scan), NOT the
  // alert-service (a stream consumer can't detect absence), so don't push it.
  // NOTE: alert_rules.source_id is the source SLUG (migration 00037 dropped the
  // UUID FK) — store the slug, not the UUID, so the GET/detector can find it.
  if (offline) {
    await alertRuleQueries.create(orgId, {
      source_id: src.slug,
      type: "offline",
      metric: null,
      conditions: { timeout_seconds: offline.timeout_seconds },
      severity: offline.severity,
      enabled: true,
      notification_target_ids: targetIds,
    });
  }

  return NextResponse.json({ success: true }, { status: 201 });
});

export const PATCH = withDualAuth(async (request, { orgId, userId, orgRole, isApiKeyAuth }) => {
  // Reconfiguring a monitor shares the alert capability, mirroring POST.
  if (!isApiKeyAuth) {
    await requirePermission({ orgId, orgRole, userId }, "action-new-alert");
  }
  const body = await request.json();
  const parsed = UpdateMonitorTargetsSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { source_id, metric, offline_id, notification_targets } = parsed.data;

  const rejectedTargets = await validateTargetOwnership(
    orgId,
    notification_targets,
  );
  if (rejectedTargets) return rejectedTargets;

  // Offline monitors are addressed by their alert_rules row id directly (their
  // source_id is a slug that can be UUID-shaped — see DELETE).
  if (offline_id) {
    const ruleScopeError = await offlineRuleScopeError(
      { orgId, userId, orgRole, isApiKeyAuth },
      offline_id,
    );
    if (ruleScopeError) return ruleScopeError;
    const updated = await adminAlertRuleQueries.setTargetsById(
      orgId,
      offline_id,
      notification_targets,
    );
    if (updated === 0) {
      return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  }

  const src = await adminSourceQueries.resolveRef(orgId, source_id!);
  if (!src) {
    return NextResponse.json(
      { error: `Source '${source_id}' not found in org` },
      { status: 404 },
    );
  }
  const scopeError = await monitorScopeError({ orgId, userId, isApiKeyAuth }, src.id);
  if (scopeError) return scopeError;

  // A metric monitor may be an event monitor, a threshold rule, or both —
  // update whichever exist.
  const [eventUpdated, thresholdUpdated] = await Promise.all([
    adminEventMonitorQueries.setTargets(
      orgId,
      src.id,
      metric!,
      notification_targets,
    ),
    adminAlertRuleQueries.setThresholdTargets(
      orgId,
      src.slug,
      metric!,
      notification_targets,
    ),
  ]);

  if (eventUpdated === 0 && thresholdUpdated === 0) {
    return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
});

export const DELETE = withDualAuth(async (request, { orgId, userId, orgRole, isApiKeyAuth }) => {
  if (!isApiKeyAuth) {
    await requirePermission({ orgId, orgRole, userId }, "action-delete-alert");
  }
  const { searchParams } = new URL(request.url);
  const rawSourceId = searchParams.get("source_id");
  const rawMetric = searchParams.get("metric");
  const offlineId = searchParams.get("offline_id");

  // Metric-less (offline / "stream stopped") monitor → delete the alert_rule by
  // its own id. The offline source_id is a slug that can be UUID-shaped, which
  // makes resolveRef/slug matching unreliable; the rule id is unambiguous. Use
  // the admin client (mirrors the GET reader) — a session-client delete can
  // silently match 0 rows under RLS and falsely report success.
  if (offlineId) {
    const ruleScopeError = await offlineRuleScopeError(
      { orgId, userId, orgRole, isApiKeyAuth },
      offlineId,
    );
    if (ruleScopeError) return ruleScopeError;
    try {
      const deleted = await adminAlertRuleQueries.deleteById(orgId, offlineId);
      if (deleted === 0) {
        return NextResponse.json(
          { error: "Monitor not found" },
          { status: 404 },
        );
      }
    } catch (err) {
      console.error("[monitors] offline delete failed:", err);
      return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  }

  if (!rawSourceId) {
    return NextResponse.json(
      { error: "Missing 'source_id' query param" },
      { status: 400 },
    );
  }

  // One bridge for both source_id conventions (see resolveRef's doc).
  const src = await adminSourceQueries.resolveRef(orgId, rawSourceId);
  if (!src) {
    return NextResponse.json(
      { error: `Source '${rawSourceId}' not found in org` },
      { status: 404 },
    );
  }
  const scopeError = await monitorScopeError({ orgId, userId, isApiKeyAuth }, src.id);
  if (scopeError) return scopeError;
  const sourceId = src.id;

  // A metric-less monitor (metric === "") can live in more than one place: an
  // offline rule keyed by slug (older clients that don't send offline_id), or a
  // metric-less source_limit / event_monitor. Don't early-return on the offline
  // guess — that 404'd the request before the real (event/threshold) row was ever
  // touched. Remove any offline rule, then fall through to the metric-table
  // deletes below, which handle an empty metric.
  const metric = rawMetric ?? "";
  if (!metric) {
    try {
      await adminAlertRuleQueries.deleteOfflineBySlug(orgId, src.slug);
    } catch (err) {
      console.error("[monitors] offline slug delete failed:", err);
    }
  }

  try {
    if (isApiKeyAuth) {
      await adminSourceLimitQueries.delete(orgId, sourceId, metric);
    } else {
      await sourceLimitQueries.delete(orgId, sourceId, metric);
    }
  } catch {
    // May not exist in this table
  }

  try {
    if (isApiKeyAuth) {
      await adminEventMonitorQueries.delete(orgId, sourceId, metric);
    } else {
      await eventMonitorQueries.delete(orgId, sourceId, metric);
    }
  } catch {
    // May not exist in this table
  }

  try {
    await adminAlertRuleQueries.deleteBySourceAndMetric(orgId, src.slug, metric);
    pushOrgRulesToAlertService(orgId).catch((err) =>
      console.error("[monitors] failed to push rules to alert-service:", err),
    );
  } catch {
    // May not exist
  }

  return NextResponse.json({ success: true });
});
