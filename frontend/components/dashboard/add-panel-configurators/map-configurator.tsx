"use client";

/**
 * MapConfigurator — geo map of devices.
 *
 * Like FleetConfigurator but the source picker is filtered to devices
 * that emit lat *and* lon metrics. On selection we auto-bind the
 * detected lat/lon metric names per source so the renderer can read
 * coordinates without further config.
 */

import { useEffect, useMemo } from "react";
import { Label } from "@/components/ui/label";
import { InlineSourcePicker } from "./inline-source-picker";
import type { ConfiguratorProps } from "./types";

const LAT_HINTS = ["latitude", "lat"];
const LON_HINTS = ["longitude", "long", "lon", "lng"];

function detect(metrics: string[], hints: string[]): string | undefined {
  // Exact match first (most reliable), then substring.
  const lower = metrics.map((m) => m.toLowerCase());
  for (const hint of hints) {
    const i = lower.indexOf(hint);
    if (i !== -1) return metrics[i];
  }
  for (const hint of hints) {
    const i = lower.findIndex((m) => m.includes(hint));
    if (i !== -1) return metrics[i];
  }
  return undefined;
}

function hasLatLon(metrics: string[]): boolean {
  return !!detect(metrics, LAT_HINTS) && !!detect(metrics, LON_HINTS);
}

export function MapConfigurator({
  draft,
  onChange,
  onValidChange,
}: ConfiguratorProps) {
  const sources = useMemo(
    () =>
      ((draft.config as { fleetSources?: string[] }).fleetSources as
        | string[]
        | undefined) ?? [],
    [draft.config],
  );

  const isValid = useMemo(() => sources.length > 0, [sources]);

  useEffect(() => {
    onValidChange(isValid);
  }, [isValid, onValidChange]);

  const updateSources = (next: string[]) => {
    onChange({
      ...draft,
      // The renderer will pick lat/lon out per source by name (case-
      // insensitive substring). We leave `metrics` empty so realtime
      // subscriptions for the map come from the source-level stream.
      metrics: [],
      dataSource: draft.dataSource ?? { type: "realtime" },
      config: { ...draft.config, fleetSources: next },
    });
  };

  return (
    <div className="flex flex-col h-full gap-2">
      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Devices on map
      </Label>
      <p className="text-[10px] text-muted-foreground -mt-1">
        Only devices that emit latitude and longitude are shown.
      </p>
      <div className="flex-1 min-h-0 flex">
        <InlineSourcePicker
          mode="multi"
          selected={sources}
          onChange={updateSources}
          filter={(_sourceId, metrics) => hasLatLon(metrics)}
          className="flex-1"
        />
      </div>
    </div>
  );
}
