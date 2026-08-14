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
  /**
   * Restores the pre-zoom committed range on reset (double-click / Escape).
   * Receives the TimeRange that was committed before the first gesture, so a
   * relative range ("last 15m") goes back to being live. When omitted, reset
   * falls back to committing that range's bounds via onTimeRangeChange.
   */
  onTimeRangeReset?: (range: TimeRange) => void;
  /** Called when a pan gesture begins — use to clear tooltips, etc. */
  onPanStart?: () => void;
  margin: { left: number; right: number };
}

const DRAG_THRESHOLD = 4;
const MIN_RANGE = 10 * 1000;
const MAX_RANGE = 90 * 24 * 60 * 60 * 1000;

/**
 * True when `range` is the absolute range this hook itself committed —
 * i.e. a timeRange prop change that is just our own zoom/pan echoing back,
 * not the user picking a new range externally.
 *
 * Exported for unit tests only.
 */
export function isOwnCommit(
  range: TimeRange,
  commit: { start: number; end: number } | null,
): boolean {
  if (!commit || range.type !== "absolute") return false;
  const [startStr, endStr] = range.value.split("/");
  const start = new Date(startStr).getTime();
  const end = endStr ? new Date(endStr).getTime() : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  // ISO round-trip is millisecond-exact, but allow 1s slack for callers
  // that re-derive the bounds.
  return Math.abs(start - commit.start) <= 1000 && Math.abs(end - commit.end) <= 1000;
}

/**
 * Adds wheel-to-zoom and drag-to-pan on the chart time axis.
 *
 * Gestures (PlotJuggler-style tool idiom):
 * - Bare wheel over the plot = time zoom centered on the cursor (page scroll
 *   is intentionally suppressed while over the plot). Ctrl/Cmd+wheel — which
 *   is also what trackpad pinch emits — zooms the same way.
 * - Plain drag = pan (Ctrl/Cmd+drag still pans as before).
 * - Shift+drag = X time-brush zoom.
 * - Double-click or Escape (while hovering) = reset to the pre-zoom
 *   committed range.
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
  onTimeRangeReset,
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
  // The committed TimeRange before the first zoom/pan/brush gesture — what
  // double-click / Escape resets to. Cleared when the user picks a new range
  // externally (a timeRange change that isn't our own commit echoing back).
  const baselineRange = useRef<TimeRange | null>(null);
  const lastCommit = useRef<{ start: number; end: number } | null>(null);

  // Store latest values in refs so event handlers always read current state
  // without causing the effect to re-run and churn listeners.
  const activeRef = useRef(active);
  const timeRangeRef = useRef(timeRange);
  const marginRef = useRef(margin);
  const setViewWindowRef = useRef(setViewWindow);
  const onTimeRangeChangeRef = useRef(onTimeRangeChange);
  const onTimeRangeResetRef = useRef(onTimeRangeReset);
  const onPanStartRef = useRef(onPanStart);
  const timeRangeKey = `${timeRange.type}:${timeRange.value}`;
  const prevTimeRangeKey = useRef(timeRangeKey);
  useEffect(() => {
    activeRef.current = active;
    timeRangeRef.current = timeRange;
    marginRef.current = margin;
    setViewWindowRef.current = setViewWindow;
    onTimeRangeChangeRef.current = onTimeRangeChange;
    onTimeRangeResetRef.current = onTimeRangeReset;
    onPanStartRef.current = onPanStart;
    // Detect external time-range changes (picker, Go Live, scrubber): they
    // invalidate the reset baseline. Our own commits echo back as the exact
    // absolute range we sent and keep the baseline alive.
    if (prevTimeRangeKey.current !== timeRangeKey) {
      prevTimeRangeKey.current = timeRangeKey;
      if (!isOwnCommit(timeRange, lastCommit.current)) {
        baselineRange.current = null;
        lastCommit.current = null;
      }
    }
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

    // Remember the committed range the first gesture starts from, so reset
    // can restore it after any number of chained zooms/pans/brushes.
    const captureBaseline = () => {
      if (baselineRange.current === null) {
        baselineRange.current = timeRangeRef.current;
      }
    };

    const commitRange = (start: number, end: number) => {
      lastCommit.current = { start, end };
      onTimeRangeChangeRef.current(start, end);
    };

    // Reset to the pre-zoom committed range (double-click / Escape).
    const resetZoom = () => {
      if (zoomTimer.current) {
        clearTimeout(zoomTimer.current);
        zoomTimer.current = null;
      }
      pendingZoom.current = null;
      brushStart.current = null;
      setBrushRect(null);
      isPanning.current = false;
      panStartRange.current = null;
      pointerDownId.current = null;
      el.style.cursor = "";
      setViewWindowRef.current(null);

      const baseline = baselineRange.current;
      if (!baseline) return; // nothing zoomed — just cleared the preview
      baselineRange.current = null;
      lastCommit.current = null;

      if (onTimeRangeResetRef.current) {
        onTimeRangeResetRef.current(baseline);
      } else {
        const { start, end } = getTimeRangeBounds(baseline);
        commitRange(start.getTime(), end.getTime());
      }
    };

    const handleWheel = (e: WheelEvent) => {
      if (!activeRef.current) return;
      // Bare wheel zooms (tool idiom); preventDefault keeps the page from
      // scrolling while over the plot. Ctrl/Cmd+wheel (incl. trackpad pinch)
      // takes the same path.
      e.preventDefault();
      captureBaseline();

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
          commitRange(z.start, z.end);
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
        captureBaseline();
        brushStart.current = { clientX: e.clientX, time };
        pointerDownId.current = e.pointerId;
        el.setPointerCapture(e.pointerId);
        onPanStartRef.current?.();
        setBrushRect({ left: x + m.left, width: 0 });
        return;
      }

      // Plain drag pans (tool idiom); Ctrl/Cmd+drag keeps working the same.
      // A click without movement never pans (DRAG_THRESHOLD in pointermove),
      // so child click targets (alert bands, annotations) are unaffected.
      captureBaseline();
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
        commitRange(s, s + range);
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

          commitRange(start + deltaMs, end + deltaMs);
        }
      }

      isPanning.current = false;
      panStartRange.current = null;
      pointerDownId.current = null;
    };

    const handleDoubleClick = (e: MouseEvent) => {
      if (!activeRef.current) return;
      e.preventDefault();
      resetZoom();
    };

    // Escape resets too, but only while the cursor is over this chart —
    // and never when the user is mid-Escape out of something else.
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (!activeRef.current) return;
      if (!el.matches(":hover")) return;
      resetZoom();
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    el.addEventListener("pointerdown", handlePointerDown);
    el.addEventListener("pointermove", handlePointerMove);
    el.addEventListener("pointerup", handlePointerUp);
    el.addEventListener("dblclick", handleDoubleClick);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      el.removeEventListener("wheel", handleWheel);
      el.removeEventListener("pointerdown", handlePointerDown);
      el.removeEventListener("pointermove", handlePointerMove);
      el.removeEventListener("pointerup", handlePointerUp);
      el.removeEventListener("dblclick", handleDoubleClick);
      window.removeEventListener("keydown", handleKeyDown);
      if (zoomTimer.current) clearTimeout(zoomTimer.current);
    };
  }, [el, getCurrentBounds]);

  return { isPanning, brushRect };
}
