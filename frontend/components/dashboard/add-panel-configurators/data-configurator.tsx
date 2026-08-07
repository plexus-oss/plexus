"use client";

/**
 * DataConfigurator — add-time data binding for the generic data-driven panel
 * family (line, area, bar, scatter, stat, gantt, calendar, list, datagrid,
 * assoc-scatter). EXACTLY the sidebar's Data section: SourcePicker chooses
 * what feeds the panel; picking a connection brings up the same
 * ConnectionDataEditor (Show / Per / Split by), plus a live preview.
 * One grammar — no separate add-time flow to learn or maintain.
 */

import { useEffect } from "react";
import { SourcePicker } from "@/components/dashboard/source-picker";
import { ConnectionDataEditor } from "@/components/dashboard/connection-data-editor";
import { humanize } from "@/lib/dashboards/quick-start-layout";
import {
  isConnectionSource,
  type ConnectionDataSource,
  type PanelBuilderSpec,
  type TimeRange,
} from "@/lib/types/dashboard";
import { BUCKET_PHRASE } from "./quick-chart-controls";
import { QuickChartPreview } from "./quick-chart-preview";
import type { ConfiguratorProps } from "./types";

/** Datagrid / assoc-scatter bind raw tables, not bucketed charts. */
const TABLE_VARIANT_TYPES = new Set(["datagrid", "assoc-scatter"]);

/** Suggested panel title from the builder spec ("Users per day"). */
function titleForBuilder(builder: PanelBuilderSpec): string {
  const fn = builder.aggregate.fn;
  const phrase = BUCKET_PHRASE[builder.bucket ?? "auto"];
  if (fn === "count") return `${humanize(builder.table)} ${phrase}`;
  if (fn === "raw") return humanize(builder.table);
  const label = fn === "avg" ? "Avg" : fn === "sum" ? "Total" : humanize(fn);
  return `${label} ${humanize(builder.aggregate.column ?? "").toLowerCase()} ${phrase}`;
}

interface DataConfiguratorProps extends ConfiguratorProps {
  /** Dashboard time range — drives the connection live preview. */
  timeRange?: TimeRange;
}

export function DataConfigurator({
  draft,
  onChange,
  onValidChange,
  timeRange,
}: DataConfiguratorProps) {
  const dataSource = draft.dataSource ?? { type: "realtime" as const };
  const metrics = draft.metrics ?? [];
  const isConnection = isConnectionSource(dataSource);
  const variant = TABLE_VARIANT_TYPES.has(draft.type) ? "table" : "chart";

  // Connection panels need a table picked (nonempty query). Realtime: stat
  // needs exactly one metric; everything else can start empty and be bound
  // from the sidebar later.
  const valid = isConnection
    ? !!dataSource.query?.trim()
    : draft.type === "stat"
      ? metrics.length === 1
      : true;

  useEffect(() => {
    onValidChange(valid);
  }, [valid, onValidChange]);

  const handleConnectionChange = (next: ConnectionDataSource) => {
    onChange({
      ...draft,
      dataSource: next,
      metrics: [],
      // Suggest a title from the spec; the modal's Title field overrides.
      title: next.builder ? titleForBuilder(next.builder) : draft.title,
    });
  };

  return (
    <div className="space-y-3">
      {/* Live preview of the real panel while configuring a connection */}
      {isConnection && dataSource.builder && (
        <QuickChartPreview draft={draft} timeRange={timeRange} />
      )}

      <SourcePicker
        dataSource={dataSource}
        selectedMetrics={metrics}
        onDataSourceChange={(ds) =>
          onChange((prev) => ({ ...prev, dataSource: ds, metrics: [] }))
        }
        onMetricsChange={(m) => onChange((prev) => ({ ...prev, metrics: m }))}
      />

      {isConnection && (
        <ConnectionDataEditor
          dataSource={dataSource}
          onChange={handleConnectionChange}
          variant={variant}
        />
      )}

      {!isConnection && draft.type === "stat" && metrics.length !== 1 && (
        <p className="text-[10px] text-muted-foreground">
          Pick exactly one metric for a stat panel.
        </p>
      )}
      {!isConnection && draft.type !== "stat" && metrics.length === 0 && (
        <p className="text-[10px] text-muted-foreground">
          Metrics are optional — add the panel now and bind data from the
          sidebar later.
        </p>
      )}
    </div>
  );
}
