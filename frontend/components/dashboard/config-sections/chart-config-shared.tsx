"use client";

/**
 * Shared building blocks for the chart config sections (line/area, bar,
 * scatter): the checkbox row and the multi-metric axis configuration block,
 * previously copy-pasted per type.
 */

import type { ChangeEvent } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Clock } from "lucide-react";

export function CheckboxRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Label className="flex items-center gap-2 text-[11px]">
      <Checkbox
        checked={checked}
        onCheckedChange={(c) => onChange(c === true)}
        className="h-3 w-3"
      />
      {label}
    </Label>
  );
}

/** Manual Y-axis bounds; empty inputs fall back to auto-scaling. */
export function YAxisRangeFields({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
}) {
  const bound = (key: "yMin" | "yMax") => {
    const v = config[key];
    return typeof v === "number" ? v : "";
  };
  const setBound =
    (key: "yMin" | "yMax") => (e: ChangeEvent<HTMLInputElement>) => {
      const n = Number(e.target.value);
      onChange({
        [key]:
          e.target.value === "" || !Number.isFinite(n) ? undefined : n,
      });
    };
  return (
    <div>
      <Label className="text-[10px] text-muted-foreground">Y-Axis Range</Label>
      <div className="flex gap-1 mt-1">
        <Input
          type="number"
          value={bound("yMin")}
          onChange={setBound("yMin")}
          className="h-7 text-xs w-20"
          placeholder="Auto"
        />
        <span className="text-[10px] text-muted-foreground self-center">–</span>
        <Input
          type="number"
          value={bound("yMax")}
          onChange={setBound("yMax")}
          className="h-7 text-xs w-20"
          placeholder="Auto"
        />
      </div>
    </div>
  );
}

/** X-axis metric picker + axis labels. Render only with 2+ metrics. */
export function AxisConfigFields({
  config,
  onChange,
  metrics,
}: {
  config: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
  metrics: string[];
}) {
  return (
    <div>
      <Label className="text-[10px] text-muted-foreground">X-Axis</Label>
      <Select
        value={(config.xAxisField as string) || "_time"}
        onValueChange={(v) =>
          onChange({ xAxisField: v === "_time" ? undefined : v })
        }
      >
        <SelectTrigger className="h-7 text-xs mt-1">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="_time" className="text-xs">
            <div className="flex items-center gap-2">
              <Clock className="h-3 w-3" />
              Time (default)
            </div>
          </SelectItem>
          {metrics.map((m) => {
            const displayName = m.includes(":") ? m.split(":")[1] : m;
            return (
              <SelectItem key={m} value={m} className="text-xs">
                {displayName}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      {config.xAxisField ? (
        <div className="mt-2">
          <Label className="text-[10px] text-muted-foreground">Y-Axis</Label>
          <p className="text-[11px] text-foreground mt-1">
            {metrics
              .filter((m) => m !== (config.xAxisField as string))
              .map((m) => (m.includes(":") ? m.split(":")[1] : m))
              .join(", ")}
          </p>
        </div>
      ) : null}
      <p className="text-[10px] text-muted-foreground mt-2">
        Time filtering still applies to limit data range.
      </p>
      <div className="mt-2">
        <Label className="text-[10px] text-muted-foreground">X-Axis Label</Label>
        <Input
          value={(config.xAxisLabel as string) || ""}
          onChange={(e) => onChange({ xAxisLabel: e.target.value || undefined })}
          className="h-7 text-xs mt-1"
          placeholder="X-axis label"
        />
      </div>
      <div className="mt-2">
        <Label className="text-[10px] text-muted-foreground">Y-Axis Label</Label>
        <Input
          value={(config.yAxisLabel as string) || ""}
          onChange={(e) => onChange({ yAxisLabel: e.target.value || undefined })}
          className="h-7 text-xs mt-1"
          placeholder="Y-axis label"
        />
      </div>
    </div>
  );
}
