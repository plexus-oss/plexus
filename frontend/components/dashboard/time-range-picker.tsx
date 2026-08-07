"use client";

import { useState, useCallback } from "react";
import { format } from "date-fns";
import { ArrowLeft, CalendarDays, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useRuns } from "@/hooks/use-runs";
import type { TimeRange } from "@/lib/types/dashboard";
import type { DateRange } from "react-day-picker";

interface TimeRangePickerProps {
  value: TimeRange;
  onChange: (value: TimeRange) => void;
  isLive: boolean;
  onGoLive: () => void;
}

const QUICK_RANGES = [
  { label: "10s", value: "10s" },
  { label: "30s", value: "30s" },
  { label: "1m", value: "1m" },
  { label: "5m", value: "5m" },
  { label: "15m", value: "15m" },
  { label: "1h", value: "1h" },
  { label: "6h", value: "6h" },
  { label: "24h", value: "24h" },
  { label: "7d", value: "7d" },
];

export function TimeRangePicker({
  value,
  onChange,
  isLive,
  onGoLive,
}: TimeRangePickerProps) {
  const [customOpen, setCustomOpen] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  // "Save as run" — names the framed window as a recallable test run.
  const [saveRunOpen, setSaveRunOpen] = useState(false);
  const [runName, setRunName] = useState("");
  const [savingRun, setSavingRun] = useState(false);
  const { createRun } = useRuns({ enabled: false });

  const handleSaveRun = useCallback(async () => {
    if (value.type !== "absolute" || !runName.trim() || savingRun) return;
    const [start, end] = value.value.split("/");
    setSavingRun(true);
    try {
      await createRun({
        name: runName.trim(),
        status: "completed",
        started_at: new Date(start).toISOString(),
        ended_at: new Date(end || Date.now()).toISOString(),
      });
      setSaveRunOpen(false);
      setRunName("");
    } catch {
      // createRun already toasts the failure
    } finally {
      setSavingRun(false);
    }
  }, [value, runName, savingRun, createRun]);

  const getAbsoluteDisplay = useCallback(() => {
    if (value.type !== "absolute") return "";
    const [start, end] = value.value.split("/");
    if (start && end) {
      const s = new Date(start);
      const e = new Date(end);
      // Same day? Show compact format
      if (s.toDateString() === e.toDateString()) {
        return `${format(s, "MMM d")} ${format(s, "HH:mm")}–${format(e, "HH:mm")}`;
      }
      return `${format(s, "MMM d, HH:mm")} – ${format(e, "MMM d, HH:mm")}`;
    }
    return "Custom range";
  }, [value]);

  const handleQuickRange = (rangeValue: string) => {
    // Quick ranges set a relative (live) range — data auto-updates
    onChange({ type: "relative", value: rangeValue });
  };

  const handleCustomApply = () => {
    if (dateRange?.from) {
      const start = dateRange.from.toISOString();
      const end = dateRange.to
        ? dateRange.to.toISOString()
        : new Date().toISOString();
      onChange({ type: "absolute", value: `${start}/${end}` });
      setCustomOpen(false);
    }
  };

  // ── Historical (absolute) mode ──
  if (!isLive) {
    return (
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={onGoLive}
          className="px-2 text-[11px] font-medium gap-1 h-7 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Live
        </Button>

        <div className="h-4 w-px bg-border mx-0.5" />

        <span className="text-[11px] text-muted-foreground font-mono px-1.5">
          {getAbsoluteDisplay()}
        </span>
        <span
          className="text-[9px] font-medium text-muted-foreground/70 uppercase tracking-wider px-1 py-0.5 rounded bg-muted/50 border border-border"
          title="Times shown in your local timezone. Charts display UTC."
        >
          Local
        </span>

        <Popover open={customOpen} onOpenChange={setCustomOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="px-2 text-[11px] font-normal gap-1 h-7 text-muted-foreground hover:text-foreground"
            >
              <CalendarDays className="h-3 w-3" />
              Change
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start" sideOffset={4}>
            <div className="p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  Select date range
                </div>
                <span className="text-[9px] font-medium text-muted-foreground/70 uppercase tracking-wider px-1 py-0.5 rounded bg-muted/50 border border-border">
                  Local
                </span>
              </div>
              <Calendar
                mode="range"
                selected={dateRange}
                onSelect={setDateRange}
                numberOfMonths={2}
                disabled={{ after: new Date() }}
                className="rounded-md border"
              />
              <div className="flex items-center justify-between pt-2 border-t">
                <div className="text-[10px] text-muted-foreground">
                  {dateRange?.from ? (
                    dateRange.to ? (
                      <>
                        {format(dateRange.from, "LLL dd, yyyy HH:mm")} -{" "}
                        {format(dateRange.to, "LLL dd, yyyy HH:mm")}
                      </>
                    ) : (
                      format(dateRange.from, "LLL dd, yyyy HH:mm")
                    )
                  ) : (
                    "Select start and end dates"
                  )}
                </div>
                <Button
                  size="sm"
                  className="h-6 text-[10px]"
                  onClick={handleCustomApply}
                  disabled={!dateRange?.from}
                >
                  Apply
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  // ── Live (relative) mode ──
  const activeRange = value.type === "relative" ? value.value : null;

  return (
    <div className="flex items-center gap-1">
      {/* Live status pill */}
      <div className="flex items-center gap-1.5 px-2 py-0.5 h-7">
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
        </span>
        <span className="text-[11px] font-medium text-emerald-500">Live</span>
      </div>

      <div className="h-4 w-px bg-border mx-0.5" />

      {/* Quick range chips */}
      <div className="flex items-center gap-0.5">
        {QUICK_RANGES.map((range) => (
          <button
            key={range.value}
            onClick={() => handleQuickRange(range.value)}
            className={cn(
              "px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors h-6",
              activeRange === range.value
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
          >
            {range.label}
          </button>
        ))}
      </div>

      <div className="h-4 w-px bg-border mx-0.5" />

      {/* Custom range */}
      <Popover open={customOpen} onOpenChange={setCustomOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="px-2 text-[11px] font-normal gap-1 h-7 text-muted-foreground hover:text-foreground"
          >
            <CalendarDays className="h-3 w-3" />
            Custom
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start" sideOffset={4}>
          <div className="p-3 space-y-3">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Select date range
            </div>
            <Calendar
              mode="range"
              selected={dateRange}
              onSelect={setDateRange}
              numberOfMonths={2}
              disabled={{ after: new Date() }}
              className="rounded-md border"
            />
            <div className="flex items-center justify-between pt-2 border-t">
              <div className="text-[10px] text-muted-foreground">
                {dateRange?.from ? (
                  dateRange.to ? (
                    <>
                      {format(dateRange.from, "LLL dd, yyyy HH:mm")} -{" "}
                      {format(dateRange.to, "LLL dd, yyyy HH:mm")}
                    </>
                  ) : (
                    format(dateRange.from, "LLL dd, yyyy HH:mm")
                  )
                ) : (
                  "Select start and end dates"
                )}
              </div>
              <Button
                size="sm"
                className="h-6 text-[10px]"
                onClick={handleCustomApply}
                disabled={!dateRange?.from}
              >
                Apply
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <Popover
        open={saveRunOpen}
        onOpenChange={(o) => {
          setSaveRunOpen(o);
          if (o && !runName) {
            const [start] = value.value.split("/");
            const s = new Date(start);
            if (!isNaN(s.getTime())) {
              setRunName(`Test run ${format(s, "MMM d HH:mm")}`);
            }
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="px-2 text-[11px] font-normal gap-1 h-7 text-muted-foreground hover:text-foreground"
            title="Save this time window as a named test run — recall it from /runs or overlay it with Compare"
          >
            <FlaskConical className="h-3 w-3" />
            Save as run
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[260px] p-3" align="start" sideOffset={4}>
          <div className="space-y-2.5">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Save window as run
            </div>
            <input
              autoFocus
              value={runName}
              onChange={(e) => setRunName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveRun();
                if (e.key === "Escape") setSaveRunOpen(false);
              }}
              placeholder="Run name"
              className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground/50"
            />
            <div className="flex items-center justify-between pt-2 border-t">
              <span className="text-[10px] text-muted-foreground font-mono">
                {getAbsoluteDisplay()}
              </span>
              <Button
                size="sm"
                className="h-6 text-[10px]"
                onClick={handleSaveRun}
                loading={savingRun}
                disabled={!runName.trim()}
              >
                Save
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              <kbd className="font-mono">Enter</kbd> to save ·{" "}
              <kbd className="font-mono">Esc</kbd> to cancel
            </p>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
