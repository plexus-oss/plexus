"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

interface Props {
  config: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
  metrics?: string[];
}

export function DashboardPanelConfig({ config, onChange }: Props) {
  return (
    <>
    <div className="px-3 py-2 border-b border-border space-y-3">
      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Dashboard ID
        </Label>
        <Input
          value={(config.dashboardId as string) || ""}
          onChange={(e) => onChange({ dashboardId: e.target.value || undefined })}
          className="h-7 text-xs mt-1.5"
          placeholder="Linked dashboard ID"
        />
      </div>
      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Status Metric
        </Label>
        <Input
          value={(config.statusMetric as string) || ""}
          onChange={(e) => onChange({ statusMetric: e.target.value || undefined })}
          className="h-7 text-xs mt-1.5"
          placeholder="Metric for status indicator"
        />
      </div>
    </div>
    <div className="px-3 py-2 border-b border-border space-y-2">
      <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
        Display
      </Label>
      <Label className="flex items-center gap-2 text-[11px]">
        <Checkbox
          checked={(config.showDescription as boolean) ?? true}
          onCheckedChange={(checked) => onChange({ showDescription: checked === true })}
          className="h-3 w-3"
        />
        Show description
      </Label>
      <Label className="flex items-center gap-2 text-[11px]">
        <Checkbox
          checked={(config.showPanelCount as boolean) ?? true}
          onCheckedChange={(checked) => onChange({ showPanelCount: checked === true })}
          className="h-3 w-3"
        />
        Show panel count
      </Label>
      <Label className="flex items-center gap-2 text-[11px]">
        <Checkbox
          checked={(config.showLastUpdated as boolean) ?? true}
          onCheckedChange={(checked) => onChange({ showLastUpdated: checked === true })}
          className="h-3 w-3"
        />
        Show last updated
      </Label>
    </div>
    </>
  );
}
