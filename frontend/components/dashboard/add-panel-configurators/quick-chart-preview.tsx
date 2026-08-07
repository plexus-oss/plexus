"use client";

/**
 * Live preview for the quick-chart flow: renders the REAL panel component for
 * the current draft so every dropdown change redraws the actual chart. SWR
 * dedupes the query with the eventual grid render, so this costs nothing
 * extra. Wrapped in PanelDataPreviewContext so the fetch skips the grid's
 * anti-thundering-herd stagger.
 */

import { useMemo } from "react";
import { PanelRenderer } from "@/components/dashboard/panel-renderer";
import { PanelErrorBoundary } from "@/components/dashboard/panel-error-boundary";
import { PanelDataPreviewContext } from "@/hooks/use-panel-data";
import {
  DEFAULT_PANEL_CONFIG,
  type Panel,
  type TimeRange,
} from "@/lib/types/dashboard";
import type { PanelDraft } from "./types";

/** Preview when the dashboard range is unset: wide enough to show real data. */
const FALLBACK_TIME_RANGE: TimeRange = { type: "relative", value: "30d" };

const PREVIEW_PANEL_ID = "__quick_chart_preview__";

export function QuickChartPreview({
  draft,
  timeRange,
}: {
  draft: PanelDraft;
  timeRange?: TimeRange;
}) {
  const panel = useMemo<Panel>(
    () => ({
      id: PREVIEW_PANEL_ID,
      type: draft.type,
      title: draft.title ?? "",
      metrics: draft.metrics ?? [],
      dataSource: draft.dataSource,
      config: { ...DEFAULT_PANEL_CONFIG, ...draft.config },
      layout: { x: 0, y: 0, w: 12, h: 6 },
    }),
    [draft],
  );

  return (
    <div className="h-[200px] rounded border border-border bg-card overflow-hidden">
      <PanelDataPreviewContext.Provider value={true}>
        <PanelErrorBoundary panelId={panel.id} panelType={panel.type}>
          <PanelRenderer
            panel={panel}
            timeRange={timeRange ?? FALLBACK_TIME_RANGE}
          />
        </PanelErrorBoundary>
      </PanelDataPreviewContext.Provider>
    </div>
  );
}
