"use client";

/**
 * Run-compare ghost series — n baselines.
 *
 * Fetches each baseline run's telemetry over its own absolute window
 * (bypassing TelemetryProvider, which is locked to the dashboard range —
 * same precedent as the mini-scrubber's independent fetch) and time-shifts
 * every point so each baseline's start lands on the shared anchor:
 *
 *   shifted.x = t − baselineStart + alignTarget
 *
 * Points carry `t0` (the original epoch ms) so tooltips can report the
 * baseline's real time; `t0` survives LTTB because downsampling returns
 * references to the original point objects.
 *
 * Colors are PER RUN, not per metric: all of a baseline's traces render in
 * its single run color (CompareRun.color, from RUN_COMPARE_COLORS) — the
 * only scheme that stays legible with several runs on multi-metric panels.
 */

import { useMemo } from "react";
import useSWR from "swr";
import { useSharedQueryContext } from "@/components/dashboard/shared-query-context";
import { downsampleLTTB } from "@/lib/data-utils";
import type { CompareRun } from "@/components/dashboard/dashboard-interaction-context";
import type { ChartSeries } from "@/hooks/use-chart-series";

export const GHOST_OPACITY = 0.85;

export interface GhostPoint {
  x: number;
  y: number;
  /** Original baseline timestamp (epoch ms) — pre-shift, for tooltips */
  t0: number;
}

export interface GhostSeries extends ChartSeries {
  opacity: number;
  strokeWidth: number;
  /** Marks the series for tooltip/legend special-casing */
  isGhost: true;
  /** Bare metric key this ghost mirrors */
  metricKey: string;
  /** Baseline run id this trace belongs to */
  runId: string;
}

/**
 * The server picks query resolution purely from the window span
 * (lib/db/clickhouse.ts queryTelemetryAdaptive). Replicated here so we can
 * warn when a baseline and the current window were aggregated differently —
 * comparing raw against 1h rollups silently lies.
 */
export function resolutionForSpan(
  spanMs: number,
): "raw" | "downsampled" | "1m" | "1h" {
  const H = 3_600_000;
  if (spanMs <= H) return "raw";
  if (spanMs <= 6 * H) return "downsampled";
  if (spanMs <= 24 * H) return "1m";
  return "1h";
}

type TelemetryResponse = {
  data: Record<string, Array<{ timestamp: string; value: number }>>;
};

interface UseComparisonSeriesOptions {
  /** The panel's resolved telemetry data keys (same keys usePanelData uses) */
  metrics: string[];
  /** Baseline runs (window + anchor + color per run) */
  baselines: CompareRun[];
  chartWidth: number;
  enabled: boolean;
}

export function useComparisonSeries({
  metrics,
  baselines,
  chartWidth,
  enabled,
}: UseComparisonSeriesOptions): {
  ghostSeries: GhostSeries[];
  isLoading: boolean;
  /** Coarsest baseline resolution (for the mismatch notice), null when off */
  baselineResolution: string | null;
} {
  // Shared-link dashboards must query through the share endpoint or the
  // baseline fetch 401s.
  const sharedCtx = useSharedQueryContext();

  const active = enabled && baselines.length > 0 && metrics.length > 0;

  const key = active
    ? [
        "run-compare",
        metrics.join(","),
        baselines.map((b) => `${b.id}:${b.window}`).join("|"),
        sharedCtx?.shareToken ?? "",
      ]
    : null;

  const { data, isLoading } = useSWR(
    key,
    async (): Promise<Array<TelemetryResponse | null>> => {
      const fetchWindow = async (window: string) => {
        const params = new URLSearchParams({
          metrics: metrics.join(","),
          timeRange: window,
          // Scale the row cap with metric count or multi-metric baselines
          // (e.g. the schematic's 16-pin fetch) get tail-truncated.
          limit: String(Math.min(Math.max(metrics.length, 1) * 2000, 50_000)),
        });
        if (sharedCtx?.password) params.set("password", sharedCtx.password);
        const url = sharedCtx?.shareToken
          ? `/api/shared/${sharedCtx.shareToken}/telemetry?${params}`
          : `/api/telemetry/query?${params}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        return (await res.json()) as TelemetryResponse;
      };
      return Promise.all(baselines.map((b) => fetchWindow(b.window)));
    },
    // Completed runs' windows are immutable — never re-poll them.
    { revalidateOnFocus: false, revalidateOnReconnect: false },
  );

  const ghostSeries = useMemo<GhostSeries[]>(() => {
    if (!active || !data) return [];
    const maxPoints = Math.max(200, Math.floor(chartWidth || 0) * 2);
    const out: GhostSeries[] = [];
    baselines.forEach((baseline, bi) => {
      const resp = data[bi];
      if (!resp?.data) return;
      const offset = baseline.alignTarget - baseline.startedAt;
      for (const metric of metrics) {
        const points = resp.data[metric];
        if (!points || points.length < 2) continue;
        const shifted: GhostPoint[] = [];
        for (const p of points) {
          const t = new Date(p.timestamp).getTime();
          if (!Number.isFinite(t) || typeof p.value !== "number") continue;
          shifted.push({ x: t + offset, y: p.value, t0: t });
        }
        if (shifted.length < 2) continue;
        shifted.sort((a, b) => a.x - b.x);
        const bare = metric.includes(":")
          ? metric.split(":").slice(1).join(":")
          : metric;
        out.push({
          name: `${bare} · ${baseline.label}`,
          color: baseline.color,
          data: downsampleLTTB(shifted, maxPoints),
          opacity: GHOST_OPACITY,
          strokeWidth: 1.5,
          isGhost: true,
          metricKey: metric,
          runId: baseline.id,
        });
      }
    });
    return out;
  }, [active, data, metrics, baselines, chartWidth]);

  const baselineResolution = useMemo(() => {
    if (!active) return null;
    let coarsest: string | null = null;
    const order = ["raw", "downsampled", "1m", "1h"];
    for (const b of baselines) {
      const [startIso, endIso] = b.window.split("/");
      const span = new Date(endIso).getTime() - new Date(startIso).getTime();
      if (!Number.isFinite(span) || span <= 0) continue;
      const r = resolutionForSpan(span);
      if (!coarsest || order.indexOf(r) > order.indexOf(coarsest)) coarsest = r;
    }
    return coarsest;
  }, [active, baselines]);

  return { ghostSeries, isLoading, baselineResolution };
}
