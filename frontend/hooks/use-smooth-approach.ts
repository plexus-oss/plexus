"use client";

import { useEffect, useRef, useState } from "react";

/**
 * rAF easing of a value toward a (possibly moving) target.
 *
 * Unlike {@link useSmoothClock}, which always chases `Date.now()` and therefore
 * drifts forever, this **settles when the target stops changing**. Anchor a live
 * chart's right edge to its latest data timestamp with this and the viewport
 * sits perfectly still between data points, then eases smoothly to catch up when
 * new data arrives — instead of continuously sliding (which reads as jumpy when
 * data lands in steps and rubber-bands against the slide).
 *
 * @param target  the value to ease toward (e.g. latest data time + margin, ms)
 * @param enabled when false, returns `target` unchanged (no animation loop)
 */
export function useSmoothApproach(target: number, enabled: boolean): number {
  const [value, setValue] = useState(target);
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let rafId = requestAnimationFrame(function loop() {
      if (cancelled) return;
      rafId = requestAnimationFrame(loop);
      setValue((prev) => {
        const t = targetRef.current;
        const delta = t - prev;
        // Settle within 2ms so the loop stops chasing sub-pixel deltas and the
        // chart is genuinely still between updates.
        if (Math.abs(delta) < 2) return prev === t ? prev : t;
        return prev + delta * 0.18; // ease ~18%/frame → converges in ~250ms
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [enabled]);

  return enabled ? value : target;
}
