"use client";

import { AdvancedGroup } from "./advanced-group";
import {
  CheckboxRow,
  AxisConfigFields,
  YAxisRangeFields,
} from "./chart-config-shared";

interface Props {
  config: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
  metrics?: string[];
}

export function ScatterConfig({ config, onChange, metrics = [] }: Props) {
  const bool = (key: string, fallback: boolean) =>
    (config[key] as boolean) ?? fallback;

  return (
    <div className="px-3 py-2 border-b border-border space-y-3">
      {/* Essentials */}
      <CheckboxRow
        label="Show legend"
        checked={bool("showLegend", true)}
        onChange={(v) => onChange({ showLegend: v })}
      />
      {metrics.length >= 2 && (
        <AxisConfigFields
          config={config}
          onChange={onChange}
          metrics={metrics}
        />
      )}

      <AdvancedGroup>
        <div className="space-y-1.5">
          <CheckboxRow
            label="Show grid"
            checked={bool("showGrid", true)}
            onChange={(v) => onChange({ showGrid: v })}
          />
          <CheckboxRow
            label="Show X axis"
            checked={bool("showXAxis", true)}
            onChange={(v) => onChange({ showXAxis: v })}
          />
          <CheckboxRow
            label="Show Y axis"
            checked={bool("showYAxis", true)}
            onChange={(v) => onChange({ showYAxis: v })}
          />
          <CheckboxRow
            label="Show data points"
            checked={bool("showDataPoints", true)}
            onChange={(v) => onChange({ showDataPoints: v })}
          />
          <div className="pt-1">
            <YAxisRangeFields config={config} onChange={onChange} />
          </div>
        </div>
      </AdvancedGroup>
    </div>
  );
}
