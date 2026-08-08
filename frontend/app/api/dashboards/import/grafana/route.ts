/**
 * POST /api/dashboards/import/grafana — Grafana dashboard migration.
 *
 * Two-phase, driven by the presence of `bindings`:
 *
 *   1. Dry run (no bindings): parse the pasted/uploaded Grafana JSON with the
 *      total converter (lib/import/grafana.ts) and return the title, the
 *      per-panel import report, and the distinct extracted metric names for
 *      the client's binding table. Nothing is created.
 *
 *   2. Create (with bindings): re-convert, resolve each extracted name to the
 *      chosen `source:metric`, and persist the dashboard through the same
 *      insert path quick-start uses. Unbound names still import — their
 *      panels are created as unbound placeholders the user configures later.
 *
 * FREE-tier feature by design: no entitlement/license gate here, ever — only
 * the same editor-level permission that creating any dashboard requires.
 */

import { NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/lib/api/with-auth";
import { validateBody } from "@/lib/api/validate";
import { GrafanaImportSchema } from "@/lib/validation/api-schemas";
import { dashboardQueries, type Json } from "@/lib/db";
import {
  convertGrafanaDashboard,
  applyBindings,
  buildDashboardConfig,
} from "@/lib/import/grafana";
import { emitSystemEvent } from "@/lib/events/emit";

export const POST = withAuth(
  async (request, { userId, orgId, orgRole, roleId }) => {
    await requirePermission(
      { orgId, orgRole, userId, roleId },
      "action-import-grafana-dashboard",
    );
    const body = await validateBody(request, GrafanaImportSchema);

    const conversion = convertGrafanaDashboard(body.dashboard);

    // ── Phase 1: dry run — report only ─────────────────────────────────────
    if (!body.bindings) {
      return NextResponse.json({
        title: conversion.title,
        report: conversion.report,
      });
    }

    // ── Phase 2: bind + create ─────────────────────────────────────────────
    const { panels, unbound } = applyBindings(conversion, body.bindings);
    if (panels.length === 0) {
      return NextResponse.json(
        {
          error:
            "No importable panels found in that dashboard. Check the import report for per-panel reasons.",
          report: conversion.report,
        },
        { status: 422 },
      );
    }

    const name = (body.name?.trim() || conversion.title).slice(0, 80);
    const config = buildDashboardConfig(conversion, panels);
    const inserted = await dashboardQueries.insert(orgId, {
      name,
      description: `Imported from Grafana (${conversion.report.mapped} of ${conversion.report.totalPanels} panels).`,
      icon: null,
      parent_id: null,
      config: config as unknown as Json,
      created_by: userId ?? null,
    });
    const dashboard = Array.isArray(inserted) ? inserted[0] : inserted;

    emitSystemEvent({
      orgId,
      eventType: "dashboard.created",
      category: "dashboard",
      title: `Dashboard "${name}" imported from Grafana`,
      severity: "success",
      entityId: dashboard.id,
      entityType: "dashboard",
      actorId: userId,
    });

    return NextResponse.json(
      {
        dashboard: {
          id: dashboard.id,
          name: dashboard.name,
          panel_count: panels.length,
        },
        report: conversion.report,
        unbound,
      },
      { status: 201 },
    );
  },
);
