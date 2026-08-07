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
import { Plus, Trash2 } from "lucide-react";
import type { AssocCategory, GlyphShape } from "@/lib/types/dashboard";
import { SAMPLE_CATEGORIES } from "@/lib/panels/assoc-scatter";

interface Props {
  config: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
  metrics?: string[];
}

const SHAPES: GlyphShape[] = ["circle", "diamond", "square", "triangle"];

export function AssocScatterConfig({ config, onChange }: Props) {
  const categories = (config.assocCategories as AssocCategory[] | undefined) ?? [];

  const setCat = (i: number, patch: Partial<AssocCategory>) => {
    const next = categories.map((c, idx) => (idx === i ? { ...c, ...patch } : c));
    onChange({ assocCategories: next });
  };
  const addCat = () => {
    onChange({
      assocCategories: [
        ...categories,
        { value: "", label: "New category", color: "#6b7280", shape: "circle", filled: true },
      ],
    });
  };
  const removeCat = (i: number) => {
    onChange({ assocCategories: categories.filter((_, idx) => idx !== i) });
  };
  const loadDefaults = () => onChange({ assocCategories: SAMPLE_CATEGORIES });

  const colInput = (
    key: "timeColumn" | "yColumn" | "categoryColumn",
    label: string,
    placeholder: string,
  ) => (
    <div className="mt-2">
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <Input
        value={(config[key] as string) || ""}
        onChange={(e) => onChange({ [key]: e.target.value || undefined })}
        className="h-7 text-xs mt-1 font-mono"
        placeholder={placeholder}
      />
    </div>
  );

  return (
    <>
      {/* Column mapping */}
      <div className="px-3 py-2 border-b border-border">
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Columns
        </Label>
        <p className="text-[10px] text-muted-foreground/70 mt-1">
          X is time — set the connection&apos;s time column so the dashboard range,
          zoom, and pan apply. Left blank, columns are auto-detected.
        </p>
        {colInput("timeColumn", "Time column (X)", "time")}
        {colInput("yColumn", "Y lanes (id)", "satellite_id")}
        {colInput("categoryColumn", "Category (status)", "association_status")}
      </div>

      {/* Axis labels */}
      <div className="px-3 py-2 border-b border-border">
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Axis Labels
        </Label>
        <div className="mt-2">
          <Label className="text-[10px] text-muted-foreground">X-Axis Label</Label>
          <Input
            value={(config.xAxisLabel as string) || ""}
            onChange={(e) => onChange({ xAxisLabel: e.target.value || undefined })}
            className="h-7 text-xs mt-1"
            placeholder="Measurement Collect #"
          />
        </div>
        <div className="mt-2">
          <Label className="text-[10px] text-muted-foreground">Y-Axis Label</Label>
          <Input
            value={(config.yAxisLabel as string) || ""}
            onChange={(e) => onChange({ yAxisLabel: e.target.value || undefined })}
            className="h-7 text-xs mt-1"
            placeholder="Satellite IDs"
          />
        </div>
      </div>

      {/* Legend / categories */}
      <div className="px-3 py-2 border-b border-border">
        <div className="flex items-center justify-between">
          <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
            Legend
          </Label>
          {categories.length === 0 ? (
            <button
              onClick={loadDefaults}
              className="text-[10px] text-primary hover:underline"
            >
              Load defaults
            </button>
          ) : (
            <button
              onClick={addCat}
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-3 w-3" /> Add
            </button>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground/70 mt-1">
          Categories auto-derive from the data; override color, shape, and label here.
        </p>

        <div className="mt-2 space-y-2">
          {categories.map((c, i) => (
            <div
              key={i}
              className="rounded-md border border-border/60 p-2 space-y-1.5"
            >
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={/^#[0-9a-f]{6}$/i.test(c.color) ? c.color : "#6b7280"}
                  onChange={(e) => setCat(i, { color: e.target.value })}
                  className="h-6 w-6 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
                  aria-label="Marker color"
                />
                <Input
                  value={c.label}
                  onChange={(e) => setCat(i, { label: e.target.value })}
                  className="h-6 text-xs"
                  placeholder="Label"
                />
                <button
                  onClick={() => removeCat(i)}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label="Remove category"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <Input
                  value={c.value}
                  onChange={(e) => setCat(i, { value: e.target.value })}
                  className="h-6 text-xs font-mono"
                  placeholder="data value"
                />
                <Select
                  value={c.shape}
                  onValueChange={(v) => setCat(i, { shape: v as GlyphShape })}
                >
                  <SelectTrigger className="h-6 w-24 text-xs shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SHAPES.map((s) => (
                      <SelectItem key={s} value={s} className="text-xs capitalize">
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Label className="flex items-center gap-2 text-[11px]">
                <Checkbox
                  checked={c.filled}
                  onCheckedChange={(checked) => setCat(i, { filled: checked === true })}
                  className="h-3 w-3"
                />
                Filled
              </Label>
            </div>
          ))}
        </div>
      </div>

      {/* Display */}
      <div className="px-3 py-2 border-b border-border space-y-2">
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Display
        </Label>
        <div className="space-y-1.5">
          <Label className="flex items-center gap-2 text-[11px]">
            <Checkbox
              checked={(config.showGrid as boolean) ?? true}
              onCheckedChange={(checked) => onChange({ showGrid: checked === true })}
              className="h-3 w-3"
            />
            Show grid
          </Label>
          <Label className="flex items-center gap-2 text-[11px]">
            <Checkbox
              checked={(config.showLegend as boolean) ?? true}
              onCheckedChange={(checked) => onChange({ showLegend: checked === true })}
              className="h-3 w-3"
            />
            Show legend
          </Label>
        </div>
      </div>
    </>
  );
}
