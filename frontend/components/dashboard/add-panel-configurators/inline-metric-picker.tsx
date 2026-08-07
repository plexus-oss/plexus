"use client";

/**
 * InlineMetricPicker — the shared right-pane data picker for shape-aware
 * Add Panel configurators.
 *
 * Replaces the popover-driven `DataSourceSelector` flow for *realtime*
 * metrics. One persistent search input + a flat virtualized list of
 * `source:metric` leaves; no nested popovers, no "open / pick / close"
 * loop. Connection-query sources still go through `DataSourceSelector`
 * for now (different data model — SQL/Flux query, not a metric list).
 */

import { useMemo, useState } from "react";
import { Check, Search, Wifi, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { useAvailableMetrics } from "@/hooks/use-telemetry";
import { usePlexusRealtime } from "@/hooks/use-plexus-realtime";

export interface InlineMetricPickerProps {
  mode: "single" | "multi";
  /** Selected metric keys in `source:metric` form. */
  selected: string[];
  onChange: (next: string[]) => void;
  /** Restrict the candidate set (e.g. only lat/lon metrics for `map`). */
  filter?: (sourceId: string, metric: string) => boolean;
  /** Lock the picker to a single source (e.g. radar/attitude after device pick). */
  sourceId?: string;
  placeholder?: string;
  className?: string;
  /** Hide the chip row above the list (e.g. when the parent renders chips). */
  hideChips?: boolean;
}

interface PickerEntry {
  sourceId: string;
  metric: string;
  key: string;
  isOnline: boolean;
}

export function InlineMetricPicker({
  mode,
  selected,
  onChange,
  filter,
  sourceId: lockedSourceId,
  placeholder = "Search metrics…",
  className,
  hideChips,
}: InlineMetricPickerProps) {
  const [query, setQuery] = useState("");
  const { metricsBySource, isLoading: metricsLoading } = useAvailableMetrics();
  const { sources: rtSources } = usePlexusRealtime();

  const entries = useMemo<PickerEntry[]>(() => {
    const byKey = new Map<string, PickerEntry>();
    const online = new Set<string>();
    for (const rt of rtSources) online.add(rt.source_id);

    const push = (sourceId: string, metric: string) => {
      const key = `${sourceId}:${metric}`;
      if (byKey.has(key)) return;
      byKey.set(key, { sourceId, metric, key, isOnline: online.has(sourceId) });
    };

    for (const s of metricsBySource) {
      if (lockedSourceId && s.source_id !== lockedSourceId) continue;
      for (const m of s.metrics) push(s.source_id, m);
    }
    for (const rt of rtSources) {
      if (lockedSourceId && rt.source_id !== lockedSourceId) continue;
      for (const sensor of rt.sensors ?? []) {
        if (!sensor.available || !sensor.metrics) continue;
        for (const m of sensor.metrics) push(rt.source_id, m);
      }
    }

    return Array.from(byKey.values()).sort((a, b) => {
      if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
      const s = a.sourceId.localeCompare(b.sourceId);
      return s !== 0 ? s : a.metric.localeCompare(b.metric);
    });
  }, [metricsBySource, rtSources, lockedSourceId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (filter && !filter(e.sourceId, e.metric)) return false;
      if (!q) return true;
      return (
        e.sourceId.toLowerCase().includes(q) ||
        e.metric.toLowerCase().includes(q) ||
        e.key.toLowerCase().includes(q)
      );
    });
  }, [entries, query, filter]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const toggle = (key: string) => {
    if (mode === "single") {
      onChange(selectedSet.has(key) ? [] : [key]);
      return;
    }
    if (selectedSet.has(key)) {
      onChange(selected.filter((k) => k !== key));
    } else {
      onChange([...selected, key]);
    }
  };

  return (
    <div className={`flex flex-col min-h-0 ${className ?? ""}`}>
      {!hideChips && selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {selected.map((key) => {
            const colon = key.indexOf(":");
            const label = colon !== -1 ? key.substring(colon + 1) : key;
            return (
              <Badge
                key={key}
                variant="secondary"
                className="text-[10px] px-1.5 py-0 h-5 gap-1 cursor-pointer hover:bg-destructive/20 hover:text-destructive transition-colors"
                onClick={() => toggle(key)}
              >
                {label}
                <X className="h-2.5 w-2.5" />
              </Badge>
            );
          })}
        </div>
      )}

      <div className="relative mb-2">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="h-7 pl-7 text-[11px]"
          autoFocus
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto rounded border border-border">
        {metricsLoading ? (
          <div className="p-4 flex justify-center">
            <Spinner />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-3 text-center text-[11px] text-muted-foreground">
            {entries.length === 0
              ? "No metrics yet — start streaming data and they’ll show up here."
              : `No matches for “${query}”`}
          </div>
        ) : (
          <div className="py-1">
            {filtered.map((e) => {
              const isSelected = selectedSet.has(e.key);
              return (
                <button
                  key={e.key}
                  type="button"
                  onClick={() => toggle(e.key)}
                  className={
                    "w-full flex items-center gap-2 px-2 py-1 text-left text-[11px] transition-colors " +
                    (isSelected
                      ? "bg-foreground/10 text-foreground"
                      : "hover:bg-muted/60 text-foreground")
                  }
                >
                  <div
                    className={
                      "size-3.5 shrink-0 rounded-[3px] border flex items-center justify-center " +
                      (isSelected
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-input")
                    }
                  >
                    {isSelected && <Check className="size-3" />}
                  </div>
                  <span className="text-muted-foreground shrink-0">
                    {e.sourceId}
                  </span>
                  <span className="truncate">{e.metric}</span>
                  {e.isOnline && (
                    <Wifi className="h-3 w-3 text-blue-500 ml-auto shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
