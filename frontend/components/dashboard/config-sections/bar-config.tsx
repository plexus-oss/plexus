"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AdvancedGroup } from "./advanced-group";
import {
  CheckboxRow,
  AxisConfigFields,
  YAxisRangeFields,
} from "./chart-config-shared";

const ORIENTATIONS = [
  { value: "vertical", label: "Vertical" },
  { value: "horizontal", label: "Horizontal" },
];

interface Props {
  config: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
  metrics?: string[];
}

export function BarConfig({ config, onChange, metrics = [] }: Props) {
  const bool = (key: string, fallback: boolean) =>
    (config[key] as boolean) ?? fallback;

  return (
    <div className="px-3 py-2 border-b border-border space-y-3">
      {/* Essentials */}
      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Orientation
        </Label>
        <Select
          value={(config.orientation as string) || "vertical"}
          onValueChange={(v) => onChange({ orientation: v })}
        >
          <SelectTrigger className="h-7 text-xs mt-1.5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ORIENTATIONS.map((o) => (
              <SelectItem key={o.value} value={o.value} className="text-xs">
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <CheckboxRow
        label="Stacked bars"
        checked={bool("stacked", false)}
        onChange={(v) => onChange({ stacked: v })}
      />
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
            label="Show threshold monitors"
            checked={bool("showLimits", false)}
            onChange={(v) => onChange({ showLimits: v })}
          />
          <CheckboxRow
            label="Show alerts"
            checked={bool("showAlerts", true)}
            onChange={(v) => onChange({ showAlerts: v })}
          />
        </div>
      </AdvancedGroup>
    </div>
  );
}
