"use client";

import { useMemo, useCallback, useState, useEffect } from "react";

interface MonitorSuggestion {
  metric: string;
  suggestedMin: number | null;
  suggestedMax: number | null;
  rationale: string;
}

interface UseMonitorSuggestionsOptions {
  sourceId: string;
  availableMetrics: string[];
  existingMonitorMetrics: string[];
}

const DISMISS_KEY = "plexus:monitor-suggestions-dismissed";

function getDismissed(sourceId: string): Set<string> {
  try {
    const raw = localStorage.getItem(`${DISMISS_KEY}:${sourceId}`);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveDismissed(sourceId: string, dismissed: Set<string>) {
  localStorage.setItem(
    `${DISMISS_KEY}:${sourceId}`,
    JSON.stringify([...dismissed]),
  );
}

export function useMonitorSuggestions({
  sourceId,
  availableMetrics,
  existingMonitorMetrics,
}: UseMonitorSuggestionsOptions) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  // Seed the dismissed set from localStorage after mount (kept out of the
  // synchronous effect body so the initial render stays SSR-safe/empty).
  useEffect(() => {
    if (!sourceId) return;
    let active = true;
    queueMicrotask(() => {
      if (active) setDismissed(getDismissed(sourceId));
    });
    return () => {
      active = false;
    };
  }, [sourceId]);

  const suggestions = useMemo((): MonitorSuggestion[] => {
    const monitored = new Set(existingMonitorMetrics);
    return availableMetrics
      .filter((m) => !monitored.has(m) && !dismissed.has(m))
      .map((metric) => ({
        metric,
        suggestedMin: null,
        suggestedMax: null,
        rationale: `"${metric}" has data but no monitor. Add a threshold to get alerted on anomalies.`,
      }));
  }, [availableMetrics, existingMonitorMetrics, dismissed]);

  const dismiss = useCallback(
    (metric: string) => {
      setDismissed((prev) => {
        const next = new Set(prev);
        next.add(metric);
        saveDismissed(sourceId, next);
        return next;
      });
    },
    [sourceId],
  );

  return { suggestions, dismiss };
}
