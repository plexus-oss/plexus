"use client";

import { useState, useCallback } from "react";
import { Check, X, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMonitors } from "@/hooks/use-monitors";
import { useThresholdSuggestions } from "@/hooks/use-ai";
import type { ThresholdSuggestion } from "@/lib/ai/threshold-suggestions";

interface MonitorSuggestionBannerProps {
  sourceId: string;
  sourceName?: string;
}

export function MonitorSuggestionBanner({
  sourceId,
  sourceName,
}: MonitorSuggestionBannerProps) {
  const [expanded, setExpanded] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(`plexus:threshold-dismissed:${sourceId}`) === "true";
    } catch {
      return false;
    }
  });
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const { createMonitor } = useMonitors();
  const { suggestions: rawSuggestions, isLoading: loading } =
    useThresholdSuggestions(sourceId, !dismissed);

  const suggestions = rawSuggestions.filter((s) => !accepted.has(s.metric));

  const handleAccept = useCallback(
    async (suggestion: ThresholdSuggestion) => {
      setAccepting(suggestion.metric);

      try {
        await createMonitor({
          source_id: sourceId,
          metric: suggestion.metric,
          threshold: {
            max: suggestion.suggestedMax,
            severity: suggestion.severity,
            message: `Auto-suggested: ${suggestion.explanation}`,
            ...(suggestion.suggestedMin !== undefined && {
              min: suggestion.suggestedMin,
            }),
          },
        });
        setAccepted((prev) => new Set(prev).add(suggestion.metric));
      } catch {
        // Non-fatal
      } finally {
        setAccepting(null);
      }
    },
    [createMonitor, sourceId],
  );

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    try {
      localStorage.setItem(`plexus:threshold-dismissed:${sourceId}`, "true");
    } catch {
      // localStorage unavailable
    }
  }, [sourceId]);

  // Don't render if loading, dismissed, or no suggestions
  if (loading || dismissed || suggestions.length === 0) {
    return null;
  }

  const visibleSuggestions = expanded ? suggestions : suggestions.slice(0, 3);
  const hasMore = suggestions.length > 3;

  return (
    <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div>
            <p className="text-sm font-medium text-foreground">
              Suggested Monitors
              {sourceName && (
                <span className="text-muted-foreground font-normal">
                  {" · "}
                  {sourceName}
                </span>
              )}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {suggestions.length} metric{suggestions.length !== 1 ? "s" : ""}{" "}
              could benefit from monitors based on recent data
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={handleDismiss}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="mt-3 space-y-2">
        {visibleSuggestions.map((suggestion) => (
          <div
            key={suggestion.metric}
            className="flex items-center justify-between gap-4 rounded-md border border-border/50 bg-background/50 px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-mono truncate">{suggestion.metric}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                mean: {suggestion.mean.toFixed(2)} | suggested max:{" "}
                {suggestion.suggestedMax}
                {suggestion.suggestedMin !== undefined &&
                  ` | suggested min: ${suggestion.suggestedMin}`}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 h-7 text-xs"
              disabled={accepting === suggestion.metric}
              onClick={() => handleAccept(suggestion)}
            >
              {accepting === suggestion.metric ? (
                "Saving..."
              ) : (
                <>
                  <Check className="h-3 w-3 mr-1" />
                  Accept
                </>
              )}
            </Button>
          </div>
        ))}
      </div>

      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 h-7 text-xs text-muted-foreground w-full"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3 mr-1" />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3 mr-1" />
              Show {suggestions.length - 3} more
            </>
          )}
        </Button>
      )}
    </div>
  );
}
