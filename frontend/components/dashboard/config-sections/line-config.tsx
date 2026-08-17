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

export function LineConfig({ config, onChange, metrics = [] }: Props) {
  const bool = (key: string, fallback: boolean) =>
    (config[key] as boolean) ?? fallback;

  return (
    <div className="px-3 py-2 border-b border-border space-y-3">
      {/* Essentials — what a first-time user actually changes */}
      <CheckboxRow
        label="Show legend"
        checked={bool("showLegend", true)}
        onChange={(v) => onChange({ showLegend: v })}
      />

      <AdvancedGroup label="Axes & grid">
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
          <div className="pt-1">
            <YAxisRangeFields config={config} onChange={onChange} />
          </div>
          {metrics.length >= 2 && (
            <div className="pt-1">
              <AxisConfigFields
                config={config}
                onChange={onChange}
                metrics={metrics}
              />
            </div>
          )}
        </div>
      </AdvancedGroup>

      <AdvancedGroup label="Behavior">
        <div className="space-y-1.5">
          <CheckboxRow
            label="Smooth lines"
            checked={bool("smoothLines", true)}
            onChange={(v) => onChange({ smoothLines: v })}
          />
          <CheckboxRow
            label="Show data points"
            checked={bool("showDataPoints", false)}
            onChange={(v) => onChange({ showDataPoints: v })}
          />
          <CheckboxRow
            label="Show crosshair on hover"
            checked={bool("showCrosshair", true)}
            onChange={(v) => onChange({ showCrosshair: v })}
          />
          <CheckboxRow
            label="Show annotations"
            checked={bool("showAnnotations", true)}
            onChange={(v) => onChange({ showAnnotations: v })}
          />
          <CheckboxRow
            label="Show alerts"
            checked={bool("showAlerts", true)}
            onChange={(v) => onChange({ showAlerts: v })}
          />
          <CheckboxRow
            label="Dash forecast / future values"
            checked={bool("showFutureDashing", true)}
            onChange={(v) => onChange({ showFutureDashing: v })}
          />
          <CheckboxRow
            label="Show threshold monitors"
            checked={bool("showLimits", false)}
            onChange={(v) => onChange({ showLimits: v })}
          />
          <CheckboxRow
            label="Show data table"
            checked={bool("showTable", false)}
            onChange={(v) => onChange({ showTable: v })}
          />
          <CheckboxRow
            label="Show stream rate (Hz)"
            checked={bool("showStreamRate", true)}
            onChange={(v) => onChange({ showStreamRate: v })}
          />
        </div>
      </AdvancedGroup>
    </div>
  );
}
