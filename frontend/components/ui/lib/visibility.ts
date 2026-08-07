"use client";

import {
  useState,
  useEffect,
  useRef,
  useSyncExternalStore,
  type RefObject,
} from "react";

/**
 * Page Visibility API as an external store, so consumers can read it via
 * `useSyncExternalStore` without synchronously calling setState inside an effect.
 */
function subscribePageVisibility(onChange: () => void): () => void {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

function getPageVisibleSnapshot(): boolean {
  return document.visibilityState === "visible";
}

function getPageVisibleServerSnapshot(): boolean {
  // SSR (and first client render) assume the tab is visible.
  return true;
}

/**
 * Combined visibility state from IntersectionObserver + Page Visibility API
 */
export interface VisibilityState {
  /** Element is in viewport (IntersectionObserver) */
  isIntersecting: boolean;
  /** Page/tab is visible (Page Visibility API) */
  isPageVisible: boolean;
  /** Element should actively render (both conditions met) */
  isVisible: boolean;
}

/**
 * Hook for detecting when a chart is visible in the viewport AND tab is active.
 * Used to pause expensive rendering when charts are off-screen or tab is hidden.
 *
 * This combines:
 * 1. IntersectionObserver - detects if element is in viewport
 * 2. Page Visibility API - detects if browser tab is active
 *
 * Charts only render when BOTH conditions are true.
 */
export function useChartVisibility(
  ref: RefObject<HTMLElement | null>,
  options: {
    threshold?: number;
    rootMargin?: string;
  } = {}
): VisibilityState {
  const { threshold = 0, rootMargin = "0px" } = options;
  const [isIntersecting, setIsIntersecting] = useState(true); // Default true for SSR

  // Page Visibility API for tab visibility (external store, no setState-in-effect)
  const isPageVisible = useSyncExternalStore(
    subscribePageVisibility,
    getPageVisibleSnapshot,
    getPageVisibleServerSnapshot
  );

  // IntersectionObserver for viewport visibility
  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // If IntersectionObserver is unavailable, leave isIntersecting at its
    // default (true) so rendering is never paused.
    if (typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsIntersecting(entry.isIntersecting);
      },
      { threshold, rootMargin }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [ref, threshold, rootMargin]);

  return {
    isIntersecting,
    isPageVisible,
    isVisible: isIntersecting && isPageVisible,
  };
}

/**
 * Hook that pauses a callback when element is not visible.
 * Useful for animation loops that should stop when off-screen.
 *
 * @param callback - Function to call on each animation frame
 * @param elementRef - Ref to the element to observe
 * @param enabled - Optional flag to enable/disable the loop
 */
export function useVisibleAnimationFrame(
  callback: (deltaTime: number) => void,
  elementRef: RefObject<HTMLElement | null>,
  enabled = true
): void {
  const { isVisible } = useChartVisibility(elementRef);
  const rafRef = useRef<number>(0);
  const previousTimeRef = useRef<number>(0);
  const callbackRef = useRef(callback);

  // Keep callback ref up to date
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled || !isVisible) {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      return;
    }

    const animate = (time: number) => {
      if (previousTimeRef.current !== 0) {
        const deltaTime = time - previousTimeRef.current;
        callbackRef.current(deltaTime);
      }
      previousTimeRef.current = time;
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [enabled, isVisible]);
}

/**
 * Hook that pauses an interval when element is not visible.
 *
 * @param callback - Function to call on each interval
 * @param intervalMs - Interval in milliseconds
 * @param elementRef - Ref to the element to observe
 * @param enabled - Optional flag to enable/disable the interval
 */
export function useVisibleInterval(
  callback: () => void,
  intervalMs: number,
  elementRef: RefObject<HTMLElement | null>,
  enabled = true
): void {
  const { isVisible } = useChartVisibility(elementRef);
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled || !isVisible) return;

    const id = setInterval(() => {
      callbackRef.current();
    }, intervalMs);

    return () => {
      clearInterval(id);
    };
  }, [enabled, isVisible, intervalMs]);
}

/**
 * Simple hook for page visibility only (no element ref needed).
 * Use this when you want to pause processing when tab is hidden.
 */
export function usePageVisibility(): boolean {
  return useSyncExternalStore(
    subscribePageVisibility,
    getPageVisibleSnapshot,
    getPageVisibleServerSnapshot
  );
}
