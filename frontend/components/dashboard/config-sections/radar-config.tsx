"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

interface Props {
  config: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
  metrics?: string[];
}

export function RadarConfig({ config, onChange }: Props) {
  return (
    <div className="px-3 py-2 border-b border-border space-y-3">
      <Label className="flex items-center gap-2 text-[11px]">
        <Checkbox
          checked={(config.showSweep as boolean) ?? false}
          onCheckedChange={(checked) => onChange({ showSweep: checked === true })}
          className="h-3 w-3"
        />
        Show sweep animation
      </Label>
      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Max Points
        </Label>
        <Input
          type="number"
          min={10}
          max={3600}
          value={(config.maxPoints as number) ?? 360}
          onChange={(e) => onChange({ maxPoints: parseInt(e.target.value) || 360 })}
          className="h-7 text-xs mt-1.5 w-20"
        />
      </div>
      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Max Range
        </Label>
        <Input
          type="number"
          min={1}
          value={(config.maxRange as number) ?? ""}
          onChange={(e) => onChange({ maxRange: e.target.value ? parseFloat(e.target.value) : undefined })}
          className="h-7 text-xs mt-1.5 w-20"
          placeholder="Auto"
        />
      </div>
    </div>
  );
}
