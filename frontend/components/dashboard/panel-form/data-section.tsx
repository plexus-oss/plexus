"use client";

/**
 * Data section of the panel form — source-aware, no modes: the SourcePicker
 * chooses what feeds the panel; connection sources always get the
 * ConnectionDataEditor (table + Show/Per/Split-by, custom SQL via the Query
 * section). Realtime metric selection lives inside the SourcePicker.
 */

import { SourcePicker } from "@/components/dashboard/source-picker";
import { ConnectionDataEditor } from "@/components/dashboard/connection-data-editor";
import { isConnectionSource, type DataSource } from "@/lib/types/dashboard";
import { SectionHeader } from "./section-header";

interface DataSectionProps {
  dataSource: DataSource;
  selectedMetrics: string[];
  onDataSourceChange: (source: DataSource) => void;
  onMetricsChange: (metrics: string[]) => void;
  /** Datagrid panels edit as raw tables. */
  variant?: "chart" | "table";
}

export function DataSection({
  dataSource,
  selectedMetrics,
  onDataSourceChange,
  onMetricsChange,
  variant = "chart",
}: DataSectionProps) {
  return (
    <>
      <SectionHeader>Data</SectionHeader>
      <div className="px-4 pb-4 space-y-3">
        <SourcePicker
          dataSource={dataSource}
          selectedMetrics={selectedMetrics}
          onDataSourceChange={onDataSourceChange}
          onMetricsChange={onMetricsChange}
        />
        {isConnectionSource(dataSource) && (
          <ConnectionDataEditor
            dataSource={dataSource}
            onChange={onDataSourceChange}
            variant={variant}
          />
        )}
      </div>
    </>
  );
}
