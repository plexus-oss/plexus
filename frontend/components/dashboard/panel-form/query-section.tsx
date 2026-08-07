"use client";

/**
 * Query section: read-only view of the generated SQL with an Edit toggle
 * into the full SqlEditor (Run + inline results/errors). `customQuery: true`
 * stops the visual builder from regenerating the SQL; "Reset to visual"
 * hands control back.
 */

import { Label } from "@/components/ui/label";
import { SqlEditor } from "@/components/dashboard/sql-editor";
import type {
  ConnectionDataSource,
  DataSource,
  TimeRange,
} from "@/lib/types/dashboard";

interface QuerySectionProps {
  dataSource: ConnectionDataSource;
  onDataSourceChange: (source: DataSource) => void;
  timeRange?: TimeRange;
  variables: Record<string, string>;
}

export function QuerySection({
  dataSource,
  onDataSourceChange,
  timeRange,
  variables,
}: QuerySectionProps) {
  return (
    <div className="px-4 pb-4 border-t border-border pt-4">
      <div className="flex items-center justify-between mb-1.5">
        <Label className="text-xs font-medium">Query</Label>
        {dataSource.customQuery ? (
          <button
            onClick={() =>
              onDataSourceChange({ ...dataSource, customQuery: false })
            }
            className="text-[11px] text-muted-foreground hover:text-foreground underline"
          >
            Reset to visual
          </button>
        ) : (
          <button
            onClick={() =>
              onDataSourceChange({ ...dataSource, customQuery: true })
            }
            className="text-[11px] text-muted-foreground hover:text-foreground underline"
          >
            Edit
          </button>
        )}
      </div>
      {dataSource.customQuery ? (
        <>
          <SqlEditor
            sourceId={dataSource.sourceId}
            query={dataSource.query || ""}
            onChange={(query) =>
              onDataSourceChange({ ...dataSource, query, customQuery: true })
            }
            timeColumn={dataSource.timeColumn}
            timeRange={timeRange}
            variables={variables}
          />
          <p className="text-[11px] text-muted-foreground mt-1.5">
            Use <code className="bg-muted px-1 rounded">$filter_name</code> for
            dashboard variables
          </p>
        </>
      ) : (
        <pre className="text-xs font-mono bg-muted/30 rounded p-2.5 overflow-x-auto whitespace-pre-wrap text-muted-foreground">
          {dataSource.query}
        </pre>
      )}
    </div>
  );
}
