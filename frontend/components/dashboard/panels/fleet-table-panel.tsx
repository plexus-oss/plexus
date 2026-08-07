"use client";

/**
 * Fleet Table — one row per device, live metric columns, drill-in on click.
 *
 * Built for the ops-lead question: "which robot in my fleet needs my
 * attention right now?" — answered by row ordering (worst-first) and
 * per-cell threshold coloring.
 *
 * Data source: realtime telemetry ONLY. No SQL connection required, so
 * it works with live-only (recording=false) sources. Each column is a
 * metric name — the cell value is the latest point for that source.
 *
 * Config shape:
 *   {
 *     columns: [
 *       { label: "SoC",     metric: "battery.soc",         unit: "%", decimals: 1,
 *         warnBelow: 25,  critBelow: 10, lowerIsWorse: true },
 *       { label: "Vib",     metric: "imu.vibration_rms_l", unit: "g", decimals: 2,
 *         warnAbove: 0.5, critAbove: 0.9 },
 *       …
 *     ]
 *   }
 *
 * The panel's `sources[]` defines the row set. Metrics are scoped per
 * source; the panel computes the effective key as "<sourceId>:<metric>".
 */

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { usePanelData } from "@/hooks/use-panel-data";
import { useSources } from "@/hooks/use-sources";
import type { Panel, TimeRange } from "@/lib/types/dashboard";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { PanelEmptyState } from "@/components/dashboard/panels/panel-empty-state";
import { ChevronRight, TrendingUp, TrendingDown, Minus } from "lucide-react";

interface FleetTablePanelProps {
  panel: Panel;
  timeRange: TimeRange;
}

interface ColumnConfig {
  label: string;
  metric: string;
  unit?: string;
  decimals?: number;
  /** If set, values above this turn amber. */
  warnAbove?: number;
  /** Values above this turn red. */
  critAbove?: number;
  /** Values below this turn amber. */
  warnBelow?: number;
  /** Values below this turn red. */
  critBelow?: number;
  /** Width hint (fraction of the total; defaults to equal share). */
  width?: string;
}

interface FleetTableConfig {
  columns?: ColumnConfig[];
  /** Hide the last-seen column. Default false. */
  hideLastSeen?: boolean;
  /** Sort rows by worst severity descending. Default true. */
  sortBySeverity?: boolean;
}

type Severity = "ok" | "warn" | "crit" | "unknown";

const SEV_ORDER: Record<Severity, number> = {
  crit: 3,
  warn: 2,
  ok: 1,
  unknown: 0,
};

function sevColor(sev: Severity) {
  switch (sev) {
    case "crit":
      return "bg-red-500";
    case "warn":
      return "bg-amber-500";
    case "ok":
      return "bg-emerald-500";
    default:
      return "bg-muted-foreground/40";
  }
}

function cellTextColor(sev: Severity) {
  switch (sev) {
    case "crit":
      return "text-red-500";
    case "warn":
      return "text-amber-500";
    default:
      return "text-foreground";
  }
}

function scoreSeverity(value: number | null, col: ColumnConfig): Severity {
  if (value === null || Number.isNaN(value)) return "unknown";
  if (col.critAbove !== undefined && value >= col.critAbove) return "crit";
  if (col.warnAbove !== undefined && value >= col.warnAbove) return "warn";
  if (col.critBelow !== undefined && value <= col.critBelow) return "crit";
  if (col.warnBelow !== undefined && value <= col.warnBelow) return "warn";
  return "ok";
}

function worst(a: Severity, b: Severity): Severity {
  return SEV_ORDER[a] >= SEV_ORDER[b] ? a : b;
}

export function FleetTablePanel({ panel, timeRange }: FleetTablePanelProps) {
  const router = useRouter();
  const config = (panel.config as unknown as FleetTableConfig) ?? {};
  const columns = useMemo(() => config.columns ?? [], [config.columns]);
  const sources = useMemo(() => panel.sources ?? [], [panel.sources]);

  const { data, isLoading, error, refresh, sourceType } = usePanelData({
    panel,
    timeRange,
  });

  const { devices } = useSources({ type: "device" });
  const devicesBySlug = useMemo(() => {
    const m = new Map<string, (typeof devices)[number]>();
    for (const d of devices) m.set(d.slug, d);
    return m;
  }, [devices]);

  const rows = useMemo(() => {
    if (!data) return [];

    const out = sources.map((slug) => {
      const device = devicesBySlug.get(slug);
      const cells = columns.map((col) => {
        const key = `${slug}:${col.metric}`;
        const points = data[key] ?? data[col.metric] ?? [];
        const last = points.length > 0 ? points[points.length - 1] : undefined;
        const value =
          last && typeof last.value === "number"
            ? (last.value as number)
            : null;
        const sev = scoreSeverity(value, col);
        const trend = (() => {
          if (points.length < 4) return 0;
          const recent = points.slice(-20).map((p) => p.value as number);
          const half = Math.floor(recent.length / 2);
          const oldAvg =
            recent.slice(0, half).reduce((a, b) => a + b, 0) / half;
          const newAvg =
            recent.slice(half).reduce((a, b) => a + b, 0) /
            (recent.length - half);
          if (oldAvg === 0) return 0;
          return ((newAvg - oldAvg) / Math.abs(oldAvg)) * 100;
        })();
        const lastTs = last?.timestamp;
        return { col, value, sev, trend, lastTs };
      });

      const rowSeverity = cells.reduce<Severity>(
        (acc, c) => worst(acc, c.sev),
        "ok",
      );
      const lastSeenTs = cells
        .map((c) => c.lastTs)
        .filter((ts): ts is string => !!ts)
        .sort()
        .pop();

      return {
        slug,
        name: device?.name ?? slug,
        deviceType: device?.device_type ?? "device",
        status: device?.status ?? "unknown",
        cells,
        rowSeverity,
        lastSeenTs,
      };
    });

    const sortBySev = config.sortBySeverity !== false;
    if (sortBySev) {
      out.sort((a, b) => {
        const diff = SEV_ORDER[b.rowSeverity] - SEV_ORDER[a.rowSeverity];
        if (diff !== 0) return diff;
        return a.slug.localeCompare(b.slug);
      });
    }
    return out;
  }, [data, sources, devicesBySlug, columns, config.sortBySeverity]);

  if (error) {
    return (
      <PanelEmptyState
        reason="query_error"
        debugInfo={{
          sourceType,
          errorMessage: error instanceof Error ? error.message : String(error),
        }}
        onRetry={refresh}
      />
    );
  }

  if (columns.length === 0) {
    return (
      <div className="h-full flex items-center justify-center p-4 text-center text-sm text-muted-foreground">
        Add at least one column to the fleet table config:
        <br />
        <code className="font-mono text-xs">
          {`{ columns: [{ label, metric, unit?, warnAbove?, critAbove? }] }`}
        </code>
      </div>
    );
  }

  if (isLoading && rows.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (rows.length === 0) {
    return <PanelEmptyState reason="no_data" />;
  }

  const hideLastSeen = config.hideLastSeen ?? false;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div
        className="grid items-center gap-3 px-3 py-2 border-b border-border/60 text-[10px] uppercase tracking-wider font-medium text-muted-foreground"
        style={{
          gridTemplateColumns: `1.2rem minmax(10rem, 1.4fr) repeat(${columns.length}, minmax(5rem, 1fr)) ${hideLastSeen ? "" : "minmax(6rem, auto) "}1.2rem`,
        }}
      >
        <span />
        <span>Device</span>
        {columns.map((c) => (
          <span key={c.label} className="truncate">
            {c.label}
          </span>
        ))}
        {!hideLastSeen && <span>Last seen</span>}
        <span />
      </div>
      {/* Rows */}
      <div className="flex-1 min-h-0 overflow-auto">
        {rows.map((row) => {
          const onClick = () => router.push(`/devices/${row.slug}`);
          return (
            <button
              key={row.slug}
              type="button"
              onClick={onClick}
              className={cn(
                "w-full grid items-center gap-3 px-3 py-2.5 border-b border-border/40",
                "text-left hover:bg-muted/50 transition-colors cursor-pointer",
              )}
              style={{
                gridTemplateColumns: `1.2rem minmax(10rem, 1.4fr) repeat(${columns.length}, minmax(5rem, 1fr)) ${hideLastSeen ? "" : "minmax(6rem, auto) "}1.2rem`,
              }}
            >
              {/* Row severity dot */}
              <span
                className={cn(
                  "h-2 w-2 rounded-full shrink-0",
                  sevColor(row.rowSeverity),
                )}
                title={row.rowSeverity}
              />
              {/* Device label */}
              <div className="flex flex-col min-w-0">
                <span className="text-[13px] font-medium truncate">
                  {row.name}
                </span>
                <span className="text-[10px] text-muted-foreground truncate">
                  {row.deviceType} · {row.slug}
                </span>
              </div>
              {/* Cells */}
              {row.cells.map((cell, i) => {
                const TrendIcon =
                  Math.abs(cell.trend) < 1
                    ? Minus
                    : cell.trend > 0
                      ? TrendingUp
                      : TrendingDown;
                const trendColor =
                  Math.abs(cell.trend) < 1
                    ? "text-muted-foreground/60"
                    : cell.trend > 0
                      ? "text-emerald-500"
                      : "text-red-400";
                return (
                  <div key={i} className="flex items-center gap-1.5 min-w-0">
                    <span
                      className={cn(
                        "tabular-nums font-medium text-sm truncate",
                        cellTextColor(cell.sev),
                      )}
                    >
                      {cell.value === null
                        ? "—"
                        : cell.value.toFixed(cell.col.decimals ?? 1)}
                    </span>
                    {cell.col.unit && (
                      <span className="text-[10px] text-muted-foreground">
                        {cell.col.unit}
                      </span>
                    )}
                    {cell.value !== null && Math.abs(cell.trend) >= 1 && (
                      <TrendIcon
                        className={cn("h-3 w-3 shrink-0", trendColor)}
                      />
                    )}
                  </div>
                );
              })}
              {/* Last seen */}
              {!hideLastSeen && (
                <span className="text-[11px] text-muted-foreground truncate">
                  {row.lastSeenTs
                    ? formatDistanceToNow(new Date(row.lastSeenTs), {
                        addSuffix: true,
                      })
                    : "—"}
                </span>
              )}
              {/* Drill-in chevron */}
              <ChevronRight className="h-4 w-4 text-muted-foreground/60 shrink-0" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
