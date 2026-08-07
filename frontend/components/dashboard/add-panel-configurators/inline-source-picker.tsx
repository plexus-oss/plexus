"use client";

/**
 * InlineSourcePicker — sibling of InlineMetricPicker, but each row is a
 * source (device) instead of a metric. Used by panel-aware configurators
 * whose top-level data binding is a device, not a metric: fleet-grid,
 * fleet-table, map, radar (single-source), attitude (single-source).
 */

import { useMemo, useState } from "react";
import { Check, Search, Wifi, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { useAvailableMetrics } from "@/hooks/use-telemetry";
import { usePlexusRealtime } from "@/hooks/use-plexus-realtime";

export interface InlineSourcePickerProps {
  mode: "single" | "multi";
  /** Selected source IDs. */
  selected: string[];
  onChange: (next: string[]) => void;
  /** Receives sourceId + its known metrics; return true to keep the source. */
  filter?: (sourceId: string, metrics: string[]) => boolean;
  placeholder?: string;
  className?: string;
  hideChips?: boolean;
}

interface SourceEntry {
  sourceId: string;
  metrics: string[];
  isOnline: boolean;
}

export function InlineSourcePicker({
  mode,
  selected,
  onChange,
  filter,
  placeholder = "Search devices…",
  className,
  hideChips,
}: InlineSourcePickerProps) {
  const [query, setQuery] = useState("");
  const { metricsBySource, isLoading: metricsLoading } = useAvailableMetrics();
  const { sources: rtSources } = usePlexusRealtime();

  const sources = useMemo<SourceEntry[]>(() => {
    const bySource = new Map<string, SourceEntry>();
    const online = new Set<string>();
    for (const rt of rtSources) online.add(rt.source_id);

    for (const s of metricsBySource) {
      bySource.set(s.source_id, {
        sourceId: s.source_id,
        metrics: [...s.metrics],
        isOnline: online.has(s.source_id),
      });
    }
    for (const rt of rtSources) {
      const existing = bySource.get(rt.source_id);
      const sensorMetrics: string[] = [];
      for (const sensor of rt.sensors ?? []) {
        if (sensor.available && sensor.metrics) {
          sensorMetrics.push(...sensor.metrics);
        }
      }
      if (existing) {
        const merged = new Set([...existing.metrics, ...sensorMetrics]);
        existing.metrics = Array.from(merged);
        existing.isOnline = true;
      } else {
        bySource.set(rt.source_id, {
          sourceId: rt.source_id,
          metrics: sensorMetrics,
          isOnline: true,
        });
      }
    }

    return Array.from(bySource.values()).sort((a, b) => {
      if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
      return a.sourceId.localeCompare(b.sourceId);
    });
  }, [metricsBySource, rtSources]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sources.filter((s) => {
      if (filter && !filter(s.sourceId, s.metrics)) return false;
      if (!q) return true;
      return s.sourceId.toLowerCase().includes(q);
    });
  }, [sources, query, filter]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const toggle = (sourceId: string) => {
    if (mode === "single") {
      onChange(selectedSet.has(sourceId) ? [] : [sourceId]);
      return;
    }
    if (selectedSet.has(sourceId)) {
      onChange(selected.filter((s) => s !== sourceId));
    } else {
      onChange([...selected, sourceId]);
    }
  };

  return (
    <div className={`flex flex-col min-h-0 ${className ?? ""}`}>
      {!hideChips && mode === "multi" && selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {selected.map((sourceId) => (
            <Badge
              key={sourceId}
              variant="secondary"
              className="text-[10px] px-1.5 py-0 h-5 gap-1 cursor-pointer hover:bg-destructive/20 hover:text-destructive transition-colors"
              onClick={() => toggle(sourceId)}
            >
              {sourceId}
              <X className="h-2.5 w-2.5" />
            </Badge>
          ))}
        </div>
      )}

      <div className="relative mb-2">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="h-7 pl-7 text-[11px]"
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto rounded border border-border">
        {metricsLoading ? (
          <div className="p-4 flex justify-center">
            <Spinner />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-3 text-center text-[11px] text-muted-foreground">
            {sources.length === 0
              ? "No devices yet."
              : `No matches for “${query}”`}
          </div>
        ) : (
          <div className="py-1">
            {filtered.map((s) => {
              const isSelected = selectedSet.has(s.sourceId);
              return (
                <button
                  key={s.sourceId}
                  type="button"
                  onClick={() => toggle(s.sourceId)}
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
                  <span className="truncate">{s.sourceId}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
                    {s.metrics.length} metric{s.metrics.length === 1 ? "" : "s"}
                  </span>
                  {s.isOnline && (
                    <Wifi className="h-3 w-3 text-blue-500 shrink-0" />
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
