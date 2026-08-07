import { useMemo, useState } from "react";
import { getTimeRangeBounds, parseRelativeTime } from "@/lib/types/dashboard";
import type { TimeRange } from "@/lib/types/dashboard";
import type { ViewWindow } from "@/components/dashboard/dashboard-interaction-context";
import { useSmoothApproach } from "@/hooks/use-smooth-approach";

interface UseChartDomainOptions {
  timeRange: TimeRange;
  xAxisField?: string;
  /** Transient view window during pan/zoom — takes priority for instant feedback */
  viewWindow?: ViewWindow | null;
  annotationMode: "off" | "on";
  /** Timestamp (ms) of the newest data point across visible series. In live
   *  mode the viewport anchors to this so it stays still until new data lands,
   *  then eases to it — instead of sliding continuously off the wall clock. */
  latestDataTime?: number;
}

/**
 * Computes the x-axis domain from the time range and annotation mode.
 *
 * For relative (live) ranges the right edge is **anchored to the latest data
 * point** (plus a small margin) and eased toward it. That keeps the viewport
 * still between updates — no continuous wall-clock drift — and slides smoothly
 * only when new data actually arrives, which is what makes streaming charts feel
 * calm instead of jumpy. The left edge is not tightened to the oldest point
 * (that snaps when points are evicted); it just trails the right edge by the
 * full range.
 */
export function useChartDomain({
  timeRange,
  xAxisField,
  viewWindow,
  annotationMode,
  latestDataTime,
}: UseChartDomainOptions): [number, number] | undefined {
  // Live (relative) mode, no transient viewWindow / custom axis / annotation
  // freeze / active pan-zoom → anchor + ease the right edge to the data.
  const isLiveSmooth =
    timeRange?.type === "relative" &&
    !viewWindow &&
    !xAxisField &&
    annotationMode !== "on";

  const range =
    timeRange?.type === "relative" ? parseRelativeTime(timeRange.value) : 0;
  // Small right margin so the eased edge can stay just ahead of the newest
  // point (keeping it visible while the ease catches up), and so the line
  // doesn't render flush against the frame.
  const rightMargin = range * 0.015;
  // Fallback anchor for the brief window before any data has loaded. Captured
  // once at mount so render stays pure (no `Date.now()` call during render);
  // once `latestDataTime` is available it takes over.
  const [nowFallback] = useState(() => Date.now());
  const edgeTarget = (latestDataTime ?? nowFallback) + rightMargin;
  const smoothEdge = useSmoothApproach(edgeTarget, isLiveSmooth);

  const xDomainBase = useMemo(() => {
    // During active pan/zoom, override domain for instant visual feedback
    if (viewWindow) {
      return [viewWindow.start, viewWindow.end] as [number, number];
    }

    if (xAxisField) return undefined;
    if (!timeRange) return undefined;

    if (timeRange.type === "relative") {
      // Right edge anchored to (eased) latest data, left edge trails by range.
      return [smoothEdge - range, smoothEdge] as [number, number];
    }

    const bounds = getTimeRangeBounds(timeRange);
    return [bounds.start.getTime(), bounds.end.getTime()] as [number, number];
  }, [timeRange, xAxisField, viewWindow, smoothEdge, range]);

  // Freeze xDomain during annotation mode. Mirrors the previous ref-based
  // behavior (the frozen value tracks xDomainBase with a one-render lag) but
  // holds it in state and updates via a guarded render-time adjustment, so the
  // value is never read from a ref during render.
  const nextFrozen =
    annotationMode === "on" && xDomainBase ? xDomainBase : undefined;
  const [frozenXDomain, setFrozenXDomain] = useState<
    [number, number] | undefined
  >(undefined);
  if (frozenXDomain !== nextFrozen) {
    setFrozenXDomain(nextFrozen);
  }

  return frozenXDomain ?? xDomainBase;
}
