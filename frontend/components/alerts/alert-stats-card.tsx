"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { AlertStatsResult } from "@/hooks/use-alert-stats";

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

function formatValue(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function useLiveDuration(openedAt: number): string {
  const [elapsed, setElapsed] = useState(() => Date.now() / 1000 - openedAt);
  useEffect(() => {
    const id = setInterval(
      () => setElapsed(Date.now() / 1000 - openedAt),
      1_000,
    );
    return () => clearInterval(id);
  }, [openedAt]);
  return formatDuration(elapsed);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
      <span className="text-sm font-medium tabular-nums">{value}</span>
    </div>
  );
}

function RecoveringBar({ progress }: { progress: number }) {
  const pct = Math.min(Math.max(progress, 0), 1);
  return (
    <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/50">
      <span className="text-[10px] text-muted-foreground shrink-0">
        Recovering
      </span>
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-amber-500/70 transition-all duration-1000"
          style={{ width: `${pct * 100}%` }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
        {Math.round(pct * 100)}%
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export function AlertStatsCard({ stats }: { stats: AlertStatsResult }) {
  const liveDuration = useLiveDuration(
    stats.kind === "live" ? stats.data.opened_at : 0,
  );

  if (stats.kind === "none") return null;

  const isLive = stats.kind === "live";
  const data = stats.data;

  const duration = isLive
    ? liveDuration
    : formatDuration(
        (data as import("@/lib/db/types").AlertStats).duration_seconds,
      );

  const triggerValue = isLive
    ? (data as import("@/lib/db/types").LiveStats).trigger_value
    : (data as import("@/lib/db/types").AlertStats).trigger_value;

  const peakValue = isLive
    ? (data as import("@/lib/db/types").LiveStats).peak_value
    : (data as import("@/lib/db/types").AlertStats).peak_value;

  const points = isLive
    ? (data as import("@/lib/db/types").LiveStats).data_point_count
    : (data as import("@/lib/db/types").AlertStats).data_point_count;

  const recovering =
    isLive &&
    (data as import("@/lib/db/types").LiveStats).state === "recovering" &&
    (data as import("@/lib/db/types").LiveStats).hysteresis_progress != null;

  const progress = recovering
    ? ((data as import("@/lib/db/types").LiveStats).hysteresis_progress ?? 0)
    : 0;

  return (
    <div
      className={cn(
        "rounded-lg border bg-muted/30 p-3",
        isLive && "border-amber-500/30",
      )}
    >
      <div className="flex items-center gap-4">
        <StatCell label="Duration" value={duration} />
        <div className="h-6 w-px bg-border/50" />
        <StatCell label="Trigger" value={formatValue(triggerValue)} />
        <div className="h-6 w-px bg-border/50" />
        <StatCell label="Peak" value={formatValue(peakValue)} />
        <div className="h-6 w-px bg-border/50" />
        <StatCell label="Points" value={String(points)} />
      </div>
      {recovering && <RecoveringBar progress={progress} />}
    </div>
  );
}
