"use client";

/**
 * The three plain-language quick-chart dropdowns (Show / Per / Split by),
 * shared by the add-panel configurator and the sidebar's simple edit mode so
 * both flows stay identical.
 */

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BuilderTimeBucket } from "@/lib/types/dashboard";

export const BUCKET_OPTIONS: Array<{
  value: BuilderTimeBucket;
  label: string;
}> = [
  { value: "auto", label: "Auto" },
  { value: "hour", label: "Hour" },
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

export const BUCKET_PHRASE: Record<BuilderTimeBucket, string> = {
  auto: "over time",
  hour: "per hour",
  day: "per day",
  week: "per week",
  month: "per month",
};

const FN_LABEL: Record<string, string> = {
  avg: "Average",
  sum: "Sum",
  min: "Min",
  max: "Max",
};

interface QuickChartControlsProps {
  /** "count", "raw", or "<fn>:<column>" (e.g. "avg:amount"). */
  showKey: string;
  bucket: BuilderTimeBucket;
  /** "" = no breakdown. */
  groupBy: string;
  /** Numeric columns offered as aggregates. */
  measures: string[];
  /** Categorical columns offered for Split by. */
  dimensions: string[];
  /** Offer the "Raw values" Show option (plot rows without bucketing). */
  rawEnabled?: boolean;
  /** Grey out Per (raw mode — the server still auto-downsamples long ranges). */
  perDisabled?: boolean;
  onShowKeyChange: (key: string) => void;
  onBucketChange: (bucket: BuilderTimeBucket) => void;
  onGroupByChange: (column: string) => void;
}

export function QuickChartControls({
  showKey,
  bucket,
  groupBy,
  measures,
  dimensions,
  rawEnabled = false,
  perDisabled = false,
  onShowKeyChange,
  onBucketChange,
  onGroupByChange,
}: QuickChartControlsProps) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Show
        </Label>
        <Select value={showKey} onValueChange={onShowKeyChange}>
          <SelectTrigger className="h-7 text-[11px] mt-1 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="count" className="text-[11px]">
              Count of rows
            </SelectItem>
            {rawEnabled && (
              <SelectItem value="raw" className="text-[11px]">
                Raw values
              </SelectItem>
            )}
            {measures.flatMap((m) =>
              (["avg", "sum", "min", "max"] as const).map((fn) => (
                <SelectItem
                  key={`${fn}:${m}`}
                  value={`${fn}:${m}`}
                  className="text-[11px]"
                >
                  {FN_LABEL[fn]} of {m}
                </SelectItem>
              )),
            )}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Per
        </Label>
        <Select
          value={bucket}
          onValueChange={(v) => onBucketChange(v as BuilderTimeBucket)}
          disabled={perDisabled}
        >
          <SelectTrigger className="h-7 text-[11px] mt-1 w-full">
            {perDisabled ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <SelectValue />
            )}
          </SelectTrigger>
          <SelectContent>
            {BUCKET_OPTIONS.map((b) => (
              <SelectItem key={b.value} value={b.value} className="text-[11px]">
                {b.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Split by
        </Label>
        <Select
          value={groupBy || "__none__"}
          onValueChange={(v) => onGroupByChange(v === "__none__" ? "" : v)}
        >
          <SelectTrigger className="h-7 text-[11px] mt-1 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__" className="text-[11px]">
              None
            </SelectItem>
            {dimensions.map((d) => (
              <SelectItem key={d} value={d} className="text-[11px]">
                {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
