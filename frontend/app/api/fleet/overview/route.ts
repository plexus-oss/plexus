/**
 * GET /api/fleet/overview — the alert-rollup slice the client can't cheaply
 * compute itself: open-alert count and 90-day noise tally per source (two
 * grouped queries), plus the platform's own background-loop health.
 *
 * The page composes this with useSources (status), useMonitors (per-source
 * health) and useFleetHealth (throughput). Source identity here is the UUID
 * (alerts.source_id = sources.id), so the client joins on source id.
 */

import { NextResponse } from "next/server";
import { withDualAuth } from "@/lib/api/with-auth";
import { alertQueries } from "@/lib/db";
import { adminAlertQueries } from "@/lib/db/server";
import { loadAllowedSourceIds } from "@/lib/access/sources";
import { getLoopHealth } from "@/lib/scheduler/loop-heartbeat";

export const GET = withDualAuth(
  async (_req, { orgId, userId, isApiKeyAuth }) => {
    let open: Array<{ source_id: string; count: number }>;
    let noise: Array<{ source_id: string; noise: number; total: number }>;

    if (isApiKeyAuth) {
      [open, noise] = await Promise.all([
        adminAlertQueries.getOpenCountsBySource(orgId),
        adminAlertQueries.getNoiseBySource(orgId),
      ]);
    } else {
      // Scope to the caller's allow-listed sources (external/guest users).
      const allowed = userId ? await loadAllowedSourceIds(orgId, userId) : null;
      const scope = allowed ? [...allowed] : undefined;
      if (allowed && scope!.length === 0) {
        return NextResponse.json({
          alerts: [],
          platform: getLoopHealth(),
        });
      }
      [open, noise] = await Promise.all([
        alertQueries.getOpenCountsBySource(orgId, scope),
        alertQueries.getNoiseBySource(orgId, scope),
      ]);
    }

    // Merge the two per-source tallies into one row keyed by source id.
    const bySource = new Map<
      string,
      { source_id: string; open: number; noise: number; noise_total: number }
    >();
    for (const o of open) {
      bySource.set(o.source_id, {
        source_id: o.source_id,
        open: o.count,
        noise: 0,
        noise_total: 0,
      });
    }
    for (const n of noise) {
      const row = bySource.get(n.source_id) ?? {
        source_id: n.source_id,
        open: 0,
        noise: 0,
        noise_total: 0,
      };
      row.noise = n.noise;
      row.noise_total = n.total;
      bySource.set(n.source_id, row);
    }

    return NextResponse.json({
      alerts: [...bySource.values()],
      // Platform background-loop health — this route runs in the same
      // persistent Fly process as the loops, so getLoopHealth() sees their ticks.
      platform: getLoopHealth(),
    });
  },
);
