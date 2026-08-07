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
import { AdvancedGroup } from "./advanced-group";

const AGGREGATIONS = [
  { value: "last", label: "Last" },
  { value: "avg", label: "Average" },
  { value: "min", label: "Min" },
  { value: "max", label: "Max" },
  { value: "sum", label: "Sum" },
  { value: "count", label: "Count (sources with data)" },
];

interface Props {
  config: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
  metrics?: string[];
}

export function StatConfig({ config, onChange }: Props) {
  return (
    <div className="px-3 py-2 border-b border-border space-y-3">
      {/* Essential: what the number means */}
      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Aggregation
        </Label>
        <Select
          value={(config.aggregation as string) || "last"}
          onValueChange={(v) => onChange({ aggregation: v })}
        >
          <SelectTrigger className="h-7 text-xs mt-1.5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AGGREGATIONS.map((agg) => (
              <SelectItem key={agg.value} value={agg.value} className="text-xs">
                {agg.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <AdvancedGroup>
        <div className="space-y-3">
          <Label className="flex items-center gap-2 text-[11px]">
            <Checkbox
              checked={(config.showSparkline as boolean) ?? true}
              onCheckedChange={(checked) =>
                onChange({ showSparkline: checked === true })
              }
              className="h-3 w-3"
            />
            Show sparkline
          </Label>
          <Label className="flex items-center gap-2 text-[11px]">
            <Checkbox
              checked={(config.showTrend as boolean) ?? true}
              onCheckedChange={(checked) =>
                onChange({ showTrend: checked === true })
              }
              className="h-3 w-3"
            />
            Show trend
          </Label>
          <div>
            <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
              Trend Window
            </Label>
            <Input
              type="number"
              min={5}
              max={100}
              value={(config.trendWindow as number) ?? 20}
              onChange={(e) =>
                onChange({ trendWindow: parseInt(e.target.value) || 20 })
              }
              className="h-7 text-xs mt-1.5 w-20"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Number of recent data points for trend calculation
            </p>
          </div>
        </div>
      </AdvancedGroup>
    </div>
  );
}
