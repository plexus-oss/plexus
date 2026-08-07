/**
 * Panel → DataSource normalizer.
 *
 * Stored panel config has two overlapping fields (`metrics` + `dataSource`)
 * for historical reasons. This module is the single read-time translation
 * into a discriminated `PanelDataSource` so no downstream code branches on
 * `isRealtimeSource`/`isConnectionSource` again.
 *
 * Write path is unchanged — stored shapes remain as-is.
 */

import type { Panel, TimeRange, DataFilter } from "@/lib/types/dashboard";
import { isConnectionSource } from "@/lib/types/dashboard";

/**
 * Single normalized view of a panel's data source. One discriminated union,
 * shared between `useSourceData` (which executes it) and any panel-side
 * code that needs to know what kind it is.
 */
export type PanelDataSource =
  | {
      kind: "metrics";
      metrics: string[];
      /** Primary source hint (slug/id) — for keying and limit lookups. */
      sourceId: string | null;
      timeRange?: TimeRange | string;
      panelId?: string;
    }
  | {
      kind: "sql";
      sourceId: string | null;
      sql: string;
      params?: Record<string, unknown>;
      timeRange?: TimeRange;
      timeColumn?: string;
      valueColumn?: string;
      /** Breakdown/pivot column — one series per distinct value. */
      seriesColumn?: string;
      filters?: DataFilter[];
      variables?: Record<string, string>;
      limit?: number;
      timeout?: number;
      refreshInterval?: number;
      panelId?: string;
    };

/**
 * Read the stored panel config into a single normalized shape.
 *
 * Precedence matches what `usePanelData` has always done:
 *   - If `dataSource.type === "connection"`, treat as SQL. Any `metrics`
 *     on the panel are ignored (old behavior).
 *   - Otherwise, treat as metrics (realtime telemetry).
 */
export function getPanelDataSource(
  panel: Panel,
  options: { timeRange?: TimeRange } = {},
): PanelDataSource {
  const ds = panel.dataSource;

  if (isConnectionSource(ds)) {
    return {
      kind: "sql",
      sourceId: ds.sourceId,
      sql: ds.query,
      timeRange: options.timeRange,
      timeColumn: ds.timeColumn,
      valueColumn: ds.valueColumn,
      seriesColumn: ds.seriesColumn,
      refreshInterval: ds.refreshInterval,
      panelId: panel.id,
    };
  }

  const metrics = panel.metrics ?? [];
  const primarySourceId =
    panel.config.sourceId ??
    panel.sources?.[0] ??
    primarySourceFromMetrics(metrics);

  return {
    kind: "metrics",
    metrics,
    sourceId: primarySourceId ?? null,
    timeRange: options.timeRange,
    panelId: panel.id,
  };
}

function primarySourceFromMetrics(metrics: string[]): string | null {
  for (const m of metrics) {
    if (m.includes(":")) return m.split(":")[0];
  }
  return null;
}
