"use client";

/**
 * RadarConfigurator — radar/spider chart.
 *
 * Two-step shape: pick one device, then pick which of its metrics to
 * plot as axes. Radar charts only make sense with ≥3 axes, so that's
 * the validity threshold.
 */

import { useEffect, useMemo } from "react";
import { Label } from "@/components/ui/label";
import { InlineMetricPicker } from "./inline-metric-picker";
import { InlineSourcePicker } from "./inline-source-picker";
import type { ConfiguratorProps } from "./types";

const MIN_AXES = 3;

export function RadarConfigurator({
  draft,
  onChange,
  onValidChange,
}: ConfiguratorProps) {
  const metrics = useMemo(() => draft.metrics ?? [], [draft.metrics]);
  const sourceId = draft.config.sourceId;

  useEffect(() => {
    onValidChange(!!sourceId && metrics.length >= MIN_AXES);
  }, [sourceId, metrics, onValidChange]);

  return (
    <div className="flex flex-col h-full gap-3">
      <div>
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Device
        </Label>
        <div className="mt-1 h-40 flex">
          <InlineSourcePicker
            mode="single"
            selected={sourceId ? [sourceId] : []}
            onChange={(s) => {
              const next = s[0];
              onChange({
                ...draft,
                metrics: [],
                dataSource: { type: "realtime" },
                config: { ...draft.config, sourceId: next },
              });
            }}
            className="flex-1"
          />
        </div>
      </div>

      {sourceId && (
        <div className="flex flex-col flex-1 min-h-0">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Axes ({metrics.length} / ≥{MIN_AXES})
          </Label>
          <div className="mt-1 flex-1 min-h-0 flex">
            <InlineMetricPicker
              mode="multi"
              selected={metrics}
              sourceId={sourceId}
              onChange={(m) =>
                onChange({
                  ...draft,
                  metrics: m,
                  dataSource: { type: "realtime" },
                })
              }
              placeholder="Search axes…"
              className="flex-1"
            />
          </div>
        </div>
      )}
    </div>
  );
}
