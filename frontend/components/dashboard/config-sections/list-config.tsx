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

export function ListConfig({ config, onChange, metrics = [] }: Props) {
  return (
    <div className="px-3 py-2 border-b border-border space-y-3">
      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Density
        </Label>
        <Select
          value={(config.density as string) || "compact"}
          onValueChange={(v) => onChange({ density: v })}
        >
          <SelectTrigger className="h-7 text-xs mt-1.5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="compact" className="text-xs">
              Compact
            </SelectItem>
            <SelectItem value="cozy" className="text-xs">
              Cozy
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Label className="flex items-center gap-2 text-[11px]">
        <Checkbox
          checked={(config.showTimestamp as boolean) ?? true}
          onCheckedChange={(checked) => onChange({ showTimestamp: checked === true })}
          className="h-3 w-3"
        />
        Show timestamps
      </Label>
      <Label className="flex items-center gap-2 text-[11px]">
        <Checkbox
          checked={(config.showStatus as boolean) ?? true}
          onCheckedChange={(checked) => onChange({ showStatus: checked === true })}
          className="h-3 w-3"
        />
        Show status
      </Label>
      <Label className="flex items-center gap-2 text-[11px]">
        <Checkbox
          checked={(config.showTimeline as boolean) ?? true}
          onCheckedChange={(checked) => onChange({ showTimeline: checked === true })}
          className="h-3 w-3"
        />
        Show timeline rail
      </Label>
      <Label className="flex items-center gap-2 text-[11px]">
        <Checkbox
          checked={(config.hideSearch as boolean) ?? false}
          onCheckedChange={(checked) => onChange({ hideSearch: checked === true })}
          className="h-3 w-3"
        />
        Hide search
      </Label>
      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Timestamp Format
        </Label>
        <Select
          value={(config.timestampFormat as string) || "relative"}
          onValueChange={(v) => onChange({ timestampFormat: v })}
        >
          <SelectTrigger className="h-7 text-xs mt-1.5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="relative" className="text-xs">Relative</SelectItem>
            <SelectItem value="absolute" className="text-xs">Absolute</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Max Items
        </Label>
        <Input
          type="number"
          min={1}
          max={1000}
          value={(config.maxItems as number) ?? 50}
          onChange={(e) => onChange({ maxItems: parseInt(e.target.value) || 50 })}
          className="h-7 text-xs mt-1.5 w-20"
        />
      </div>
      {metrics.length > 0 && (
        <>
          <div>
            <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
              Title Metric
            </Label>
            <Select
              value={(config.titleMetric as string) || ""}
              onValueChange={(v) => onChange({ titleMetric: v || undefined })}
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
              Description Metric
            </Label>
            <Select
              value={(config.descriptionMetric as string) || ""}
              onValueChange={(v) => onChange({ descriptionMetric: v || undefined })}
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
        </>
      )}
    </div>
  );
}
