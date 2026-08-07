/**
 * POST /api/dashboards/quick-start
 *
 * Builds a starter dashboard for a source (or an overlay across sources),
 * also previewed/applied by the Terminal's dashboard proposal.
 * Picks a mix of panel types based on each
 * metric's name + suffix:
 *
 *   - percent / *_pct        → stat tile, "%" unit, 1 decimal
 *   - voltage / *_voltage    → stat tile, "V" unit, 2 decimals
 *   - signal / *_dbm         → stat tile, "dBm" unit, 0 decimals
 *   - latency / *_ms         → stat tile, "ms" unit, 0 decimals
 *   - temp / *_c             → stat tile, "°C" unit, 1 decimal
 *   - uptime                 → stat tile, "s" unit, 0 decimals
 *   - everything else        → line chart
 *
 * Stat tiles take the first row (4 across), line charts fill the rows
 * below (2 across). When a metric matches a stat-tile pattern AND has
 * meaningful trend (cpu_percent, temp_c), we render it BOTH as a
 * headline stat tile up top and as a line chart further down — same
 * metric, two views, the way real dashboards are built.
 *
 * No AI, no SSE — pure programmatic layout so it's instant and free.
 */

import { NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/lib/api/with-auth";
import { dashboardQueries, type Json } from "@/lib/db";
import { getSourceMetrics } from "@/lib/db/clickhouse";
import {
  type DashboardConfig,
  DEFAULT_TIME_RANGE,
} from "@/lib/types/dashboard";
// The panel-layout logic lives in one place so the Terminal's dashboard
// proposal can preview the *exact* dashboard this route will create.
import {
  buildPanels,
  buildOverlayPanels,
} from "@/lib/dashboards/quick-start-layout";
import { getTemplate } from "@/lib/dashboards/templates";
import { emitSystemEvent } from "@/lib/events/emit";

export const POST = withAuth(async (request, { userId, orgId, orgRole }) => {
  try {
    // Same gate as POST /api/dashboards — quick-start must not be a bypass.
    await requirePermission({ orgId, orgRole, userId }, "action-new-dashboard");
    const body = (await request.json().catch(() => ({}))) as {
      sourceId?: string;
      sources?: string[];
      name?: string;
      /** Optional template id (lib/dashboards/templates.ts); default layout otherwise. */
      template?: string;
    };

    // Accept either a single `sourceId` or a list of `sources` to overlay on
    // one dashboard. Dedup, drop blanks, preserve order.
    const sourceList = Array.from(
      new Set(
        [
          ...(Array.isArray(body.sources) ? body.sources : []),
          body.sourceId ?? "",
        ]
          .map((s) => String(s ?? "").trim())
          .filter(Boolean),
      ),
    );
    if (sourceList.length === 0) {
      return NextResponse.json(
        { error: "sourceId is required" },
        { status: 400 },
      );
    }

    // ── Multi-source overlay dashboard ──────────────────────────────────
    if (sourceList.length > 1) {
      const fetched = await Promise.all(
        sourceList.map(async (s) => {
          try {
            return [s, await getSourceMetrics(orgId, s)] as const;
          } catch {
            return [s, [] as string[]] as const;
          }
        }),
      );
      const metricsBySource: Record<string, string[]> = {};
      for (const [s, m] of fetched) if (m.length > 0) metricsBySource[s] = m;
      const withMetrics = Object.keys(metricsBySource);
      if (withMetrics.length === 0) {
        return NextResponse.json(
          {
            error:
              "None of those sources have metrics yet. Send a data point first, then retry.",
          },
          { status: 422 },
        );
      }

      const panels = buildOverlayPanels(metricsBySource);
      const config: DashboardConfig = {
        panels,
        timeRange: DEFAULT_TIME_RANGE,
        refreshInterval: 5000,
        displaySettings: { autoRefresh: 5, syncTooltips: true },
      };

      const defaultName =
        withMetrics.length === 2
          ? `${withMetrics[0]} + ${withMetrics[1]} overlay`
          : "Multi-source overview";
      const name = (body.name ?? defaultName).slice(0, 80);
      const inserted = await dashboardQueries.insert(orgId, {
        name,
        description: `Overlays metrics across ${withMetrics.join(", ")}.`,
        icon: null,
        parent_id: null,
        config: config as unknown as Json,
      });
      const dashboard = Array.isArray(inserted) ? inserted[0] : inserted;

      emitSystemEvent({
        orgId,
        eventType: "dashboard.created",
        category: "dashboard",
        title: `Overlay dashboard created across ${withMetrics.join(", ")}`,
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
        },
        { status: 201 },
      );
    }

    // ── Single-source starter dashboard ──────────────────────────────────
    const sourceId = sourceList[0];
    const metrics = await getSourceMetrics(orgId, sourceId);
    if (metrics.length === 0) {
      return NextResponse.json(
        {
          error:
            "No metrics yet for this source. Send a data point first, then retry.",
        },
        { status: 422 },
      );
    }

    const template = body.template ? getTemplate(body.template) : undefined;
    const panels = template
      ? template.build(metrics, sourceId)
      : buildPanels(metrics, sourceId);

    const config: DashboardConfig = {
      panels,
      timeRange: DEFAULT_TIME_RANGE,
      refreshInterval: 5000,
      displaySettings: {
        autoRefresh: 5,
        syncTooltips: true,
      },
    };

    const name = (
      body.name ?? (template ? `${sourceId} — ${template.name}` : `${sourceId} — starter`)
    ).slice(0, 80);
    const inserted = await dashboardQueries.insert(orgId, {
      name,
      description: `Auto-generated from the first metrics seen on ${sourceId}.`,
      icon: null,
      parent_id: null,
      config: config as unknown as Json,
    });
    const dashboard = Array.isArray(inserted) ? inserted[0] : inserted;

    emitSystemEvent({
      orgId,
      eventType: "dashboard.created",
      category: "dashboard",
      title: `Starter dashboard created for ${sourceId}`,
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
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("[dashboards/quick-start] error:", err);
    return NextResponse.json(
      { error: "Failed to generate dashboard" },
      { status: 500 },
    );
  }
});
