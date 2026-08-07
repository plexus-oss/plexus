"use client";

import { useEffect, useRef, useState } from "react";

/**
 * rAF-driven animated domain. Returns a [min, max] that eases toward the
 * target domain every animation frame.
 *
 * Behavior designed for live streaming charts:
 *   - **Expansions are instant**: whenever target extends past current, we
 *     snap outward immediately so incoming outliers are never clipped or
 *     hidden off-screen waiting for the animation.
 *   - **Contractions ease**: when the target tightens (an old extreme aged
 *     out of the window), the domain cools gradually so the chart doesn't
 *     feel twitchy.
 *
 * Disabled mode (enabled=false) returns target unchanged — use when the
 * caller wants exact-match behavior (static charts, custom axis domains,
 * annotation mode, pan/zoom in progress).
 */
export function useAnimatedDomain(
  target: [number, number] | undefined,
  enabled: boolean,
): [number, number] | undefined {
  const [current, setCurrent] = useState<[number, number] | undefined>(target);

  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let rafId = requestAnimationFrame(function loop() {
      if (cancelled) return;
      rafId = requestAnimationFrame(loop);

      const t = targetRef.current;
      if (!t) return;

      setCurrent((prev) => {
        if (!prev) return t;
        const [tMin, tMax] = t;
        const [pMin, pMax] = prev;

        // Ease 12% per frame → converges in ~20 frames (~333 ms at 60 Hz).
        const LERP = 0.12;
        let nextMin = pMin + (tMin - pMin) * LERP;
        let nextMax = pMax + (tMax - pMax) * LERP;

        // Never clip: if target extends past current in either direction,
        // snap outward. This is what keeps new outliers visible instantly.
        if (tMin < nextMin) nextMin = tMin;
        if (tMax > nextMax) nextMax = tMax;

        // Snap to target once within a small epsilon so the rAF loop settles
        // and doesn't chase infinitesimally-small deltas forever.
        const span = Math.abs(tMax - tMin) || 1;
        const EPSILON = span * 0.0005;
        if (Math.abs(nextMin - tMin) < EPSILON) nextMin = tMin;
        if (Math.abs(nextMax - tMax) < EPSILON) nextMax = tMax;

        if (nextMin === pMin && nextMax === pMax) return prev;
        return [nextMin, nextMax];
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [enabled]);

  // When disabled, pass through. When enabled but target is undefined, keep
  // whatever we had so the chart doesn't flash empty during data loads.
  if (!enabled) return target;
  return current ?? target;
}
