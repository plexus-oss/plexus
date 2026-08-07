"use client";

/**
 * Realtime aggregation in the same Show / Per grammar as connection panels
 * (client-side bucketing over `config.dataAggregation` — storage unchanged).
 * Show = which reduction ("Raw values" disables bucketing), Per = the bucket.
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import type {
  DataAggregation,
  TimeBucket,
  AggregationFunction,
  TimeRange,
} from "@/lib/types/dashboard";
import { parseRelativeTime } from "@/lib/types/dashboard";
import { MINUTE_MS, HOUR_MS, DAY_MS } from "@/lib/constants/time";

const TIME_BUCKETS: { value: TimeBucket; label: string }[] = [
  { value: "1m", label: "1 minute" },
  { value: "5m", label: "5 minutes" },
  { value: "15m", label: "15 minutes" },
  { value: "1h", label: "1 hour" },
  { value: "6h", label: "6 hours" },
  { value: "1d", label: "1 day" },
];

const AGG_FUNCTIONS: { value: AggregationFunction; label: string }[] = [
  { value: "avg", label: "Average" },
  { value: "min", label: "Min" },
  { value: "max", label: "Max" },
  { value: "sum", label: "Sum" },
  { value: "count", label: "Count" },
  { value: "first", label: "First" },
  { value: "last", label: "Last" },
];

function estimatePoints(
  bucket: TimeBucket,
  timeRange?: TimeRange,
): string | null {
  if (!timeRange || timeRange.type !== "relative") return null;
  const rangeMs = parseRelativeTime(timeRange.value);
  const bucketMs: Record<TimeBucket, number> = {
    "1m": MINUTE_MS,
    "5m": 5 * MINUTE_MS,
    "15m": 15 * MINUTE_MS,
    "1h": HOUR_MS,
    "6h": 6 * HOUR_MS,
    "1d": DAY_MS,
  };
  const points = Math.ceil(rangeMs / bucketMs[bucket]);
  return `~${points} points for ${timeRange.value}`;
}

interface AggregationPresetPickerProps {
  aggregation?: DataAggregation;
  onChange: (aggregation: DataAggregation) => void;
  timeRange?: TimeRange;
}

export function AggregationPresetPicker({
  aggregation,
  onChange,
  timeRange,
}: AggregationPresetPickerProps) {
  const isEnabled = aggregation?.enabled ?? false;
  const fn = aggregation?.function ?? "avg";
  const bucket = aggregation?.bucket ?? "5m";

  const pointEstimate = isEnabled
    ? estimatePoints(bucket, timeRange)
    : null;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
            Show
          </Label>
          <Select
            value={isEnabled ? fn : "raw"}
            onValueChange={(v) => {
              if (v === "raw") {
                onChange({ bucket, function: fn, enabled: false });
              } else {
                onChange({
                  bucket,
                  function: v as AggregationFunction,
                  enabled: true,
                });
              }
            }}
          >
            <SelectTrigger className="h-7 text-[11px] mt-1 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="raw" className="text-[11px]">
                Raw values
              </SelectItem>
              {AGG_FUNCTIONS.map((f) => (
                <SelectItem key={f.value} value={f.value} className="text-[11px]">
                  {f.label} of each metric
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
            Per
          </Label>
          <Select
            value={bucket}
            onValueChange={(v) =>
              onChange({
                bucket: v as TimeBucket,
                function: fn,
                enabled: true,
              })
            }
            disabled={!isEnabled}
          >
            <SelectTrigger className="h-7 text-[11px] mt-1 w-full">
              {isEnabled ? (
                <SelectValue />
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </SelectTrigger>
            <SelectContent>
              {TIME_BUCKETS.map((b) => (
                <SelectItem key={b.value} value={b.value} className="text-[11px]">
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {pointEstimate && (
        <p className="text-[10px] text-muted-foreground">{pointEstimate}</p>
      )}
    </div>
  );
}
