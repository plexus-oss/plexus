"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useDashboard } from "@/hooks/use-dashboards";
import { useTelemetryData } from "@/components/dashboard/telemetry-provider";
import { useSharedQueryContext } from "@/components/dashboard/shared-query-context";
import type { Panel } from "@/lib/types/dashboard";
import { cn } from "@/lib/utils";
import { ArrowRight, LayoutDashboard } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";

interface DashboardPanelProps {
  panel: Panel;
  isEditing?: boolean;
}

type Sev = "crit" | "warn" | "ok" | "idle";

interface CardMetric {
  metric: string;
  label?: string;
  unit?: string;
  decimals?: number;
  warnAbove?: number;
  critAbove?: number;
  warnBelow?: number;
  critBelow?: number;
}

// Theme-aware severity styles. Healthy is green; warn/crit use the standard
// red/amber. Everything else (surface, text) rides the app theme tokens so the
// card adapts to light / dark / fun mode instead of being hardcoded.
const SEV: Record<Sev, {
  badge: string; dot: string; value: string; spark: string; border: string; label: string;
}> = {
  crit: {
    badge: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30",
    dot: "bg-red-500", value: "text-red-600 dark:text-red-400",
    spark: "text-red-500", border: "border-red-500/40", label: "Critical",
  },
  warn: {
    badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
    dot: "bg-amber-500", value: "text-amber-600 dark:text-amber-400",
    spark: "text-amber-500", border: "border-amber-500/30", label: "Degraded",
  },
  ok: {
    badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25",
    dot: "bg-emerald-500", value: "text-foreground",
    spark: "text-muted-foreground/70", border: "border-border", label: "Healthy",
  },
  idle: {
    badge: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground", value: "text-muted-foreground",
    spark: "text-muted-foreground/50", border: "border-border", label: "Offline",
  },
};

const worse = (a: Sev, b: Sev): Sev => {
  const r: Record<Sev, number> = { crit: 3, warn: 2, ok: 1, idle: 0 };
  return r[a] >= r[b] ? a : b;
};

function metricSev(v: number, m: CardMetric): Sev {
  if (m.critAbove !== undefined && v >= m.critAbove) return "crit";
  if (m.critBelow !== undefined && v <= m.critBelow) return "crit";
  if (m.warnAbove !== undefined && v >= m.warnAbove) return "warn";
  if (m.warnBelow !== undefined && v <= m.warnBelow) return "warn";
  return "ok";
}

/** Inline Vercel-style sparkline — inherits color via `currentColor`. */
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return <svg className="h-4 w-full" aria-hidden />;
  const w = 64, h = 16;
  const min = Math.min(...points), max = Math.max(...points);
  const range = max - min || 1;
  const d = points
    .map((v, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - 1.5 - ((v - min) / range) * (h - 3);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-4 w-16">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.25}
        strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function DashboardPanel({ panel, isEditing }: DashboardPanelProps) {
  const router = useRouter();
  const dashboardId = panel.config.dashboardId;
  const { dashboard, isLoading, error } = useDashboard(dashboardId || null);

  const shared = useSharedQueryContext();
  const isShared = !!shared;
  const sharedToken = panel.config.sharedToken;
  const cardName = panel.config.cardName || dashboard?.name;
  const cardSubtitle = panel.config.cardSubtitle ?? dashboard?.description ?? undefined;

  const cardMetrics: CardMetric[] =
    (panel.config.cardMetrics as CardMetric[] | undefined) ??
    (panel.config.previewMetrics || []).map((metric) => ({ metric }));
  const statusMetric = panel.config.statusMetric;

  const allMetrics = Array.from(
    new Set([...cardMetrics.map((m) => m.metric), ...(statusMetric ? [statusMetric] : [])]),
  );
  const { data } = useTelemetryData(
    allMetrics,
    { type: "relative", value: "5m" },
    { panelId: panel.id },
  );

  const latest = (metric: string): number | null => {
    const series = data?.[metric];
    if (!series || series.length === 0) return null;
    const v = series[series.length - 1]?.value;
    return typeof v === "number" ? v : null;
  };
  const recentVals = (metric: string): number[] => {
    const series = data?.[metric];
    if (!series) return [];
    return series.slice(-40).map((p) => p.value).filter((v): v is number => typeof v === "number");
  };

  // Freshness → live/offline. A ticking clock lets the card flip to offline
  // when telemetry stops arriving, even without a new render from the data hook.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  const freshKey = statusMetric || cardMetrics[0]?.metric;
  const freshTs = freshKey ? data?.[freshKey]?.[data[freshKey].length - 1]?.timestamp : undefined;
  const fresh = !!freshTs && now - new Date(freshTs).getTime() < 30_000;

  // Card severity = worst metric severity, gated by freshness.
  let severity: Sev = fresh ? "ok" : "idle";
  if (fresh) {
    for (const m of cardMetrics) {
      const v = latest(m.metric);
      if (v != null) severity = worse(severity, metricSev(v, m));
    }
  }
  const sm = SEV[severity];

  const clickable = !isEditing && (isShared ? !!sharedToken : !!dashboard);
  const handleClick = () => {
    if (isEditing) return;
    const target =
      isShared && sharedToken ? `/shared/${sharedToken}` : dashboard ? `/dashboards/${dashboard.id}` : null;
    if (target) router.push(target);
  };

  if (!dashboardId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card text-muted-foreground">
        <LayoutDashboard className="h-7 w-7 opacity-40" />
        <span className="text-xs">No dashboard linked</span>
      </div>
    );
  }
  if (!isShared && isLoading) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-border bg-card">
        <Spinner />
      </div>
    );
  }
  if (!isShared && (error || !dashboard)) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-border bg-card text-xs text-muted-foreground">
        Dashboard unavailable
      </div>
    );
  }

  const rows = cardMetrics.slice(0, 3);

  return (
    <div
      onClick={handleClick}
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-xl border bg-card p-3.5 shadow-sm transition-colors duration-150",
        sm.border,
        clickable && "cursor-pointer hover:border-foreground/20 hover:bg-accent/40 hover:shadow-md",
      )}
    >
      {/* header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-mono text-[13px] font-medium tracking-tight text-foreground">
            {cardName ?? "Dashboard"}
          </h3>
          {cardSubtitle && (
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{cardSubtitle}</p>
          )}
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium",
            sm.badge,
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", sm.dot, severity === "crit" && "animate-pulse")} />
          {sm.label}
        </span>
      </div>

      {/* metric rows — label · value chip · inline sparkline (Vercel-style) */}
      <div className="mt-auto flex flex-col gap-1.5 border-t border-border pt-2.5">
        {rows.map((m) => {
          const v = latest(m.metric);
          const sv: Sev = v == null ? "idle" : metricSev(v, m);
          const s = SEV[sv];
          const dec = m.decimals ?? (v != null && v % 1 !== 0 ? 1 : 0);
          return (
            <div key={m.metric} className="flex items-center justify-between gap-2">
              <span className="truncate text-[11px] text-muted-foreground">
                {m.label || m.metric.split(":").pop()}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={cn(
                    "inline-flex h-5 items-center rounded-md bg-muted px-1.5 font-mono text-[12px] font-medium tabular-nums",
                    s.value,
                  )}
                >
                  {v == null ? "—" : v.toFixed(dec)}
                  {m.unit && <span className="ml-0.5 text-muted-foreground">{m.unit}</span>}
                </span>
                <span className={s.spark}>
                  <Sparkline points={recentVals(m.metric)} />
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {clickable && (
        <div className="pointer-events-none absolute bottom-2.5 right-3 flex items-center gap-1 text-[10px] font-medium text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
          Open <ArrowRight className="h-3 w-3" />
        </div>
      )}
    </div>
  );
}
