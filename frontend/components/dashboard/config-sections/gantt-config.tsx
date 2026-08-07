"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

interface Props {
  config: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
  metrics?: string[];
}

export function GanttConfig({ config, onChange }: Props) {
  return (
    <div className="px-3 py-2 border-b border-border space-y-3">
      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Time Window
        </Label>
        <div className="flex items-center gap-2 mt-1.5">
          <Input
            type="number"
            min={1}
            max={720}
            value={(config.timeWindowHours as number) ?? 24}
            onChange={(e) => onChange({ timeWindowHours: parseInt(e.target.value) || 24 })}
            className="h-7 text-xs w-20"
          />
          <span className="text-[10px] text-muted-foreground">hours</span>
        </div>
      </div>
      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Timezone
        </Label>
        <Input
          value={(config.timezone as string) || ""}
          onChange={(e) => onChange({ timezone: e.target.value || undefined })}
          className="h-7 text-xs mt-1.5"
          placeholder="UTC (default)"
        />
      </div>
      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Left Panel Header
        </Label>
        <Input
          value={(config.leftPanelHeader as string) || ""}
          onChange={(e) => onChange({ leftPanelHeader: e.target.value || undefined })}
          className="h-7 text-xs mt-1.5"
          placeholder="Task"
        />
      </div>
    </div>
  );
}
