"use client";

/**
 * PassthroughConfigurator — for panel types that need no first-class
 * setup beyond a data source. The post-create sidebar handles the
 * rest. Used as a fallback for view panels (alerts, events, devices),
 * earth (orbital), and anything else without a dedicated form.
 */

import { useEffect } from "react";
import { Label } from "@/components/ui/label";
import { SourcePicker } from "@/components/dashboard/source-picker";
import type { ConfiguratorProps } from "./types";

export function PassthroughConfigurator({
  draft,
  onChange,
  onValidChange,
}: ConfiguratorProps) {
  useEffect(() => {
    onValidChange(true);
  }, [onValidChange]);

  return (
    <div className="space-y-2">
      <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
        Optional data source
      </Label>
      <p className="text-[10px] text-muted-foreground">
        This panel works without any data binding. Add one if you want to
        scope it to a specific source.
      </p>
      <SourcePicker
        dataSource={draft.dataSource ?? { type: "realtime" }}
        selectedMetrics={draft.metrics ?? []}
        onDataSourceChange={(ds) =>
          onChange((prev) => ({ ...prev, dataSource: ds }))
        }
        onMetricsChange={(m) => onChange((prev) => ({ ...prev, metrics: m }))}
      />
    </div>
  );
}
