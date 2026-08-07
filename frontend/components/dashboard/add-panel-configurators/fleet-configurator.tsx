"use client";

/**
 * FleetConfigurator — fleet-grid / fleet-table.
 *
 * Source = the set of devices on display. Empty by default; the user
 * opts in. Optional "metric to display" picker for the headline value
 * shown per card / row. Stored:
 *   - `config.fleetSources`: string[] of selected source IDs.
 *   - `metrics`: optional single headline metric, expanded across the
 *     selected sources so streaming subscribes once per device.
 */

import { useEffect, useMemo, useState } from "react";
import { Label } from "@/components/ui/label";
import { InlineSourcePicker } from "./inline-source-picker";
import { InlineMetricPicker } from "./inline-metric-picker";
import type { ConfiguratorProps } from "./types";

export function FleetConfigurator({
  draft,
  onChange,
  onValidChange,
}: ConfiguratorProps) {
  const sources = useMemo<string[]>(
    () =>
      ((draft.config as { fleetSources?: string[] }).fleetSources as
        | string[]
        | undefined) ?? [],
    [draft.config],
  );

  // The headline metric is stored as a single picker key (source:metric)
  // but expanded to one key per source on commit so subscriptions work
  // uniformly. We keep just the bare metric name in local state.
  const initialMetric = useMemo<string | undefined>(() => {
    const first = (draft.metrics ?? [])[0];
    if (!first) return undefined;
    const colon = first.indexOf(":");
    return colon === -1 ? first : first.substring(colon + 1);
  }, [draft.metrics]);
  const [pickerKey, setPickerKey] = useState<string | undefined>(() => {
    if (!initialMetric) return undefined;
    const owner = sources[0];
    return owner ? `${owner}:${initialMetric}` : undefined;
  });

  useEffect(() => {
    onValidChange(sources.length > 0);
  }, [sources, onValidChange]);

  const updateSources = (next: string[]) => {
    const metricName = pickerKey
      ? pickerKey.substring(pickerKey.indexOf(":") + 1)
      : undefined;
    const expanded = metricName ? next.map((s) => `${s}:${metricName}`) : [];
    onChange({
      ...draft,
      metrics: expanded,
      dataSource: draft.dataSource ?? { type: "realtime" },
      config: { ...draft.config, fleetSources: next },
    });
  };

  const updateMetric = (selected: string[]) => {
    const key = selected[0];
    setPickerKey(key);
    const metricName = key ? key.substring(key.indexOf(":") + 1) : undefined;
    const expanded = metricName ? sources.map((s) => `${s}:${metricName}`) : [];
    onChange({
      ...draft,
      metrics: expanded,
      dataSource: draft.dataSource ?? { type: "realtime" },
      config: { ...draft.config, fleetSources: sources },
    });
  };

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex flex-col flex-1 min-h-0">
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Devices
        </Label>
        <div className="mt-1 flex-1 min-h-0 flex">
          <InlineSourcePicker
            mode="multi"
            selected={sources}
            onChange={updateSources}
            className="flex-1"
          />
        </div>
      </div>
      <div className="shrink-0">
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Headline metric (optional)
        </Label>
        <div className="mt-1 h-40 flex">
          <InlineMetricPicker
            mode="single"
            selected={pickerKey ? [pickerKey] : []}
            onChange={updateMetric}
            placeholder="Show one metric per device…"
            className="flex-1"
          />
        </div>
      </div>
    </div>
  );
}
