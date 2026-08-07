import { useRef, useCallback, useEffect, useState } from "react";
import type { TimeRange } from "@/lib/types/dashboard";
import { getTimeRangeBounds } from "@/lib/types/dashboard";
import type { ViewWindow } from "@/components/dashboard/dashboard-interaction-context";

interface UseChartPanZoomOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  timeRange: TimeRange;
  enabled?: boolean;
  /** Instant visual preview — sets chart domain without data re-fetch */
  setViewWindow: (window: ViewWindow | null) => void;
  /** Commits the final range — triggers data re-fetch (called on mouseup / debounce) */
  onTimeRangeChange: (start: number, end: number) => void;
  /** Called when a pan gesture begins — use to clear tooltips, etc. */
  onPanStart?: () => void;
  margin: { left: number; right: number };
}

const DRAG_THRESHOLD = 4;
const MIN_RANGE = 10 * 1000;
const MAX_RANGE = 90 * 24 * 60 * 60 * 1000;

/**
 * Adds wheel-to-zoom and drag-to-pan on the chart time axis.
 *
 * Uses viewWindow for instant 60fps visual feedback during interaction,
 * only commits the final range (triggering data fetch) on completion.
 *
 * Handlers are stored in refs so the effect only runs once — avoids
 * listener churn that drops events mid-interaction.
 */
export function useChartPanZoom({
  containerRef,
  timeRange,
  enabled = true,
  setViewWindow,
  onTimeRangeChange,
  onPanStart,
  margin,
}: UseChartPanZoomOptions) {
  const active = enabled;
  const isPanning = useRef(false);
  const panStartX = useRef(0);
  const panStartRange = useRef<{ start: number; end: number } | null>(null);
  const pointerDownId = useRef<number | null>(null);
  const pendingZoom = useRef<{ start: number; end: number } | null>(null);
  const zoomTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const brushStart = useRef<{ clientX: number; time: number } | null>(null);
  const [brushRect, setBrushRect] = useState<{ left: number; width: number } | null>(null);

  // Store latest values in refs so event handlers always read current state
  // without causing the effect to re-run and churn listeners.
  const activeRef = useRef(active);
  const timeRangeRef = useRef(timeRange);
  const marginRef = useRef(margin);
  const setViewWindowRef = useRef(setViewWindow);
  const onTimeRangeChangeRef = useRef(onTimeRangeChange);
  const onPanStartRef = useRef(onPanStart);
  useEffect(() => {
    activeRef.current = active;
    timeRangeRef.current = timeRange;
    marginRef.current = margin;
    setViewWindowRef.current = setViewWindow;
    onTimeRangeChangeRef.current = onTimeRangeChange;
    onPanStartRef.current = onPanStart;
  });

  // Sync the ref to state so the listener effect re-runs when the element mounts.
  // Deliberately no dependency array: the chart container mounts AFTER the
  // panel's loading/error branches resolve, and only a later render (not a dep
  // change) makes containerRef.current non-null. With deps this ran once while
  // the ref was still null and the listeners never attached.
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- adding [containerRef, el] here re-broke pan/zoom (listeners never attached); the `node !== el` guard prevents update loops
  useEffect(() => {
    const node = containerRef.current;
    if (node !== el) setEl(node);
  });

  const getCurrentBounds = useCallback(() => {
    const { start, end } = getTimeRangeBounds(timeRangeRef.current);
    return { start: start.getTime(), end: end.getTime() };
  }, []);

  // Attach once per element, read refs for latest state
  useEffect(() => {
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (!activeRef.current) return;
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

      const rect = el.getBoundingClientRect();
      const m = marginRef.current;
      const chartWidth = rect.width - m.left - m.right;
      if (chartWidth <= 0) return;

      const { start: startMs, end: endMs } =
        pendingZoom.current ?? getCurrentBounds();
      const rangeMs = endMs - startMs;

      const cursorX = Math.max(
        0,
        Math.min(1, (e.clientX - rect.left - m.left) / chartWidth),
      );

      const normalizedDelta =
        (Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 100)) / 100;
      const factor = 1 + normalizedDelta * 0.15;
      const clampedRange = Math.max(
        MIN_RANGE,
        Math.min(MAX_RANGE, rangeMs * factor),
      );

      const newStart = startMs + (rangeMs - clampedRange) * cursorX;
      const newEnd = newStart + clampedRange;

      pendingZoom.current = { start: newStart, end: newEnd };
      setViewWindowRef.current({ start: newStart, end: newEnd });

      if (zoomTimer.current) clearTimeout(zoomTimer.current);
      zoomTimer.current = setTimeout(() => {
        const z = pendingZoom.current;
        if (z) {
          onTimeRangeChangeRef.current(z.start, z.end);
          pendingZoom.current = null;
        }
        zoomTimer.current = null;
      }, 300);
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (!activeRef.current) return;
      if (e.button !== 0) return;

      if (e.shiftKey) {
        const m = marginRef.current;
        const rect = el.getBoundingClientRect();
        const chartWidth = rect.width - m.left - m.right;
        if (chartWidth <= 0) return;
        const x = Math.max(0, Math.min(chartWidth, e.clientX - rect.left - m.left));
        const { start, end } = getCurrentBounds();
        const time = start + (x / chartWidth) * (end - start);
        brushStart.current = { clientX: e.clientX, time };
        pointerDownId.current = e.pointerId;
        el.setPointerCapture(e.pointerId);
        onPanStartRef.current?.();
        setBrushRect({ left: x + m.left, width: 0 });
        return;
      }

      if (!e.ctrlKey && !e.metaKey) return;

      panStartX.current = e.clientX;
      panStartRange.current = { ...getCurrentBounds() };
      pointerDownId.current = e.pointerId;
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (brushStart.current) {
        const m = marginRef.current;
        const rect = el.getBoundingClientRect();
        const chartWidth = rect.width - m.left - m.right;
        if (chartWidth <= 0) return;
        const startX = brushStart.current.clientX - rect.left - m.left;
        const curX = Math.max(0, Math.min(chartWidth, e.clientX - rect.left - m.left));
        const left = Math.min(startX, curX);
        const width = Math.abs(curX - startX);
        setBrushRect({ left: left + m.left, width });
        return;
      }
      if (!panStartRange.current) return;

      const deltaX = e.clientX - panStartX.current;

      if (!isPanning.current) {
        if (Math.abs(deltaX) < DRAG_THRESHOLD) return;
        isPanning.current = true;
        if (pointerDownId.current !== null) {
          el.setPointerCapture(pointerDownId.current);
        }
        el.style.cursor = "grabbing";
        onPanStartRef.current?.();
      }

      const m = marginRef.current;
      const rect = el.getBoundingClientRect();
      const chartWidth = rect.width - m.left - m.right;
      if (chartWidth <= 0) return;

      const { start, end } = panStartRange.current;
      const rangeMs = end - start;
      const deltaMs = -(deltaX / chartWidth) * rangeMs;

      setViewWindowRef.current({ start: start + deltaMs, end: end + deltaMs });
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (brushStart.current) {
        const m = marginRef.current;
        const rect = el.getBoundingClientRect();
        const chartWidth = rect.width - m.left - m.right;
        const startTime = brushStart.current.time;
        const startClientX = brushStart.current.clientX;
        brushStart.current = null;
        setBrushRect(null);
        pointerDownId.current = null;
        if (chartWidth <= 0) return;
        if (Math.abs(e.clientX - startClientX) < DRAG_THRESHOLD) return;
        const curX = Math.max(0, Math.min(chartWidth, e.clientX - rect.left - m.left));
        const { start, end } = getCurrentBounds();
        const endTime = start + (curX / chartWidth) * (end - start);
        const [s, en] = startTime < endTime ? [startTime, endTime] : [endTime, startTime];
        const range = Math.max(MIN_RANGE, Math.min(MAX_RANGE, en - s));
        onTimeRangeChangeRef.current(s, s + range);
        return;
      }
      if (!panStartRange.current) return;

      el.style.cursor = "";

      if (isPanning.current) {
        const m = marginRef.current;
        const rect = el.getBoundingClientRect();
        const chartWidth = rect.width - m.left - m.right;

        if (chartWidth > 0) {
          const { start, end } = panStartRange.current;
          const rangeMs = end - start;
          const deltaX = e.clientX - panStartX.current;
          const deltaMs = -(deltaX / chartWidth) * rangeMs;

          onTimeRangeChangeRef.current(start + deltaMs, end + deltaMs);
        }
      }

      isPanning.current = false;
      panStartRange.current = null;
      pointerDownId.current = null;
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    el.addEventListener("pointerdown", handlePointerDown);
    el.addEventListener("pointermove", handlePointerMove);
    el.addEventListener("pointerup", handlePointerUp);

    return () => {
      el.removeEventListener("wheel", handleWheel);
      el.removeEventListener("pointerdown", handlePointerDown);
      el.removeEventListener("pointermove", handlePointerMove);
      el.removeEventListener("pointerup", handlePointerUp);
      if (zoomTimer.current) clearTimeout(zoomTimer.current);
    };
  }, [el, getCurrentBounds]);

  return { isPanning, brushRect };
}
