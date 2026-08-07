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

export function CalendarConfig({ config, onChange, metrics = [] }: Props) {
  const view = (config.view as string) || "month";
  return (
    <div className="px-3 py-2 border-b border-border space-y-3">
      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          View
        </Label>
        <Select
          value={view}
          onValueChange={(v) => onChange({ view: v })}
        >
          <SelectTrigger className="h-7 text-xs mt-1.5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="month" className="text-xs">
              Month grid
            </SelectItem>
            <SelectItem value="heatmap" className="text-xs">
              Activity heatmap
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      {view === "heatmap" && (
        <div>
          <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
            Heatmap Weeks
          </Label>
          <Input
            type="number"
            min={4}
            max={104}
            value={(config.heatmapWeeks as number) ?? 26}
            onChange={(e) =>
              onChange({ heatmapWeeks: parseInt(e.target.value) || 26 })
            }
            className="h-7 text-xs mt-1.5 w-20"
          />
        </div>
      )}
      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Event Metric
        </Label>
        <Select
          value={(config.eventMetric as string) || ""}
          onValueChange={(v) => onChange({ eventMetric: v || undefined })}
        >
          <SelectTrigger className="h-7 text-xs mt-1.5">
            <SelectValue placeholder="Select metric..." />
          </SelectTrigger>
          <SelectContent>
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
          Date Metric
        </Label>
        <Select
          value={(config.dateMetric as string) || ""}
          onValueChange={(v) => onChange({ dateMetric: v || undefined })}
        >
          <SelectTrigger className="h-7 text-xs mt-1.5">
            <SelectValue placeholder="Select metric..." />
          </SelectTrigger>
          <SelectContent>
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
          checked={(config.showEventCount as boolean) ?? true}
          onCheckedChange={(checked) => onChange({ showEventCount: checked === true })}
          className="h-3 w-3"
        />
        Show event count
      </Label>
      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Highlight Color
        </Label>
        <Input
          value={(config.highlightColor as string) || ""}
          onChange={(e) => onChange({ highlightColor: e.target.value || undefined })}
          className="h-7 text-xs mt-1.5"
          placeholder="#3b82f6"
        />
      </div>
    </div>
  );
}
