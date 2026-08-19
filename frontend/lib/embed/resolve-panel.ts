import "server-only";

/**
 * Resolve one embed panel's data: authorize the token → load the org-owned panel
 * → derive metrics from stored config → query (deduped + 15s cached). Shared by
 * the single (`/api/embed/panel`) and batch (`/api/embed/panels`) routes so the
 * auth + query logic lives once. The ORIGIN check stays in the routes (it needs
 * the request Origin and the per-org verified-origins list).
 */

import { authorizeEmbedRead, verifyEmbedToken } from "@/lib/auth/embed-token";
import { isDurableEmbedToken, resolveDurableToken } from "@/lib/embed/publish";
import { adminDashboardQueries } from "@/lib/db/server";
import { getPanelDataSource } from "@/lib/panels/data-source";
import { parseTimeRangeParam } from "@/lib/telemetry/time-range-param";
import { queryTelemetry } from "@/lib/db/clickhouse";
import {
  singleflight,
  getCachedQuery,
  setCachedQuery,
  queryCacheKey,
} from "@/lib/db/query-cache";
import type { DashboardConfig } from "@/lib/types/dashboard";

const MAX_POINTS = 20_000;

export type PanelData = Record<
  string,
  Array<{ timestamp: string; value: number; source_id: string }>
>;

export interface ResolvedPanel {
  orgId: string;
  panel: { id: string; type: string; title: string };
  data: PanelData;
}
/** Post-auth errors carry `orgId` so the route can still reflect CORS. */
export interface ResolveError {
  orgId?: string;
  error: string;
  status: number;
}

export function isResolveError(
  r: ResolvedPanel | ResolveError,
): r is ResolveError {
  return "error" in r;
}

export async function resolveEmbedPanel(args: {
  token: string;
  /** Optional — the token already encodes dashboard+panel; when passed, they
   *  must match the token (belt-and-suspenders). Omit for token-only usage. */
  dashboardId?: string;
  panelId?: string;
  timeRange?: string;
}): Promise<ResolvedPanel | ResolveError> {
  const { token } = args;

  // The token IS the identity. Three kinds:
  //  • durable `emb_…` — a published embed (DB lookup; revocable, may set a range)
  //  • short-lived JWT with matching dashboard/panel args (authorize + verify match)
  //  • short-lived JWT alone (read the panel straight from its claims)
  let claims:
    | { orgId: string; dashboardId: string; panelId: string; timeRange?: string | null }
    | null;
  if (isDurableEmbedToken(token)) {
    claims = await resolveDurableToken(token);
  } else if (args.dashboardId && args.panelId) {
    claims = await authorizeEmbedRead(token, {
      dashboardId: args.dashboardId,
      panelId: args.panelId,
    });
  } else {
    claims = await verifyEmbedToken(token);
  }
  if (!claims) return { error: "Invalid or expired embed token", status: 401 };
  const { orgId, dashboardId, panelId } = claims;
  const publishedRange = claims.timeRange ?? undefined;

  const [dashboard] = await adminDashboardQueries.findById(orgId, dashboardId);
  if (!dashboard) return { orgId, error: "Dashboard not found", status: 404 };

  const config = dashboard.config as unknown as DashboardConfig;
  const panel = config?.panels?.find((p) => p.id === panelId);
  if (!panel) return { orgId, error: "Panel not found", status: 404 };

  const ds = getPanelDataSource(panel);
  if (ds.kind !== "metrics")
    return { orgId, error: "This panel type isn't embeddable yet.", status: 501 };

  const timeRangeParam =
    args.timeRange ??
    publishedRange ??
    (typeof ds.timeRange === "string" ? ds.timeRange : undefined) ??
    "24h";
  const { startTime, endTime } = parseTimeRangeParam(timeRangeParam, "24h");

  const cacheKey = queryCacheKey(orgId, `embed:${panelId}`, {
    metrics: ds.metrics,
    timeRange: timeRangeParam,
  });
  let data = getCachedQuery<PanelData>(cacheKey);
  if (!data) {
    data = await singleflight(cacheKey, async () => {
      const cached = getCachedQuery<PanelData>(cacheKey);
      if (cached) return cached;
      const fresh = await queryMetricsData(orgId, ds.metrics, startTime, endTime);
      setCachedQuery(cacheKey, fresh);
      return fresh;
    });
  }

  return {
    orgId,
    panel: { id: panel.id, type: panel.type, title: panel.title },
    data,
  };
}

/** Query telemetry for the panel's metric keys, grouped by source, org-scoped. */
async function queryMetricsData(
  orgId: string,
  metricKeys: string[],
  startTime: Date,
  endTime: Date,
): Promise<PanelData> {
  const parsed = metricKeys.map((key) => {
    if (key.includes(":")) {
      const i = key.lastIndexOf(":");
      return { key, sourceId: key.substring(0, i).split(":")[0], metric: key.substring(i + 1) };
    }
    return { key, sourceId: null as string | null, metric: key };
  });

  const data: PanelData = {};
  for (const { key } of parsed) data[key] = [];

  const bySource = new Map<string | null, { key: string; metric: string }[]>();
  for (const p of parsed) {
    if (!bySource.has(p.sourceId)) bySource.set(p.sourceId, []);
    bySource.get(p.sourceId)!.push({ key: p.key, metric: p.metric });
  }

  await Promise.all(
    Array.from(bySource, async ([sourceId, infos]) => {
      const rows = await queryTelemetry({
        orgId,
        sourceId: sourceId || undefined,
        metrics: infos.map((m) => m.metric),
        startTime,
        endTime,
        limit: MAX_POINTS,
      });
      for (const row of rows) {
        const match = infos.find((m) => m.metric === row.metric);
        if (!match) continue;
        const raw =
          typeof row.timestamp === "string" ? row.timestamp : row.timestamp.toISOString();
        const timestamp = raw.includes("T") ? raw : raw.replace(" ", "T") + "Z";
        data[match.key].push({ timestamp, value: row.value, source_id: row.source_id });
      }
    }),
  );

  for (const key of Object.keys(data)) {
    data[key].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }
  return data;
}
