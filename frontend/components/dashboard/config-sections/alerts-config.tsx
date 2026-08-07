"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

interface Props {
  config: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
  metrics?: string[];
}

export function AlertsConfig({ config, onChange }: Props) {
  return (
    <div className="px-3 py-2 border-b border-border space-y-3">
      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Source Filter
        </Label>
        <Input
          value={(config.sourceId as string) || ""}
          onChange={(e) => onChange({ sourceId: e.target.value || undefined })}
          className="h-7 text-xs mt-1.5"
          placeholder="All sources"
        />
        <p className="text-[9px] text-muted-foreground mt-1">
          Filter alerts to a specific device slug
        </p>
      </div>
      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Max Items
        </Label>
        <Input
          type="number"
          min={1}
          max={100}
          value={(config.maxItems as number) ?? 10}
          onChange={(e) => onChange({ maxItems: parseInt(e.target.value) || 10 })}
          className="h-7 text-xs mt-1.5 w-20"
        />
      </div>
      <Label className="flex items-center gap-2 text-[11px]">
        <Checkbox
          checked={(config.showResolved as boolean) ?? false}
          onCheckedChange={(checked) => onChange({ showResolved: checked === true })}
          className="h-3 w-3"
        />
        Show resolved alerts
      </Label>
      <Label className="flex items-center gap-2 text-[11px]">
        <Checkbox
          checked={(config.showSourceName as boolean) ?? true}
          onCheckedChange={(checked) => onChange({ showSourceName: checked === true })}
          className="h-3 w-3"
        />
        Show source name
      </Label>
    </div>
  );
}
