"use client";

/**
 * "Explain" action for chart panels: hands the visible window to the global
 * Terminal — the agentic path that replaced the old label popover. The button
 * opens the ⌘K sheet pre-seeded with an investigate-then-explain request for
 * the panel's qualified metrics and window; the agent queries the data, reads
 * the source's context, and proposes annotations/memories as reviewable cards
 * (Apply/Dismiss, verdict-logged) instead of dumping labels in a popover.
 *
 * The /api/assistant/label POST + availability GET remain in place for the
 * run-debrief flow — they're just no longer this button's target. The button
 * renders only when the Terminal is configured (its POST 503s without
 * ANTHROPIC_API_KEY).
 */

import { Sparkles } from "lucide-react";
import { openTerminal } from "@/components/assistant/terminal";
import { useTerminalAvailability } from "@/hooks/use-terminal-availability";

interface ExplainButtonProps {
  /** Qualified "slug:metric" keys, exactly what the chart queries with. */
  metrics: string[];
  /** Currently rendered window, epoch ms. */
  timeWindow: { start: number; end: number };
}

export function ExplainButton({ metrics, timeWindow }: ExplainButtonProps) {
  const { available } = useTerminalAvailability();

  // Terminal not configured — no button (same gating idea as the old popover).
  if (!available) return null;

  const explain = () => {
    const start = new Date(timeWindow.start).toISOString();
    const end = new Date(timeWindow.end).toISOString();
    openTerminal(
      `Explain what you see in ${metrics.join(", ")} between ${start} and ${end}. Investigate before concluding.`,
    );
  };

  return (
    <button
      onClick={explain}
      className="flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors text-muted-foreground hover:text-foreground hover:bg-muted/50"
      title="Explain this view in the Terminal"
    >
      <Sparkles className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">Explain</span>
    </button>
  );
}
