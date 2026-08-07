"use client";

/**
 * Transform Editor
 *
 * UI for adding/editing computed metric transforms on a panel.
 * Supports rolling_avg, delta, rate, ratio, and expression transforms.
 */

import { useState, useCallback } from "react";
import { Plus } from "lucide-react";
import { DeleteButton } from "@/components/ui/delete-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Transform, TransformType } from "@/lib/transforms";

const TRANSFORM_TYPES: { value: TransformType; label: string }[] = [
  { value: "rolling_avg", label: "Rolling Average" },
  { value: "delta", label: "Delta (Difference)" },
  { value: "rate", label: "Rate (/sec)" },
  { value: "ratio", label: "Ratio (A/B)" },
  { value: "expression", label: "Expression" },
];

interface TransformEditorProps {
  transforms: Transform[];
  metrics: string[];
  onChange: (transforms: Transform[]) => void;
}

export function TransformEditor({
  transforms,
  metrics,
  onChange,
}: TransformEditorProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const addTransform = useCallback(() => {
    const newTransform: Transform = {
      type: "rolling_avg",
      window: 10,
    };
    onChange([...transforms, newTransform]);
    setExpandedIndex(transforms.length);
  }, [transforms, onChange]);

  const removeTransform = useCallback(
    (index: number) => {
      const next = transforms.filter((_, i) => i !== index);
      onChange(next);
      if (expandedIndex === index) setExpandedIndex(null);
    },
    [transforms, onChange, expandedIndex],
  );

  const updateTransform = useCallback(
    (index: number, updates: Partial<Transform>) => {
      const next = transforms.map((t, i) =>
        i === index ? { ...t, ...updates } : t,
      );
      onChange(next);
    },
    [transforms, onChange],
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Transforms
        </Label>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[10px] px-2"
          onClick={addTransform}
        >
          <Plus className="h-3 w-3 mr-1" />
          Add
        </Button>
      </div>

      {transforms.length === 0 && (
        <p className="text-[11px] text-muted-foreground py-2">
          Compute derived metrics — rolling averages, rates of change, or custom formulas.
        </p>
      )}

      {transforms.map((transform, index) => {
        const typeDef = TRANSFORM_TYPES.find((t) => t.value === transform.type);
        const isExpanded = expandedIndex === index;

        return (
          <div
            key={index}
            className="border border-border rounded-md bg-muted/30"
          >
            <Button
              variant="ghost"
              onClick={() => setExpandedIndex(isExpanded ? null : index)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left h-auto justify-start"
            >
              <span className="text-xs flex-1 truncate">
                {typeDef?.label || transform.type}
              </span>
              <DeleteButton
                entityName="transform"
                onConfirm={() => removeTransform(index)}
                skipConfirm
                className="h-5 w-5 p-0 shrink-0"
              />
            </Button>

            {isExpanded && (
              <div className="px-2.5 pb-2.5 space-y-2 border-t border-border pt-2">
                <div>
                  <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                    Type
                  </Label>
                  <Select
                    value={transform.type}
                    onValueChange={(val) => {
                      const updates: Transform = { type: val as TransformType };
                      if (val === "rolling_avg") updates.window = 10;
                      if (val === "expression") updates.formula = "x";
                      updateTransform(index, updates);
                    }}
                  >
                    <SelectTrigger className="h-7 text-xs mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TRANSFORM_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {transform.type === "rolling_avg" && (
                  <div>
                    <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                      Window Size
                    </Label>
                    <Input
                      type="number"
                      className="h-7 text-xs mt-1"
                      value={transform.window || 10}
                      min={2}
                      max={500}
                      onChange={(e) =>
                        updateTransform(index, {
                          window: parseInt(e.target.value) || 10,
                        })
                      }
                    />
                  </div>
                )}

                {transform.type === "expression" && (
                  <div>
                    <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                      Formula
                    </Label>
                    <Input
                      className="h-7 text-xs mt-1 font-mono"
                      placeholder="e.g., x * 1.8 + 32"
                      value={transform.formula || ""}
                      onChange={(e) =>
                        updateTransform(index, { formula: e.target.value })
                      }
                    />
                  </div>
                )}

                {transform.type === "ratio" && (
                  <div>
                    <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                      Denominator Metric
                    </Label>
                    <Select
                      value={transform.metricB || ""}
                      onValueChange={(val) =>
                        updateTransform(index, { metricB: val })
                      }
                    >
                      <SelectTrigger className="h-7 text-xs mt-1">
                        <SelectValue placeholder="Select metric" />
                      </SelectTrigger>
                      <SelectContent>
                        {metrics.map((m) => (
                          <SelectItem key={m} value={m}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
