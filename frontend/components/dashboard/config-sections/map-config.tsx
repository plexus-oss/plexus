"use client";

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

interface Props {
  config: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
  metrics?: string[];
}

// Radix Select forbids empty string values; use a sentinel for "Auto-detect".
const AUTO = "__auto__";

export function MapConfig({ config, onChange, metrics = [] }: Props) {
  return (
    <div className="px-3 py-2 border-b border-border space-y-3">
      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Latitude Metric
        </Label>
        <Select
          value={(config.latMetric as string) || AUTO}
          onValueChange={(v) =>
            onChange({ latMetric: v === AUTO ? undefined : v })
          }
        >
          <SelectTrigger className="h-7 text-xs mt-1.5">
            <SelectValue placeholder="Auto-detect" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={AUTO} className="text-xs">Auto-detect</SelectItem>
            {metrics.map((m) => (
              <SelectItem key={m} value={m} className="text-xs">
                {m.includes(":") ? m.split(":")[1] : m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Longitude Metric
        </Label>
        <Select
          value={(config.lngMetric as string) || AUTO}
          onValueChange={(v) =>
            onChange({ lngMetric: v === AUTO ? undefined : v })
          }
        >
          <SelectTrigger className="h-7 text-xs mt-1.5">
            <SelectValue placeholder="Auto-detect" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={AUTO} className="text-xs">Auto-detect</SelectItem>
            {metrics.map((m) => (
              <SelectItem key={m} value={m} className="text-xs">
                {m.includes(":") ? m.split(":")[1] : m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Label className="flex items-center gap-2 text-[11px]">
        <Checkbox
          checked={(config.showPath as boolean) ?? true}
          onCheckedChange={(checked) => onChange({ showPath: checked === true })}
          className="h-3 w-3"
        />
        Show trail
      </Label>
      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Max Trail Points
        </Label>
        <Input
          type="number"
          min={10}
          max={10000}
          value={(config.maxTrailPoints as number) ?? 200}
          onChange={(e) => onChange({ maxTrailPoints: parseInt(e.target.value) || 200 })}
          className="h-7 text-xs mt-1.5 w-20"
        />
      </div>
      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Path Color
        </Label>
        <Input
          value={(config.pathColor as string) || ""}
          onChange={(e) => onChange({ pathColor: e.target.value || undefined })}
          className="h-7 text-xs mt-1.5"
          placeholder="#3b82f6"
        />
      </div>
      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Marker Color
        </Label>
        <Input
          value={(config.markerColor as string) || ""}
          onChange={(e) => onChange({ markerColor: e.target.value || undefined })}
          className="h-7 text-xs mt-1.5"
          placeholder="#ef4444"
        />
      </div>
      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Coordinate Format
        </Label>
        <Select
          value={(config.coordinateFormat as string) || "decimal"}
          onValueChange={(v) => onChange({ coordinateFormat: v })}
        >
          <SelectTrigger className="h-7 text-xs mt-1.5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="decimal" className="text-xs">Decimal</SelectItem>
            <SelectItem value="dms" className="text-xs">DMS</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
