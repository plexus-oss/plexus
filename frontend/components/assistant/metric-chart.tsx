"use client";

import { useRef, useState } from "react";
import { Activity, Gauge, Thermometer } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MetricSeries, Severity } from "@/lib/triage/types";

/**
 * Charts as evidence the operator can actually read. Two surfaces share one
 * interactive plot:
 *   • MetricPanel — a compact, clickable tile for the page. Calm: just the curve
 *     and a crosshair. Its big number scrubs with the cursor, and in a synced
 *     grid every tile reads out the same instant. Click to open the full view.
 *   • MetricChartCard — the full, labeled chart for the SignalSheet, with axes,
 *     threshold, the cause marker, and a now/prior legend.
 *
 * Hand-drawn SVG so we can render several without a WebGL context per chart.
 */

function accentText(severity: Severity): string {
  return severity === "critical"
    ? "text-red-400"
    : severity === "warning"
      ? "text-amber-400"
      : "text-foreground/70";
}

/** Renders the unit-appropriate icon directly (stable module-level components). */
function MetricIcon({ unit, className }: { unit?: string; className?: string }) {
  if (unit === "°C") return <Thermometer className={className} />;
  if (unit === "%") return <Gauge className={className} />;
  return <Activity className={className} />;
}

function deltaOf(m: MetricSeries) {
  if (m.baseline == null || m.baseline === 0) return null;
  const pct = ((m.current - m.baseline) / m.baseline) * 100;
  const higherIsWorse = m.higherIsWorse ?? true;
  return { pct, bad: higherIsWorse ? pct > 0 : pct < 0 };
}

/** Compact axis ticks — k-suffixed so big numbers stay narrow. */
function fmt(n: number) {
  return Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}

/** Readout values — full magnitude, no k-suffix, so the operator reads truth. */
function fmtVal(n: number) {
  const r = Math.round(n * 10) / 10;
  return (Number.isInteger(r) ? r : r.toFixed(1)).toString();
}

/** Interpolate a clock label (e.g. "13:55"→"14:20") to a fraction across it. */
function timeAt(t: number, start?: string, end?: string): string | null {
  const toMin = (s?: string) => {
    const m = s?.match(/(\d{1,2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const a = toMin(start);
  const b = toMin(end);
  if (a == null || b == null) return null;
  const mins = Math.round(a + (b - a) * t);
  const hh = Math.floor(mins / 60) % 24;
  const mm = mins % 60;
  return `${hh.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}`;
}

/** Index of the sample nearest a 0–1 cursor position. */
function snapIndex(t: number | null | undefined, n: number): number | null {
  return t == null ? null : Math.round(t * (n - 1));
}

/**
 * The interactive plot. `compact` strips it to the curve + crosshair for tiles;
 * full mode adds gridlines, threshold, the cause marker, and the prior trace.
 * Hover position is controlled (for synced grids) or self-managed when omitted.
 */
function PlotInner({
  metric,
  severity,
  hoverT,
  onHoverChange,
  start,
  end,
  compact = false,
}: {
  metric: MetricSeries;
  severity: Severity;
  hoverT?: number | null;
  onHoverChange?: (t: number | null) => void;
  start?: string;
  end?: string;
  compact?: boolean;
}) {
  const { data, prior, threshold } = metric;
  const plotRef = useRef<HTMLDivElement>(null);
  const [localT, setLocalT] = useState<number | null>(null);
  const isControlled = hoverT !== undefined;
  const t = isControlled ? hoverT : localT;

  const setT = (v: number | null) => {
    if (!isControlled) setLocalT(v);
    onHoverChange?.(v);
  };

  // Tiles fit the curve tightly; the full chart leaves room for prior + threshold.
  const pool = compact
    ? [...data]
    : [...data, ...(prior ?? []), ...(threshold != null ? [threshold] : [])];
  const lo0 = Math.min(...pool);
  const hi0 = Math.max(...pool);
  const pad = (hi0 - lo0) * 0.15 || 1;
  const lo = lo0 - pad;
  const hi = hi0 + pad;
  const y = (v: number) => ((hi - v) / (hi - lo)) * 100;
  const px = (i: number, n: number) => (i / (n - 1)) * 100;
  const line = (arr: number[]) =>
    arr.map((v, i) => `${px(i, arr.length).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const area = `0,100 ${line(data)} 100,100`;
  const color = accentText(severity);
  const gradId = `fill-${metric.label.replace(/\W+/g, "-")}-${compact ? "c" : "f"}`;

  const idx = snapIndex(t, data.length);
  const snapX = idx == null ? null : px(idx, data.length);
  const nowVal = idx == null ? null : data[idx];
  const priorVal = idx == null || !prior ? null : prior[idx];
  const label = snapX == null ? null : timeAt(snapX / 100, start, end);

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    setT(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
  };

  return (
    <div
      ref={plotRef}
      className={cn("relative h-full cursor-crosshair", color)}
      onMouseMove={handleMove}
      onMouseLeave={() => setT(null)}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full overflow-visible">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity={compact ? 0.12 : 0.16} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
          </linearGradient>
        </defs>

        {!compact && (
          <>
            {[hi, (hi + lo) / 2, lo].map((tk, i) => (
              <line
                key={i}
                x1="0"
                x2="100"
                y1={y(tk)}
                y2={y(tk)}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                className="stroke-foreground/[0.06]"
              />
            ))}
            {threshold != null && (
              <line
                x1="0"
                x2="100"
                y1={y(threshold)}
                y2={y(threshold)}
                strokeWidth={1}
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
                className="stroke-foreground/30"
              />
            )}
            {metric.onsetAt != null && (
              <line
                x1={metric.onsetAt * 100}
                x2={metric.onsetAt * 100}
                y1="0"
                y2="100"
                strokeWidth={1}
                strokeDasharray="2 2"
                vectorEffect="non-scaling-stroke"
                className="stroke-foreground/25"
              />
            )}
            {prior && (
              <polyline
                points={line(prior)}
                fill="none"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                className="stroke-foreground/20"
              />
            )}
          </>
        )}

        <polygon points={area} fill={`url(#${gradId})`} />
        <polyline
          points={line(data)}
          fill="none"
          strokeWidth={compact ? 1.75 : 2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          stroke="currentColor"
        />
      </svg>

      {/* crosshair — vertical guide + snapped dots */}
      {snapX != null && (
        <>
          <span
            className="pointer-events-none absolute bottom-0 top-0 w-px bg-muted-foreground/40"
            style={{ left: `${snapX}%` }}
            aria-hidden
          />
          {!compact && priorVal != null && (
            <span
              className="pointer-events-none absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/40"
              style={{ left: `${snapX}%`, top: `${y(priorVal)}%` }}
              aria-hidden
            />
          )}
          {nowVal != null && (
            <span
              className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current ring-2 ring-background"
              style={{ left: `${snapX}%`, top: `${y(nowVal)}%` }}
              aria-hidden
            />
          )}
        </>
      )}

      {/* full-chart chrome: threshold label, cause marker, floating readout */}
      {!compact && threshold != null && (
        <span
          className="pointer-events-none absolute right-0 -translate-y-1/2 rounded bg-background/80 px-1 text-3xs text-muted-foreground"
          style={{ top: `${y(threshold)}%` }}
        >
          {fmt(threshold)}
          {metric.unit}
        </span>
      )}
      {!compact && metric.onsetAt != null && metric.onsetLabel && (
        <span
          className="pointer-events-none absolute top-0 -translate-x-1/2 whitespace-nowrap rounded bg-foreground/10 px-1.5 py-0.5 text-3xs text-foreground/80"
          style={{ left: `${metric.onsetAt * 100}%` }}
        >
          {metric.onsetLabel}
        </span>
      )}
      {!compact && nowVal != null && (
        <span
          className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-2xs shadow-sm"
          style={{ left: `${Math.min(88, Math.max(12, snapX!))}%` }}
        >
          <span className="font-semibold tabular-nums text-foreground">
            {fmtVal(nowVal)}
            {metric.unit ? <span className="text-muted-foreground"> {metric.unit}</span> : null}
          </span>
          {label && (
            <span className="ml-2 font-mono tabular-nums text-muted-foreground/80">{label}</span>
          )}
        </span>
      )}
    </div>
  );
}

/**
 * A compact, clickable metric tile for the page. The headline number scrubs with
 * the crosshair; in a synced grid every tile reads out the same moment.
 */
export function MetricPanel({
  metric,
  severity,
  hoverT,
  onHoverChange,
  onClick,
  start,
  end,
}: {
  metric: MetricSeries;
  severity: Severity;
  hoverT?: number | null;
  onHoverChange?: (t: number | null) => void;
  onClick?: () => void;
  start?: string;
  end?: string;
}) {
  const accent = accentText(severity);
  const delta = deltaOf(metric);
  const idx = snapIndex(hoverT, metric.data.length);
  const shownVal = idx == null ? metric.current : metric.data[idx];
  const time = idx == null ? null : timeAt(idx / (metric.data.length - 1), start, end);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full flex-col rounded-lg border border-border/60 bg-card/40 p-3 text-left transition-colors hover:border-border hover:bg-card/70"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-2xs text-muted-foreground">{metric.label}</span>
        {delta && (
          <span
            className={cn(
              "shrink-0 text-2xs font-medium tabular-nums",
              delta.bad ? accent : "text-muted-foreground/70",
            )}
          >
            {delta.pct > 0 ? "↑" : "↓"}
            {Math.abs(Math.round(delta.pct))}%
          </span>
        )}
      </div>

      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-lg font-semibold tabular-nums">{fmtVal(shownVal)}</span>
        {metric.unit && <span className="text-2xs text-muted-foreground">{metric.unit}</span>}
        {time && (
          <span className="ml-auto font-mono text-3xs tabular-nums text-muted-foreground/60">
            {time}
          </span>
        )}
      </div>

      <div className="mt-2 h-12">
        <PlotInner
          metric={metric}
          severity={severity}
          hoverT={hoverT}
          onHoverChange={onHoverChange}
          start={start}
          end={end}
          compact
        />
      </div>
    </button>
  );
}

/** The full, labeled chart — used in the SignalSheet deep dive. */
export function MetricChartCard({
  metric,
  severity,
  start,
  end,
  hero = false,
}: {
  metric: MetricSeries;
  severity: Severity;
  start?: string;
  end?: string;
  hero?: boolean;
}) {
  const delta = deltaOf(metric);
  const accent = accentText(severity);
  const height = hero ? "h-44" : "h-28";

  return (
    <div className="rounded-xl border border-border bg-card/40 p-4">
      {/* label + delta */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-foreground/[0.06]">
            <MetricIcon unit={metric.unit} className={cn("h-3.5 w-3.5", accent)} />
          </span>
          <span className="text-xs text-muted-foreground">{metric.label}</span>
        </div>
        {delta && (
          <span
            className={cn(
              "text-xs font-medium tabular-nums",
              delta.bad ? accent : "text-muted-foreground",
            )}
          >
            {delta.pct > 0 ? "↑" : "↓"}
            {Math.abs(Math.round(delta.pct))}% vs prior
          </span>
        )}
      </div>

      {/* big value + legend */}
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-1.5">
          <span className={cn("font-semibold tabular-nums", hero ? "text-3xl" : "text-2xl")}>
            {fmt(metric.current)}
          </span>
          {metric.unit && <span className="text-sm text-muted-foreground">{metric.unit}</span>}
        </div>
        {metric.prior && (
          <div className="flex items-center gap-3 text-3xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className={cn("h-1.5 w-1.5 rounded-full bg-current", accent)} />
              now
            </span>
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-foreground/25" />
              prior
            </span>
          </div>
        )}
      </div>

      {/* chart */}
      <div className="mt-4">
        <div className="flex gap-2">
          <div
            className={cn(
              "flex w-8 shrink-0 flex-col justify-between text-right text-3xs tabular-nums text-muted-foreground/70",
              height,
            )}
          >
            <Ticks metric={metric} />
          </div>
          <div className={cn("flex-1", height)}>
            <PlotInner metric={metric} severity={severity} start={start} end={end} />
          </div>
        </div>
        {(start || end) && (
          <div className="ml-10 mt-1.5 flex justify-between text-3xs tabular-nums text-muted-foreground/70">
            <span>{start}</span>
            <span>{end}</span>
          </div>
        )}
      </div>

      {hero && metric.caption && (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{metric.caption}</p>
      )}
    </div>
  );
}

/** Three y-axis ticks (hi / mid / lo) matching the full chart's domain. */
function Ticks({ metric }: { metric: MetricSeries }) {
  const { data, prior, threshold } = metric;
  const pool = [...data, ...(prior ?? []), ...(threshold != null ? [threshold] : [])];
  const lo0 = Math.min(...pool);
  const hi0 = Math.max(...pool);
  const pad = (hi0 - lo0) * 0.15 || 1;
  const lo = lo0 - pad;
  const hi = hi0 + pad;
  return (
    <>
      {[hi, (hi + lo) / 2, lo].map((tk, i) => (
        <span key={i}>{fmt(Math.round(tk))}</span>
      ))}
    </>
  );
}
