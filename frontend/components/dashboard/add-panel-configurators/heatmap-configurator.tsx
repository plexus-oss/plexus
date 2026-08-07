"use client";

/**
 * HeatmapConfigurator — three named slots (X axis, Y axis, Value).
 *
 * Each slot is its own single-metric pick. Stored on `config.heatmap`
 * so the panel renderer can read x/y/value without parsing positional
 * order out of `metrics`. The `metrics` array still holds the same three
 * keys so subscription / streaming logic that iterates `metrics` keeps
 * working.
 */

import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Label } from "@/components/ui/label";
import { InlineMetricPicker } from "./inline-metric-picker";
import type { ConfiguratorProps } from "./types";

type Slot = "x" | "y" | "value";

const SLOT_LABELS: Record<Slot, string> = {
  x: "X axis",
  y: "Y axis",
  value: "Value",
};

interface HeatmapBinding {
  x?: string;
  y?: string;
  value?: string;
}

export function HeatmapConfigurator({
  draft,
  onChange,
  onValidChange,
}: ConfiguratorProps) {
  const binding =
    ((draft.config as { heatmap?: HeatmapBinding }).heatmap as
      | HeatmapBinding
      | undefined) ?? {};

  const [expanded, setExpanded] = useState<Slot>(() => {
    if (!binding.x) return "x";
    if (!binding.y) return "y";
    return "value";
  });

  const isValid = useMemo(
    () => !!(binding.x && binding.y && binding.value),
    [binding.x, binding.y, binding.value],
  );

  useEffect(() => {
    onValidChange(isValid);
  }, [isValid, onValidChange]);

  const setSlot = (slot: Slot, metricKey: string | undefined) => {
    const next: HeatmapBinding = { ...binding, [slot]: metricKey };
    const ordered = [next.x, next.y, next.value].filter(
      (m): m is string => !!m,
    );
    onChange({
      ...draft,
      metrics: ordered,
      dataSource: draft.dataSource ?? { type: "realtime" },
      config: { ...draft.config, heatmap: next },
    });
  };

  return (
    <div className="flex flex-col h-full gap-2">
      {(["x", "y", "value"] as Slot[]).map((slot) => {
        const value = binding[slot];
        const isOpen = expanded === slot;
        return (
          <div key={slot} className="border border-border rounded">
            <button
              type="button"
              onClick={() => setExpanded(slot)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-left"
            >
              <ChevronRight
                className={
                  "h-3 w-3 text-muted-foreground transition-transform " +
                  (isOpen ? "rotate-90" : "")
                }
              />
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground cursor-pointer">
                {SLOT_LABELS[slot]}
              </Label>
              <span className="ml-auto text-[11px] truncate max-w-[60%] text-foreground">
                {value ?? <span className="text-muted-foreground">Not set</span>}
              </span>
            </button>
            {isOpen && (
              <div className="px-2 pb-2 pt-1 max-h-56 flex">
                <InlineMetricPicker
                  mode="single"
                  selected={value ? [value] : []}
                  onChange={(m) => {
                    setSlot(slot, m[0]);
                    if (m[0]) {
                      const order: Slot[] = ["x", "y", "value"];
                      const next = order.find(
                        (s) => s !== slot && !binding[s] && s !== slot,
                      );
                      if (next) setExpanded(next);
                    }
                  }}
                  placeholder={`Search ${SLOT_LABELS[slot].toLowerCase()} metric…`}
                  hideChips
                  className="flex-1"
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
