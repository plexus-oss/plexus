"use client";

/**
 * MetricCombobox — compact single-select metric dropdown for config
 * sidebars: type-to-search over the same source→metric discovery tree
 * the signal rail shows, grouped by device with online indicators.
 * Values are source-qualified (`source:metric`), the same form the
 * signal-rail drag payload uses and panels subscribe to.
 */

import { useMemo, useState } from "react";
import { ChevronDown, Search, Wifi, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useMergedMetricsBySource } from "@/hooks/use-merged-metrics";

export interface MetricComboboxProps {
  /** Bound metric, `source:metric` or bare metric name. */
  value?: string;
  onChange: (value: string | undefined) => void;
  /** Trigger text when nothing is bound (e.g. "Auto-detect", "Not set"). */
  emptyLabel: string;
  className?: string;
}

function splitKey(key: string): { source: string | null; metric: string } {
  const colon = key.indexOf(":");
  return colon === -1
    ? { source: null, metric: key }
    : { source: key.slice(0, colon), metric: key.slice(colon + 1) };
}

export function MetricCombobox({
  value,
  onChange,
  emptyLabel,
  className,
}: MetricComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { sources, isLoading } = useMergedMetricsBySource();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sources;
    return sources
      .map((s) =>
        s.source_id.toLowerCase().includes(q)
          ? s
          : {
              ...s,
              metrics: s.metrics.filter((m) => m.toLowerCase().includes(q)),
            },
      )
      .filter((s) => s.metrics.length > 0);
  }, [sources, query]);

  const pick = (next: string | undefined) => {
    onChange(next);
    setOpen(false);
    setQuery("");
  };

  const current = value ? splitKey(value) : null;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={
            "w-full h-7 px-2 flex items-center justify-between gap-1 rounded-md border border-input bg-background text-xs hover:bg-muted/50 transition-colors " +
            (className ?? "")
          }
        >
          {current ? (
            <span className="flex items-baseline gap-1.5 min-w-0">
              <span className="truncate">{current.metric}</span>
              {current.source && (
                <span className="text-[10px] text-muted-foreground truncate shrink-0">
                  {current.source}
                </span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground truncate">{emptyLabel}</span>
          )}
          <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-0"
        align="start"
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border p-1.5">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search devices, metrics…"
              autoFocus
              className="h-7 pl-7 text-[11px] bg-transparent border-0 outline-none placeholder:text-muted-foreground/60"
            />
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {value && (
            <button
              type="button"
              onClick={() => pick(undefined)}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-[11px] text-muted-foreground hover:bg-muted/60 transition-colors"
            >
              <X className="h-3 w-3" />
              {emptyLabel}
            </button>
          )}
          {isLoading && sources.length === 0 ? (
            <div className="p-3 flex justify-center">
              <Spinner />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-3 text-center text-[11px] text-muted-foreground">
              {sources.length === 0
                ? "No metrics yet — stream data and they’ll show up here."
                : `No matches for “${query}”`}
            </div>
          ) : (
            filtered.map((s) => (
              <div key={s.source_id}>
                <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  <span className="truncate">{s.source_id}</span>
                  {s.isOnline && (
                    <Wifi className="h-2.5 w-2.5 text-blue-500 shrink-0" />
                  )}
                </div>
                {s.metrics.map((m) => {
                  const key = `${s.source_id}:${m}`;
                  const isSelected = key === value;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => pick(key)}
                      className={
                        "w-full text-left px-2 py-1 pl-4 rounded text-[11px] truncate transition-colors " +
                        (isSelected
                          ? "bg-foreground/10 text-foreground"
                          : "hover:bg-muted/60")
                      }
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
