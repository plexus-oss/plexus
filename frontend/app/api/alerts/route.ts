/**
 * Alerts API - List and Create
 *
 * GET /api/alerts - List all alerts with optional filters
 * POST /api/alerts - Create a new alert (typically from limit violation)
 *
 * Authentication: Session auth or API key (x-api-key header)
 */

import { NextRequest, NextResponse } from "next/server";
import { withDualAuth, requirePermission } from "@/lib/api/with-auth";
import { isUuid, findSourceByRef } from "@/lib/api/find-source";
import { apiError } from "@/lib/api/errors";
import {
  alertQueries,
  alertEventQueries,
  sourceQueries,
  runWithServiceRole,
} from "@/lib/db";
import {
  adminAlertQueries,
  adminAlertEventQueries,
  adminSourceQueries,
} from "@/lib/db/server";
import { CreateAlertSchema } from "@/lib/validation/api-schemas";
import { loadAllowedSourceIds } from "@/lib/access/sources";
import type {
  AlertStatus,
  AlertTriggerType,
  LimitSeverity,
  Json,
} from "@/lib/db/types";

// GET /api/alerts
export const GET = withDualAuth(
  async (request: NextRequest, { orgId, userId, isApiKeyAuth }) => {
    const searchParams = request.nextUrl.searchParams;
    const statusParam = searchParams.get("status");
    const severityParam = searchParams.get("severity");
    const sourceIdParam = searchParams.get("sourceId");
    const rawSourceIds: string[] | undefined = sourceIdParam
      ? sourceIdParam.includes(",")
        ? sourceIdParam.split(",").filter(Boolean)
        : [sourceIdParam]
      : undefined;

    // Dashboards pass a mix of UUIDs and slugs depending on how the panel was
    // configured. alerts.source_id is always a UUID, so resolve any slugs before
    // filtering — otherwise the overlay silently returns zero alerts.
    let sourceId: string | string[] | undefined;
    if (rawSourceIds && rawSourceIds.length > 0) {
      const uuids: string[] = [];
      const slugs: string[] = [];
      for (const id of rawSourceIds) {
        if (isUuid(id)) uuids.push(id);
        else slugs.push(id);
      }
      for (const slug of slugs) {
        const resolved = await findSourceByRef(orgId, slug, isApiKeyAuth);
        if (resolved?.id) uuids.push(resolved.id);
      }
      sourceId =
        uuids.length === 1 ? uuids[0] : uuids.length > 1 ? uuids : undefined;
    }
    const triggerType = searchParams.get(
      "triggerType",
    ) as AlertTriggerType | null;
    const limit = searchParams.get("limit");
    const offset = searchParams.get("offset");

    // Parse status filter (can be comma-separated)
    let status: AlertStatus[] | undefined;
    if (statusParam) {
      status = statusParam.split(",") as AlertStatus[];
    }

    // Parse severity filter (can be comma-separated)
    let severity: LimitSeverity[] | undefined;
    if (severityParam) {
      severity = severityParam.split(",") as LimitSeverity[];
    }

    // API key auth uses admin queries (service role) because there's no user
    // session behind the request. Session auth uses the feature factory, which
    // allows org-specific overrides (e.g., external alerts API) to be resolved.
    let alerts;
    let counts;

    if (isApiKeyAuth) {
      alerts = await adminAlertQueries.findAll(orgId, {
        status,
        severity,
        sourceId,
        triggerType: triggerType || undefined,
        limit: Math.min(limit ? parseInt(limit, 10) : 200, 1000),
        offset: offset ? parseInt(offset, 10) : undefined,
      });
      counts = await adminAlertQueries.getCountsByStatus(orgId);
    } else {
      // Scope: external/guest users see only alerts for their allow-listed
      // sources. Intersect any requested sourceId with the allow-list; an empty
      // result means they're scoped to nothing matching → no alerts.
      let scopedSourceId = sourceId;
      let countsScope: string[] | undefined;
      const allowed = userId
        ? await loadAllowedSourceIds(orgId, userId)
        : null;
      if (allowed) {
        const requested =
          sourceId == null
            ? null
            : Array.isArray(sourceId)
              ? sourceId
              : [sourceId];
        const ids = (requested ?? [...allowed]).filter((id) =>
          allowed.has(id),
        );
        if (ids.length === 0) {
          return NextResponse.json({
            alerts: [],
            counts: { open: 0, acknowledged: 0, resolved: 0 },
          });
        }
        scopedSourceId = ids;
        countsScope = ids;
      }

      alerts = await alertQueries.findAll(orgId, {
        status,
        severity,
        sourceId: scopedSourceId,
        triggerType: triggerType || undefined,
        limit: Math.min(limit ? parseInt(limit, 10) : 200, 1000),
        offset: offset ? parseInt(offset, 10) : undefined,
      });
      counts = await alertQueries.getCountsByStatus(orgId, countsScope);
    }

    // Additive identity enrichment: payloads carry the slug (canonical
    // user-facing id) and name alongside the uuid, so clients never resolve
    // slug↔uuid themselves. `source_id` stays the uuid for existing keying.
    const distinctIds = [
      ...new Set(alerts.map((a) => a.source_id).filter(Boolean)),
    ] as string[];
    if (distinctIds.length > 0) {
      const lookup = () => sourceQueries.findByIds(orgId, distinctIds);
      const rows = isApiKeyAuth ? await runWithServiceRole(lookup) : await lookup();
      const byId = new Map(rows.map((s) => [s.id, s]));
      alerts = alerts.map((a) => {
        const s = a.source_id ? byId.get(a.source_id) : undefined;
        return s
          ? { ...a, source_slug: s.slug, source_name: s.name || s.slug }
          : a;
      });
    }

    return NextResponse.json({ alerts, counts });
  },
);

// POST /api/alerts
export const POST = withDualAuth(
  async (request: NextRequest, { orgId, userId, orgRole, isApiKeyAuth }) => {
    // Manifest-gated capability (default org:editor; admin-configurable).
    if (!isApiKeyAuth) {
      await requirePermission({ orgId, orgRole, userId }, "action-new-alert");
    }

    // Validate body with Zod
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      throw apiError("VALIDATION_ERROR", "Invalid JSON body");
    }

    const parsed = CreateAlertSchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      }));
      throw apiError("VALIDATION_ERROR", "Request validation failed", issues);
    }

    const {
      source_id,
      trigger_type,
      metric,
      value,
      threshold,
      bound,
      severity,
      limit_id,
      alert_stats,
      context_snapshot,
    } = parsed.data;

    // Validate source exists if provided (use appropriate queries based on auth type)
    if (source_id) {
      if (isApiKeyAuth) {
        const source = await adminSourceQueries.findById(source_id);
        if (!source || source.org_id !== orgId) {
          throw apiError("NOT_FOUND", "Source not found");
        }
      } else {
        const sources = await sourceQueries.findById(orgId, source_id);
        if (sources.length === 0) {
          throw apiError("NOT_FOUND", "Source not found");
        }
      }
    }

    // Use admin queries for API key auth, regular queries for session auth
    const queries = isApiKeyAuth ? adminAlertQueries : alertQueries;
    const eventQueries = isApiKeyAuth
      ? adminAlertEventQueries
      : alertEventQueries;

    // Create the alert
    const alert = await queries.create(orgId, {
      source_id: source_id || null,
      trigger_type,
      metric,
      value: value as number,
      threshold: threshold ?? null,
      bound: bound ?? null,
      severity: severity || "warning",
      limit_id: limit_id || null,
      alert_stats: (alert_stats || []) as Json,
      context_snapshot: (context_snapshot || {}) as Json,
    });

    // Create the initial "created" event
    await eventQueries.create(orgId, alert.id, "created", {
      actorId: userId || undefined,
      message: `Alert triggered: ${metric} exceeded ${bound} limit`,
      metadata: {
        value,
        threshold,
        bound,
        severity,
      },
    });

    return NextResponse.json({ alert }, { status: 201 });
  },
);
