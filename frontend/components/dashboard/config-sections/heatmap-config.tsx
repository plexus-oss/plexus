"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AdvancedGroup } from "./advanced-group";

const COLOR_SCALES = [
  { value: "viridis", label: "Viridis" },
  { value: "plasma", label: "Plasma" },
  { value: "inferno", label: "Inferno" },
  { value: "magma", label: "Magma" },
  { value: "turbo", label: "Turbo" },
];

interface Props {
  config: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
  metrics?: string[];
}

export function HeatmapConfig({ config, onChange }: Props) {
  return (
    <div className="px-3 py-2 border-b border-border space-y-3">
      {/* Essential */}
      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Color Scale
        </Label>
        <Select
          value={(config.colorScale as string) || "viridis"}
          onValueChange={(v) => onChange({ colorScale: v })}
        >
          <SelectTrigger className="h-7 text-xs mt-1.5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COLOR_SCALES.map((s) => (
              <SelectItem key={s.value} value={s.value} className="text-xs">
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <AdvancedGroup label="Bucketing">
        <div className="flex gap-2">
          <div className="flex-1">
            <Label className="text-[10px] text-muted-foreground">
              Time Buckets
            </Label>
            <div className="flex gap-1 mt-1">
              <Input
                type="number"
                min={2}
                max={50}
                value={(config.minTimeBuckets as number) ?? 6}
                onChange={(e) =>
                  onChange({ minTimeBuckets: parseInt(e.target.value) || 6 })
                }
                className="h-7 text-xs w-14"
                placeholder="Min"
              />
              <span className="text-[10px] text-muted-foreground self-center">
                –
              </span>
              <Input
                type="number"
                min={2}
                max={50}
                value={(config.maxTimeBuckets as number) ?? 20}
                onChange={(e) =>
                  onChange({ maxTimeBuckets: parseInt(e.target.value) || 20 })
                }
                className="h-7 text-xs w-14"
                placeholder="Max"
              />
            </div>
          </div>
          <div className="flex-1">
            <Label className="text-[10px] text-muted-foreground">
              Value Buckets
            </Label>
            <div className="flex gap-1 mt-1">
              <Input
                type="number"
                min={2}
                max={50}
                value={(config.minValueBuckets as number) ?? 5}
                onChange={(e) =>
                  onChange({ minValueBuckets: parseInt(e.target.value) || 5 })
                }
                className="h-7 text-xs w-14"
                placeholder="Min"
              />
              <span className="text-[10px] text-muted-foreground self-center">
                –
              </span>
              <Input
                type="number"
                min={2}
                max={50}
                value={(config.maxValueBuckets as number) ?? 15}
                onChange={(e) =>
                  onChange({ maxValueBuckets: parseInt(e.target.value) || 15 })
                }
                className="h-7 text-xs w-14"
                placeholder="Max"
              />
            </div>
          </div>
        </div>
      </AdvancedGroup>
    </div>
  );
}
