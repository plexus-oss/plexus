"use client";

/**
 * Mini time scrubber — an ingest-volume histogram of the dashboard's
 * telemetry over the full extent of its data, capped at 30 days. A draggable
 * window marks the current time range: drag the body to move it, the edge
 * handles to resize, or draw on the empty track to select a fresh window.
 * Commits an absolute range on release; the toolbar's "Live" button restores
 * relative mode. Hidden via displaySettings.showScrubber (default on).
 *
 * Volume comes from /api/telemetry/overview (exact per-bucket row counts from
 * the 1-min rollup). Two-step fetch: a 30d call discovers the data extent;
 * when the extent is much shorter, a refined call re-buckets to it so short
 * spans get fine-grained bars. Bars are absolutely positioned from the same
 * extent→% mapping as the selection window, so both stay time-aligned.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { useRuns } from "@/hooks/use-runs";
import { useDashboardInteraction } from "./dashboard-interaction-context";
import { useFormattedTime } from "@/hooks/use-formatted-time";
import { formatDateTimeInZone } from "@/lib/timezone";
import {
  isConnectionSource,
  parseRelativeTime,
  type Panel,
  type TimeRange,
} from "@/lib/types/dashboard";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";

const MAX_EXTENT_MS = 30 * 24 * 60 * 60 * 1000; // scrubber span cap: 1 month
const MIN_EXTENT_MS = 5 * 60 * 1000; // never collapse below 5 minutes
const MIN_WINDOW_MS = 10 * 1000; // smallest selectable window
const MAX_METRICS = 20; // bound the overview query
const DRAG_THRESHOLD_PX = 3; // movement before a track press draws a selection

type DragMode = "move" | "resize-left" | "resize-right" | "draw";

interface TimeWindow {
  start: number;
  end: number;
}

interface OverviewResponse {
  buckets: Array<{ t: string; count: number }>;
  earliest: string | null;
  start: string;
  end: string;
  bucketSeconds: number;
  serverNow: number;
  /** serverNow − client Date.now(), stamped at fetch time (not in render) */
  clockOffset: number;
}

const overviewFetcher = async (url: string): Promise<OverviewResponse> => {
  const d = await fetcher(url);
  return { ...d, clockOffset: (d.serverNow ?? Date.now()) - Date.now() };
};

interface MiniScrubberProps {
  panels: Panel[];
  timeRange: TimeRange;
  onTimeRangeChange: (timeRange: TimeRange) => void;
}

const clampPct = (n: number) => Math.max(0, Math.min(100, n));

export function MiniScrubber({
  panels,
  timeRange,
  onTimeRangeChange,
}: MiniScrubberProps) {
  const { setViewWindow } = useDashboardInteraction();
  const { timezone, use12Hour } = useFormattedTime();

  // Local clock tick for the strip's right edge (15s cadence so the strip
  // doesn't lag real time), without reading the impure Date.now() in render.
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const metrics = useMemo(() => {
    const set = new Set<string>();
    for (const panel of panels) {
      if (isConnectionSource(panel.dataSource)) continue;
      for (const m of panel.metrics || []) {
        if (set.size >= MAX_METRICS) break;
        set.add(m);
      }
    }
    return Array.from(set).sort();
  }, [panels]);

  // Step 1: coarse 30d overview discovers the data extent.
  const baseUrl =
    metrics.length > 0
      ? `/api/telemetry/overview?metrics=${encodeURIComponent(metrics.join(","))}`
      : null;
  const { data: coarse, isLoading } = useSWR<OverviewResponse>(
    baseUrl,
    overviewFetcher,
    { refreshInterval: 60_000, revalidateOnFocus: false },
  );

  // Step 2: when the data extent is much shorter than 30d, re-bucket to it so
  // a few hours of data gets minute-level bars instead of two 3h blocks.
  const refinedStart = useMemo(() => {
    if (!coarse?.earliest) return null;
    const earliest = Date.parse(coarse.earliest);
    const end = Date.parse(coarse.end);
    if (!Number.isFinite(earliest) || !Number.isFinite(end)) return null;
    return end - earliest < MAX_EXTENT_MS * 0.75 ? coarse.earliest : null;
  }, [coarse]);
  const { data: refined } = useSWR<OverviewResponse>(
    baseUrl && refinedStart
      ? `${baseUrl}&start=${encodeURIComponent(refinedStart)}`
      : null,
    overviewFetcher,
    { refreshInterval: 60_000, revalidateOnFocus: false },
  );

  const overview = refined ?? coarse;

  // Server/client clock offset, so the strip's "now" matches the backend's.
  const now = tick + (overview?.clockOffset ?? 0);

  // Data extent: earliest point → now, capped at 30d and floored at 5m so a
  // single burst still renders a strip. With no data (yet) the strip still
  // renders, spanning the full 30d window.
  const extent = useMemo(() => {
    const end = now;
    const earliest = overview?.earliest
      ? Date.parse(overview.earliest)
      : NaN;
    const start = !Number.isFinite(earliest)
      ? end - MAX_EXTENT_MS
      : Math.min(Math.max(earliest, end - MAX_EXTENT_MS), end - MIN_EXTENT_MS);
    return { start, end };
  }, [overview, now]);

  // Track width drives bucket count; callback ref because the track only
  // mounts once data arrives.
  const [trackEl, setTrackEl] = useState<HTMLDivElement | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  useEffect(() => {
    if (!trackEl) return;
    const ro = new ResizeObserver((entries) => {
      setTrackWidth(entries[0]?.contentRect.width ?? 0);
    });
    ro.observe(trackEl);
    return () => ro.disconnect();
  }, [trackEl]);

  // Volume bars: absolutely positioned on the same extent→% mapping as the
  // selection window (one coordinate system — no drift between bars and
  // window). Heights are sqrt-scaled so steady trickles stay visible next to
  // bursts.
  const bars = useMemo(() => {
    if (!overview) return [];
    const duration = extent.end - extent.start;
    const widthPct = ((overview.bucketSeconds * 1000) / duration) * 100;
    const max = Math.max(...overview.buckets.map((b) => b.count), 1);
    const out: Array<{ left: number; width: number; height: number }> = [];
    for (const b of overview.buckets) {
      const t = Date.parse(b.t);
      if (!Number.isFinite(t) || b.count <= 0) continue;
      const rawLeft = ((t - extent.start) / duration) * 100;
      const rawRight = rawLeft + widthPct;
      if (rawLeft >= 100 || rawRight <= 0) continue;
      const left = clampPct(rawLeft);
      out.push({
        left,
        width: Math.max(clampPct(rawRight) - left, 0.2),
        height: Math.max(Math.sqrt(b.count / max) * 100, 8),
      });
    }
    return out;
  }, [overview, extent]);

  // The committed window, derived against the extent's "now" so live ranges
  // hug the right edge as overview data refreshes.
  const committedWindow = useMemo<TimeWindow | null>(() => {
    if (timeRange.type === "absolute") {
      const [startStr, endStr] = timeRange.value.split("/");
      const start = new Date(startStr).getTime();
      const end = endStr ? new Date(endStr).getTime() : extent.end;
      if (Number.isNaN(start) || Number.isNaN(end)) return null;
      return { start, end };
    }
    return {
      start: extent.end - parseRelativeTime(timeRange.value),
      end: extent.end,
    };
  }, [extent, timeRange]);

  const [dragPreview, setDragPreview] = useState<TimeWindow | null>(null);
  const [dragging, setDragging] = useState(false);

  const commitWindow = useCallback(
    (w: TimeWindow) => {
      onTimeRangeChange({
        type: "absolute",
        value: `${new Date(w.start).toISOString()}/${new Date(w.end).toISOString()}`,
      });
    },
    [onTimeRangeChange],
  );

  const beginDrag = useCallback(
    (e: React.PointerEvent, mode: DragMode) => {
      if (!trackEl || e.button !== 0) return;
      const orig = dragPreview ?? committedWindow;
      if (mode !== "draw" && !orig) return;
      e.preventDefault();
      e.stopPropagation();

      const rect = trackEl.getBoundingClientRect();
      const duration = extent.end - extent.start;
      const timeAt = (clientX: number) =>
        extent.start + ((clientX - rect.left) / rect.width) * duration;

      const startClientX = e.clientX;
      const anchorTime = timeAt(e.clientX);
      // Window at drag start; only meaningful for move/resize (guarded above).
      const base: TimeWindow = orig ?? { start: anchorTime, end: anchorTime };
      let moved = false;
      let last: TimeWindow | null = null;

      const onMove = (ev: PointerEvent) => {
        if (!moved && Math.abs(ev.clientX - startClientX) < DRAG_THRESHOLD_PX)
          return;
        moved = true;
        setDragging(true);
        const t = timeAt(ev.clientX);
        let next: TimeWindow;
        if (mode === "move") {
          const w = base.end - base.start;
          const start = Math.max(
            extent.start,
            Math.min(base.start + (t - anchorTime), extent.end - w),
          );
          next = { start, end: start + w };
        } else if (mode === "resize-left") {
          const start = Math.max(
            extent.start,
            Math.min(t, base.end - MIN_WINDOW_MS),
          );
          next = { start, end: base.end };
        } else if (mode === "resize-right") {
          const end = Math.min(
            extent.end,
            Math.max(t, base.start + MIN_WINDOW_MS),
          );
          next = { start: base.start, end };
        } else {
          const start = Math.max(extent.start, Math.min(anchorTime, t));
          const end = Math.min(extent.end, Math.max(anchorTime, t));
          next = { start, end: Math.max(end, start + MIN_WINDOW_MS) };
        }
        last = next;
        setDragPreview(next);
        // Instant chart-domain feedback without refetch; the interaction
        // context clears it once the committed range propagates back.
        setViewWindow(next);
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setDragging(false);
        setDragPreview(null);
        if (last) {
          commitWindow(last);
        } else {
          setViewWindow(null);
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [extent, trackEl, committedWindow, dragPreview, setViewWindow, commitWindow],
  );

  const duration = extent.end - extent.start;

  // Test runs as labeled segments on the strip — the timeline explains itself
  // (this is where runs become discoverable, not a hidden library). Click one
  // to frame it.
  const { runs } = useRuns();
  const runBands = useMemo(() => {
    return runs
      .map((r) => {
        const start = new Date(r.started_at).getTime();
        const end = r.ended_at ? new Date(r.ended_at).getTime() : extent.end;
        return { run: r, start, end };
      })
      .filter(
        (b) =>
          Number.isFinite(b.start) &&
          b.end > extent.start &&
          b.start < extent.end,
      )
      .map((b) => {
        const left = clampPct(
          ((Math.max(b.start, extent.start) - extent.start) / duration) * 100,
        );
        const right = clampPct(
          ((Math.min(b.end, extent.end) - extent.start) / duration) * 100,
        );
        return { ...b, left, width: Math.max(right - left, 0.5) };
      });
  }, [runs, extent, duration]);

  const frameRun = useCallback(
    (b: { start: number; end: number }) => {
      const pad = Math.max((b.end - b.start) * 0.05, 2_000);
      commitWindow({ start: b.start - pad, end: b.end + pad });
    },
    [commitWindow],
  );

  const win = dragPreview ?? committedWindow;
  const winLeft = win ? clampPct(((win.start - extent.start) / duration) * 100) : 0;
  const winRight = win ? clampPct(((win.end - extent.start) / duration) * 100) : 0;
  const winWidth = Math.max(winRight - winLeft, 0.4);

  const fmt = (t: number) =>
    formatDateTimeInZone(new Date(t), timezone, use12Hour);

  return (
    <div className="px-2 pt-1.5 border-b border-border select-none">
      <div
        ref={setTrackEl}
        className="relative h-9 cursor-crosshair touch-none"
        onPointerDown={(e) => beginDrag(e, "draw")}
      >
        {/* Volume bars over a faint baseline; both share the window's % mapping */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-x-0 bottom-0 h-[3%] min-h-px bg-muted/40" />
          {bars.map((b, i) => (
            <div
              key={i}
              className="absolute bottom-0 rounded-t-[1px] bg-primary/50"
              style={{
                left: `${b.left}%`,
                width: `${b.width}%`,
                height: `${b.height}%`,
              }}
            />
          ))}
        </div>

        {/* Run segments — labeled, clickable, under the selection window */}
        {runBands.map((b) => (
          <button
            key={b.run.id}
            className="absolute top-0 bottom-0 bg-violet-500/10 hover:bg-violet-500/20 border-x border-violet-500/40 rounded-[2px] transition-colors cursor-pointer"
            style={{ left: `${b.left}%`, width: `${b.width}%` }}
            title={`${b.run.name} · ${fmt(b.start)} – ${
              b.run.ended_at ? fmt(b.end) : "live"
            } — click to open this run`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              frameRun(b);
            }}
          >
            {(trackWidth * b.width) / 100 > 56 && (
              <span className="absolute top-0.5 left-1 right-1 truncate text-left text-[8px] leading-none font-medium text-violet-600 dark:text-violet-400 pointer-events-none">
                {b.run.name}
              </span>
            )}
          </button>
        ))}

        {/* Centered spinner while the overview query is in flight */}
        {isLoading && !overview && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <Spinner className="w-[12px] h-[12px]" />
          </div>
        )}

        {/* Current-range window */}
        {win && (
          <div
            className={cn(
              "absolute top-0 bottom-0 bg-primary/10 border-x border-primary/40 rounded-[2px]",
              dragging ? "cursor-grabbing" : "cursor-grab",
            )}
            style={{ left: `${winLeft}%`, width: `${winWidth}%` }}
            title={`${fmt(win.start)} – ${fmt(win.end)}`}
            onPointerDown={(e) => beginDrag(e, "move")}
          >
            <div
              className="absolute -left-1 top-0 bottom-0 w-2 cursor-ew-resize"
              onPointerDown={(e) => beginDrag(e, "resize-left")}
            >
              <div className="absolute left-1 top-1/2 -translate-y-1/2 h-3 w-[3px] -translate-x-1/2 rounded-full bg-primary/70" />
            </div>
            <div
              className="absolute -right-1 top-0 bottom-0 w-2 cursor-ew-resize"
              onPointerDown={(e) => beginDrag(e, "resize-right")}
            >
              <div className="absolute right-1 top-1/2 -translate-y-1/2 h-3 w-[3px] translate-x-1/2 rounded-full bg-primary/70" />
            </div>
          </div>
        )}
      </div>

      {/* Time labels */}
      <div className="flex justify-between py-0.5 text-[9px] text-muted-foreground font-mono">
        <span>{fmt(extent.start)}</span>
        <span>{fmt(extent.start + duration / 2)}</span>
        <span>Now</span>
      </div>
    </div>
  );
}
