"use client";

/**
 * Fleet grid panel — Linear/Vercel-style cards, one per row from a connection query.
 *
 * Column mapping is fully configurable via `panel.config` so the same panel
 * works for any fleet shape (drones, robots, sensors, vehicles, …):
 *
 *   titleColumn       string column used as the card heading   (default: name | slug | id | title)
 *   subtitleColumn    secondary line                           (default: farm | site | region | location)
 *   stateColumn       drives status stripe + pill              (default: state | status)
 *   stateColors       map { "<state>": { stripe, pill, label } } override
 *   metricColumn      numeric column rendered as mini bar      (default: soc | battery | progress | percent)
 *   metricLabel       label text for the bar                   (default: titlecased column name)
 *   metricUnit        suffix after the number                  (default: "%")
 *   metricMax         bar scale                                (default: 100)
 *   severityColumn    info|warning|critical → badge            (default: severity | alert_severity)
 *   timestampColumn   shown as "3m ago" footer                 (default: last_seen | updated_at | timestamp)
 */

import { useMemo, useState } from "react";
import { usePanelData } from "@/hooks/use-panel-data";
import type { Panel, TimeRange } from "@/lib/types/dashboard";
import { Spinner } from "@/components/ui/spinner";
import { PanelEmptyState } from "@/components/dashboard/panels/panel-empty-state";
import { PanelFilterBar } from "@/components/dashboard/panels/panel-filter-bar";

interface FleetGridPanelProps {
  panel: Panel;
  timeRange: TimeRange;
}

type StateStyle = { stripe: string; pill: string; label?: string };

const DEFAULT_STATE_STYLES: Record<string, StateStyle> = {
  running: {
    stripe: "bg-emerald-500",
    pill: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  },
  ok: {
    stripe: "bg-emerald-500",
    pill: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  },
  active: {
    stripe: "bg-emerald-500",
    pill: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  },
  online: {
    stripe: "bg-emerald-500",
    pill: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  },
  healthy: {
    stripe: "bg-emerald-500",
    pill: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  },
  charging: {
    stripe: "bg-sky-500",
    pill: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  },
  idle: {
    stripe: "bg-sky-500",
    pill: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  },
  pending: {
    stripe: "bg-amber-500",
    pill: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  },
  warning: {
    stripe: "bg-amber-500",
    pill: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  },
  degraded: {
    stripe: "bg-amber-500",
    pill: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  },
  alerting: {
    stripe: "bg-red-500",
    pill: "bg-red-500/15 text-red-400 border-red-500/30",
  },
  error: {
    stripe: "bg-red-500",
    pill: "bg-red-500/15 text-red-400 border-red-500/30",
  },
  critical: {
    stripe: "bg-red-500",
    pill: "bg-red-500/15 text-red-400 border-red-500/30",
  },
  offline: {
    stripe: "bg-zinc-500",
    pill: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  },
  unknown: {
    stripe: "bg-zinc-500",
    pill: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  },
};
const FALLBACK_STYLE: StateStyle = DEFAULT_STATE_STYLES.unknown;

const SEVERITY_BADGE: Record<string, string> = {
  critical: "bg-red-500/15 text-red-400 border-red-500/30",
  error: "bg-red-500/15 text-red-400 border-red-500/30",
  warning: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  info: "bg-sky-500/15 text-sky-400 border-sky-500/30",
};

function firstColumn(cols: string[], candidates: string[]): string | null {
  for (const c of candidates) if (cols.includes(c)) return c;
  return null;
}

function relativeTime(ts: unknown): string {
  if (ts == null) return "";
  const then = new Date(String(ts)).getTime();
  if (isNaN(then)) return "";
  const diff = Date.now() - then;
  if (diff < 0) return "now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface Mapping {
  titleCol: string;
  subtitleCol: string | null;
  stateCol: string | null;
  metricCol: string | null;
  metricLabel: string;
  metricUnit: string;
  metricMax: number;
  severityCol: string | null;
  timestampCol: string | null;
  stateStyles: Record<string, StateStyle>;
}

function resolveMapping(
  cfg: Record<string, unknown>,
  availableColumns: string[],
): Mapping | null {
  const cfgStr = (k: string): string | undefined => {
    const v = cfg[k];
    return typeof v === "string" ? v : undefined;
  };

  const titleCol =
    cfgStr("titleColumn") ||
    firstColumn(availableColumns, ["name", "slug", "id", "title"]);
  if (!titleCol) return null;

  const stateStyles: Record<string, StateStyle> = {
    ...DEFAULT_STATE_STYLES,
    ...((cfg.stateColors as Record<string, StateStyle>) ?? {}),
  };

  const metricCol =
    cfgStr("metricColumn") ||
    firstColumn(availableColumns, ["soc", "battery", "progress", "percent"]);

  return {
    titleCol,
    subtitleCol:
      cfgStr("subtitleColumn") ||
      firstColumn(availableColumns, [
        "farm",
        "site",
        "region",
        "location",
        "subtitle",
        "description",
      ]),
    stateCol:
      cfgStr("stateColumn") ||
      firstColumn(availableColumns, ["state", "status"]),
    metricCol,
    metricLabel:
      cfgStr("metricLabel") || (metricCol ? titleCase(metricCol) : ""),
    metricUnit: cfgStr("metricUnit") ?? "%",
    metricMax: typeof cfg.metricMax === "number" ? cfg.metricMax : 100,
    severityCol:
      cfgStr("severityColumn") ||
      firstColumn(availableColumns, ["severity", "alert_severity"]),
    timestampCol:
      cfgStr("timestampColumn") ||
      firstColumn(availableColumns, ["last_seen", "updated_at", "timestamp"]),
    stateStyles,
  };
}

function FleetCard({ row, m }: { row: Record<string, unknown>; m: Mapping }) {
  const title = row[m.titleCol] != null ? String(row[m.titleCol]) : "";
  const subtitle =
    m.subtitleCol && row[m.subtitleCol] != null
      ? String(row[m.subtitleCol])
      : "";
  const stateRaw =
    m.stateCol && row[m.stateCol] != null
      ? String(row[m.stateCol]).toLowerCase()
      : "";
  const style = m.stateStyles[stateRaw] ?? FALLBACK_STYLE;
  const severity =
    m.severityCol && row[m.severityCol] != null
      ? String(row[m.severityCol]).toLowerCase()
      : "";
  const ts = m.timestampCol ? row[m.timestampCol] : null;

  const metricValue =
    m.metricCol && row[m.metricCol] != null ? Number(row[m.metricCol]) : NaN;
  const hasMetric = Number.isFinite(metricValue);
  const metricClamped = hasMetric
    ? Math.max(0, Math.min(m.metricMax, metricValue))
    : 0;
  const metricPct = m.metricMax > 0 ? (metricClamped / m.metricMax) * 100 : 0;
  const metricBarColor =
    metricPct > 60
      ? "bg-emerald-500"
      : metricPct > 25
        ? "bg-amber-500"
        : "bg-red-500";

  const stateLabel =
    style.label ?? (stateRaw ? titleCase(stateRaw) : "Unknown");

  return (
    <div
      className="group relative overflow-hidden rounded-lg border border-border bg-card/50 backdrop-blur-sm
                 transition-all duration-150 hover:bg-card hover:border-border/80 hover:-translate-y-0.5
                 hover:shadow-[0_8px_24px_-8px_rgba(0,0,0,0.3)]"
    >
      <div
        className={`absolute left-0 top-0 bottom-0 w-[3px] ${style.stripe}`}
      />
      <div className="p-3.5 pl-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[13px] font-semibold tracking-tight text-foreground truncate">
                {title}
              </span>
              {severity && SEVERITY_BADGE[severity] && (
                <span
                  className={`rounded-full border px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide ${SEVERITY_BADGE[severity]}`}
                >
                  {severity}
                </span>
              )}
            </div>
            {subtitle && (
              <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {subtitle}
              </div>
            )}
          </div>
          {m.stateCol && (
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${style.pill}`}
            >
              {stateLabel}
            </span>
          )}
        </div>

        {(hasMetric || ts != null) && (
          <div className="mt-3 flex items-center justify-between text-[11px]">
            {hasMetric ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="font-mono tabular-nums text-foreground/80">
                  {metricValue.toFixed(0)}
                  {m.metricUnit}
                </span>
                <div className="relative h-1 w-16 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`absolute inset-y-0 left-0 ${metricBarColor} transition-all`}
                    style={{ width: `${metricPct}%` }}
                  />
                </div>
              </div>
            ) : (
              <span />
            )}
            {ts != null ? (
              <span className="text-muted-foreground tabular-nums">
                {relativeTime(ts)}
              </span>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

export function FleetGridPanel({ panel }: FleetGridPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const panelData = usePanelData({ panel });
  const useConnection = panelData.sourceType === "connection";
  const rows = useMemo(
    () => panelData.connectionMeta?.rows ?? [],
    [panelData.connectionMeta?.rows],
  );
  const columns = useMemo(
    () => panelData.connectionMeta?.columns ?? [],
    [panelData.connectionMeta?.columns],
  );

  const mapping = useMemo(() => {
    if (!useConnection || columns.length === 0) return null;
    return resolveMapping(
      (panel.config ?? {}) as Record<string, unknown>,
      columns.map((c) => c.name),
    );
  }, [panel.config, columns, useConnection]);

  const filtered = useMemo(() => {
    if (!mapping) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      Object.values(r).some((v) =>
        String(v ?? "")
          .toLowerCase()
          .includes(q),
      ),
    );
  }, [mapping, rows, searchQuery]);

  if (!useConnection) {
    return (
      <PanelEmptyState
        reason="no_source"
        debugInfo={{ sourceType: "realtime" }}
      />
    );
  }

  if (panelData.isLoading && rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (panelData.error) {
    return (
      <PanelEmptyState
        reason="query_error"
        debugInfo={{
          sourceType: "connection",
          errorMessage: String(panelData.error),
        }}
      />
    );
  }

  if (!mapping) {
    return (
      <PanelEmptyState
        reason="transform_failed"
        debugInfo={{
          sourceType: "connection",
          columns: columns.map((c) => c.name),
          errorMessage:
            "Can't find a title column. Add a `name`/`slug`/`id` column, or set `titleColumn` in panel config.",
        }}
      />
    );
  }

  if (rows.length === 0) {
    return (
      <PanelEmptyState
        reason="no_data"
        debugInfo={{ sourceType: "connection" }}
      />
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <PanelFilterBar
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Filter items"
        count={filtered.length}
        total={rows.length}
      />
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div
          className="grid content-start gap-2 p-3"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}
        >
          {filtered.map((row, i) => (
            <FleetCard
              key={String(row[mapping.titleCol] ?? i)}
              row={row as Record<string, unknown>}
              m={mapping}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
