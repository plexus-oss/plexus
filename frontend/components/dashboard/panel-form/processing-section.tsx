"use client";

/**
 * Processing section: time-bucket aggregation presets + data transforms
 * (rolling avg, delta, rate…). Chart-family panels only.
 */

import { AggregationPresetPicker } from "@/components/dashboard/aggregation-presets";
import { TransformEditor } from "@/components/dashboard/transform-editor";
import type { PanelConfig, TimeRange } from "@/lib/types/dashboard";
import { SectionHeader } from "./section-header";

interface ProcessingSectionProps {
  config: PanelConfig;
  onConfigChange: (updates: Partial<PanelConfig>) => void;
  selectedMetrics: string[];
  timeRange?: TimeRange;
}

export function ProcessingSection({
  config,
  onConfigChange,
  selectedMetrics,
  timeRange,
}: ProcessingSectionProps) {
  return (
    <>
      <SectionHeader>Processing</SectionHeader>
      <div className="px-4 pb-4 space-y-4">
        <AggregationPresetPicker
          aggregation={config.dataAggregation}
          onChange={(dataAggregation) => onConfigChange({ dataAggregation })}
          timeRange={timeRange}
        />
        {selectedMetrics.length > 0 && (
          <TransformEditor
            transforms={config.transforms || []}
            metrics={selectedMetrics}
            onChange={(transforms) => onConfigChange({ transforms })}
          />
        )}
      </div>
    </>
  );
}
