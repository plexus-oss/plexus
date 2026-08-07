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

const SEVERITIES = ["critical", "warning", "success", "info"] as const;
const CATEGORIES = [
  "device",
  "alert",
  "dashboard",
  "webhook",
  "connection",
  "auth",
  "org",
] as const;

export function EventsConfig({ config, onChange }: Props) {
  const severity = (config.severity as string) || "";
  const category = (config.category as string) || "";

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
          Device slug to filter events to
        </p>
      </div>

      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Severity
        </Label>
        <Select
          value={severity || "all"}
          onValueChange={(v) =>
            onChange({ severity: v === "all" ? undefined : v })
          }
        >
          <SelectTrigger className="h-7 text-xs mt-1.5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severities</SelectItem>
            {SEVERITIES.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Category
        </Label>
        <Select
          value={category || "all"}
          onValueChange={(v) =>
            onChange({ category: v === "all" ? undefined : v })
          }
        >
          <SelectTrigger className="h-7 text-xs mt-1.5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c} className="capitalize">
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Event Type
        </Label>
        <Input
          value={(config.eventType as string) || ""}
          onChange={(e) => onChange({ eventType: e.target.value || undefined })}
          className="h-7 text-xs mt-1.5 font-mono"
          placeholder="device.offline"
        />
        <p className="text-[9px] text-muted-foreground mt-1">
          Exact event type, e.g. <code>alert.triggered</code>
        </p>
      </div>

      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Max Items
        </Label>
        <Input
          type="number"
          min={1}
          max={500}
          value={(config.maxItems as number) ?? 50}
          onChange={(e) =>
            onChange({ maxItems: parseInt(e.target.value) || 50 })
          }
          className="h-7 text-xs mt-1.5 w-20"
        />
      </div>

      <Label className="flex items-center gap-2 text-[11px]">
        <Checkbox
          checked={(config.grouped as boolean) ?? true}
          onCheckedChange={(checked) => onChange({ grouped: checked === true })}
          className="h-3 w-3"
        />
        Group bursts by source
      </Label>

      <Label className="flex items-center gap-2 text-[11px]">
        <Checkbox
          checked={(config.showJumpLink as boolean) ?? true}
          onCheckedChange={(checked) =>
            onChange({ showJumpLink: checked === true })
          }
          className="h-3 w-3"
        />
        Show &ldquo;View all&rdquo; link
      </Label>
    </div>
  );
}
