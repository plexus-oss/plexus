"use client";

/**
 * A faithful mini-render of the monitor a proposal will create. The top row
 * mirrors the real Monitors page (type badge · source · metric · condition ·
 * severity); below it, the SAME labeled chart the SignalSheet uses
 * (MetricChartCard) plots the metric with the proposed threshold drawn on it —
 * so you see exactly where the alert line sits before you Apply.
 *
 * Offline monitors have no metric to chart, so they show a calm
 * stream-freshness statement instead.
 */

import { useEffect, useState } from "react";
import { Gauge, WifiOff } from "lucide-react";
import { MetricChartCard } from "@/components/assistant/metric-chart";
import type { MetricSeries, Severity } from "@/lib/triage/types";
import { cn } from "@/lib/utils";

// Matches the real Monitors/Alerts pages.
const SEVERITY_BADGE: Record<string, string> = {
  critical: "bg-red-500/10 text-red-400",
  warning: "bg-amber-500/10 text-amber-400",
  info: "bg-blue-500/10 text-blue-400",
};

const PILL =
  "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium";

export interface MiniMonitorProps {
  sourceId: string;
  severity: Severity;
  /** Threshold monitor: */
  metric?: string;
  min?: number | null;
  max?: number | null;
  /** Offline monitor: */
  offlineMinutes?: number;
}

function useMetricSeries(key: string): {
  series: MetricSeries | null;
  ready: boolean;
} {
  const [series, setSeries] = useState<MetricSeries | null>(null);
  const [fetched, setFetched] = useState(false);
  const metricName = key.split(":").slice(1).join(":") || key;

  useEffect(() => {
    if (!key) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(
          `/api/telemetry/query?metrics=${encodeURIComponent(key)}&timeRange=1h`,
        );
        const json = await res.json();
        const pts = (json?.data?.[key] ?? []) as { value: number }[];
        const data = pts
          .map((p) => p.value)
          .filter((v) => typeof v === "number");
        if (!alive) return;
        setSeries({ label: metricName, current: data.at(-1) ?? 0, data });
      } catch {
        /* leave null — falls back to the row alone */
      } finally {
        if (alive) setFetched(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [key, metricName]);

  // No key means there's nothing to fetch — ready immediately; otherwise ready
  // once the fetch settles. Once true it stays true (matching prior behavior).
  const ready = !key || fetched;
  return { series, ready };
}

export function MiniMonitor(props: MiniMonitorProps) {
  const { sourceId, severity, metric, min, max, offlineMinutes } = props;
  const isOffline = offlineMinutes != null;
  const key = !isOffline && metric ? `${sourceId}:${metric}` : "";
  const { series, ready } = useMetricSeries(key);

  let condition = "";
  if (isOffline) {
    condition = `no data > ${offlineMinutes}m`;
  } else {
    const parts: string[] = [];
    if (min != null) parts.push(`< ${min}`);
    if (max != null) parts.push(`> ${max}`);
    condition = parts.join(" · ");
  }

  // MetricSeries carries a single threshold line — draw the active bound
  // (a max reads as a ceiling, a min as a floor).
  const thresholdValue = max != null ? max : (min ?? undefined);
  const chartSeries: MetricSeries | null =
    series && thresholdValue != null
      ? { ...series, threshold: thresholdValue, higherIsWorse: max != null }
      : series;

  return (
    <div className="space-y-2.5">
      {/* The monitor row — mirrors the Monitors page list item. */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            PILL,
            isOffline
              ? "bg-purple-500/10 text-purple-500"
              : "bg-blue-500/10 text-blue-500",
          )}
        >
          {isOffline ? (
            <WifiOff className="h-2.5 w-2.5" />
          ) : (
            <Gauge className="h-2.5 w-2.5" />
          )}
          {isOffline ? "Offline" : "Threshold"}
        </span>
        <span className="text-sm font-medium text-foreground">{sourceId}</span>
        {metric && !isOffline && (
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground/90">
            {metric}
          </code>
        )}
        <span className="text-xs tabular-nums text-muted-foreground">
          {condition}
        </span>
        <span
          className={cn(PILL, "ml-auto capitalize", SEVERITY_BADGE[severity])}
        >
          {severity}
        </span>
      </div>

      {/* The metric, with the proposed threshold drawn on it. */}
      {isOffline ? (
        <p className="rounded-lg border border-border/60 bg-card/40 px-3 py-2.5 text-xs text-muted-foreground">
          Fires when{" "}
          <span className="font-medium text-foreground">{sourceId}</span> stops
          sending data for {offlineMinutes} min — auto-resolves when it&apos;s
          back.
        </p>
      ) : (
        chartSeries && (
          <MetricChartCard metric={chartSeries} severity={severity} />
        )
      )}
      {!isOffline && ready && !series && (
        <p className="rounded-lg border border-border/60 bg-card/40 px-3 py-2.5 text-xs text-muted-foreground/70">
          No recent data for {metric} yet — the alert applies once data flows.
        </p>
      )}
    </div>
  );
}
