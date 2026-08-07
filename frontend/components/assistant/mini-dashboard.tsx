"use client";

/**
 * A faithful mini-render of the dashboard a proposal will create. It takes the
 * SAME Panel[] the quick-start route builds (shared layout), so what you review
 * is what you get: a row of stat tiles + the wide trend charts below them.
 *
 * Reuses the calm /incidents chart tile (MetricPanel) for every panel — stat
 * panels render narrow (number-forward), line panels render wide. One batched
 * telemetry fetch feeds the whole grid (no request-per-tile).
 */

import { useEffect, useState } from "react";
import { LayoutDashboard } from "lucide-react";
import { MetricPanel } from "@/components/assistant/metric-chart";
import type { MetricSeries } from "@/lib/triage/types";
import type { Panel } from "@/lib/types/dashboard";
import { cn } from "@/lib/utils";

// Keep the card calm + contained (Linear-grade restraint): show the headline
// panels, note the rest rather than sprawling.
const MAX_PANELS = 6;

type SeriesMap = Record<string, number[]>;

/** The metric a tile plots — its first key (overlay panels show the primary). */
function panelKey(panel: Panel): string {
  return panel.metrics?.[0] ?? "";
}

function metricName(key: string): string {
  return key.split(":").slice(1).join(":") || key;
}

/** Batch-fetch every metric the grid needs in a single telemetry query. */
function useGridSeries(keys: string[]): { series: SeriesMap; ready: boolean } {
  const [series, setSeries] = useState<SeriesMap>({});
  const [ready, setReady] = useState(false);
  // Stable dep: the sorted unique key set.
  const dep = Array.from(new Set(keys)).sort().join(",");

  useEffect(() => {
    let alive = true;
    const list = dep ? dep.split(",") : [];
    (async () => {
      if (list.length === 0) {
        if (alive) setReady(true);
        return;
      }
      try {
        const res = await fetch(
          `/api/telemetry/query?metrics=${encodeURIComponent(list.join(","))}&timeRange=1h`,
        );
        const json = await res.json();
        const out: SeriesMap = {};
        for (const k of list) {
          const pts = (json?.data?.[k] ?? []) as { value: number }[];
          out[k] = pts
            .map((p) => p.value)
            .filter((v) => typeof v === "number");
        }
        if (!alive) return;
        setSeries(out);
      } catch {
        /* leave empty — tiles fall back to a calm placeholder */
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [dep]);

  return { series, ready };
}

function toMetricSeries(panel: Panel, data: number[]): MetricSeries {
  const key = panelKey(panel);
  return {
    label: panel.title || metricName(key),
    unit: panel.config?.unit,
    current: data.at(-1) ?? 0,
    data: data.length > 0 ? data : [0, 0],
  };
}

export function MiniDashboard({
  panels,
  name,
}: {
  panels: Panel[];
  name?: string;
}) {
  const shown = panels.slice(0, MAX_PANELS);
  const hidden = panels.length - shown.length;
  const keys = shown.map(panelKey).filter(Boolean);
  const { series, ready } = useGridSeries(keys);

  return (
    <div className="space-y-2.5">
      {name && (
        <div className="flex items-center gap-2">
          <LayoutDashboard className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="truncate text-xs font-medium text-foreground">
            {name}
          </span>
          <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
            {panels.length} panel{panels.length === 1 ? "" : "s"}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {shown.map((panel) => {
          const key = panelKey(panel);
          const data = series[key] ?? [];
          // Stat tiles read narrow (1 col); trend charts span the full width.
          const wide = panel.type !== "stat";
          return (
            <div key={panel.id} className={cn(wide && "col-span-2")}>
              {ready && data.length === 0 ? (
                <div className="flex h-full min-h-[84px] flex-col rounded-lg border border-border/60 bg-card/40 p-3">
                  <span className="truncate text-2xs text-muted-foreground">
                    {panel.title || metricName(key)}
                  </span>
                  <span className="mt-auto text-2xs text-muted-foreground/60">
                    no data yet
                  </span>
                </div>
              ) : (
                <MetricPanel
                  metric={toMetricSeries(panel, data)}
                  severity="info"
                />
              )}
            </div>
          );
        })}
      </div>

      {hidden > 0 && (
        <p className="text-[10px] text-muted-foreground/70">
          + {hidden} more panel{hidden === 1 ? "" : "s"} on the full dashboard
        </p>
      )}
    </div>
  );
}
