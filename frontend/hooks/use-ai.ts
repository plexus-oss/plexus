"use client";

/**
 * AI Feature Hooks
 * Consolidates client-side AI API calls into hooks.
 */

import { useState, useEffect } from "react";
import type { ThresholdSuggestion } from "@/lib/ai/threshold-suggestions";

// =============================================================================
// Threshold Suggestions
// =============================================================================

interface UseThresholdSuggestionsResult {
  suggestions: ThresholdSuggestion[];
  isLoading: boolean;
}

export function useThresholdSuggestions(
  sourceId: string,
  enabled = true,
): UseThresholdSuggestionsResult {
  const [suggestions, setSuggestions] = useState<ThresholdSuggestion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    async function fetchSuggestions() {
      try {
        const res = await fetch("/api/ai/suggest-thresholds", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceId }),
        });

        if (!res.ok || cancelled) {
          if (!cancelled) setLoading(false);
          return;
        }

        const data = await res.json();
        if (!cancelled) setSuggestions(data.suggestions || []);
      } catch {
        // Non-fatal
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchSuggestions();
    return () => {
      cancelled = true;
    };
  }, [sourceId, enabled]);

  // Derived: when disabled there is no fetch in flight, so we're never loading.
  const isLoading = enabled ? loading : false;

  return { suggestions, isLoading };
}
