"use client";

/**
 * DashboardConfigurator — for the "dashboard" panel type that embeds
 * another dashboard as a card. The modal's title field doubles as the
 * new dashboard's name (we create the dashboard when Add is clicked).
 * Optional preview metrics show up as small live values on the card.
 */

import { useEffect } from "react";
import { Label } from "@/components/ui/label";
import { InlineMetricPicker } from "./inline-metric-picker";
import type { ConfiguratorProps } from "./types";

const MAX_PREVIEW_METRICS = 4;

export function DashboardConfigurator({
  draft,
  onChange,
  onValidChange,
}: ConfiguratorProps) {
  const previewMetrics =
    (draft.config.previewMetrics as string[] | undefined) ?? [];

  useEffect(() => {
    onValidChange(true);
  }, [onValidChange]);

  return (
    <div className="flex flex-col h-full gap-2">
      <p className="text-[11px] text-muted-foreground">
        A new dashboard is created when you click Add. Use the title field
        below to name it.
      </p>
      <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
        Preview metrics (optional)
      </Label>
      <p className="text-[10px] text-muted-foreground -mt-1">
        Up to {MAX_PREVIEW_METRICS} live values shown on the card.
      </p>
      <InlineMetricPicker
        mode="multi"
        selected={previewMetrics}
        onChange={(m) =>
          onChange({
            ...draft,
            config: {
              ...draft.config,
              previewMetrics: m.slice(0, MAX_PREVIEW_METRICS),
            },
          })
        }
        className="flex-1 min-h-0"
      />
    </div>
  );
}
