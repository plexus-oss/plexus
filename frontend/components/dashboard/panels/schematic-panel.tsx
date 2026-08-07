"use client";

/**
 * SchematicPanel — top-level dashboard panel.
 *
 * Composition:
 *   <SchematicCanvas>            inlined SVG + pan/zoom
 *     <PinOverlay>               pins drawn over the schematic
 *   </SchematicCanvas>
 *
 * Live values are pulled from usePanelData. Metrics are auto-derived from
 * the binding list so the user doesn't have to separately maintain
 * panel.metrics — adding a binding subscribes; removing one unsubscribes.
 */

import { useCallback, useMemo } from "react";
import { Workflow } from "lucide-react";
import type {
  AnchorRef,
  Panel,
  TimeRange,
  TelemetryBinding,
} from "@/lib/types/dashboard";
import { usePanelData } from "@/hooks/use-panel-data";
import { SchematicCanvas } from "./schematic/schematic-canvas";
import { PinOverlay } from "./schematic/pin-overlay";

interface SchematicPanelProps {
  panel: Panel;
  timeRange: TimeRange;
  isEditing?: boolean;
  onConfigChange?: (updates: Record<string, unknown>) => void;
}

export function SchematicPanel({
  panel,
  timeRange,
  isEditing,
  onConfigChange,
}: SchematicPanelProps) {
  const config = panel.config;
  const bindings = useMemo(
    () =>
      ((config.schematicBindings as TelemetryBinding[] | undefined) ?? []).filter(
        (b) => !!b.metric,
      ),
    [config.schematicBindings],
  );
  const svgUrl = config.schematicSvgUrl as string | undefined;
  const backgroundOpacity =
    (config.schematicBackgroundOpacity as number | undefined) ?? 1;
  const showConnectors =
    (config.schematicShowConnectors as boolean | undefined) !== false;

  // Subscribe to whatever metrics the bindings reference — the panel's
  // own metrics list is augmented so usePanelData picks them up.
  const augmentedPanel = useMemo<Panel>(() => {
    const fromBindings = bindings.map((b) => b.metric);
    const merged = Array.from(new Set([...(panel.metrics ?? []), ...fromBindings]));
    return { ...panel, metrics: merged };
  }, [panel, bindings]);

  const { data } = usePanelData({ panel: augmentedPanel, timeRange });

  // Reduce telemetry to {metric → latestValue} keyed by full binding metric.
  const values = useMemo(() => {
    const out: Record<string, number | string | null> = {};
    for (const b of bindings) {
      const series = data[b.metric];
      if (!series || series.length === 0) {
        out[b.metric] = null;
        continue;
      }
      const last = series[series.length - 1];
      out[b.metric] = last && typeof last.value !== "undefined" ? last.value : null;
    }
    return out;
  }, [bindings, data]);

  // Linear-style extras (delta over 60s + last-update timestamp) so the
  // Callout can render its meta row.
  const DELTA_WINDOW_SEC = 60;
  const extras = useMemo(() => {
    const out: Record<
      string,
      { delta?: number; deltaWindowSec?: number; lastUpdatedAt?: string }
    > = {};
    for (const b of bindings) {
      const series = data[b.metric];
      if (!series || series.length === 0) {
        out[b.metric] = {};
        continue;
      }
      const last = series[series.length - 1];
      const entry: {
        delta?: number;
        deltaWindowSec?: number;
        lastUpdatedAt?: string;
      } = { lastUpdatedAt: last?.timestamp };
      if (typeof last?.value === "number") {
        // Window the delta to the last DELTA_WINDOW_SEC of data, anchored on
        // the most recent point's timestamp. On a live stream this is the
        // current time; deriving it from the data keeps the memo pure (no
        // Date.now() during render).
        const cutoff =
          new Date(last.timestamp).getTime() - DELTA_WINDOW_SEC * 1000;
        let older: { value: number } | null = null;
        for (let i = series.length - 2; i >= 0; i--) {
          const p = series[i];
          const t = new Date(p.timestamp).getTime();
          if (t <= cutoff && typeof p.value === "number") {
            older = { value: p.value as number };
            break;
          }
        }
        if (older) {
          entry.delta = (last.value as number) - older.value;
          entry.deltaWindowSec = DELTA_WINDOW_SEC;
        }
      }
      out[b.metric] = entry;
    }
    return out;
  }, [bindings, data]);

  const handleAnchorClick = useCallback(
    (anchor: AnchorRef) => {
      if (!onConfigChange) return;
      const fresh: TelemetryBinding = {
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `b-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        anchor,
        metric: "",
        display: "value",
      };
      onConfigChange({ schematicBindings: [...bindings, fresh] });
    },
    [bindings, onConfigChange],
  );

  const handleBindingChange = useCallback(
    (id: string, updates: Partial<TelemetryBinding>) => {
      if (!onConfigChange) return;
      onConfigChange({
        schematicBindings: bindings.map((b) =>
          b.id === id ? { ...b, ...updates } : b,
        ),
      });
    },
    [bindings, onConfigChange],
  );

  const handleBindingDelete = useCallback(
    (id: string) => {
      if (!onConfigChange) return;
      onConfigChange({
        schematicBindings: bindings.filter((b) => b.id !== id),
      });
    },
    [bindings, onConfigChange],
  );

  // The available-metrics list for the inline edit popover is just the
  // augmented panel.metrics — everything the panel is subscribed to.
  const availableMetrics = augmentedPanel.metrics ?? [];

  return (
    <div className="h-full w-full relative">
      <SchematicCanvas
        svgUrl={svgUrl}
        backgroundOpacity={backgroundOpacity}
        emptyState={<EmptyDropState />}
        editing={!!isEditing}
        onAnchorClick={isEditing ? handleAnchorClick : undefined}
      >
        <PinOverlay
          bindings={bindings}
          values={values}
          extras={extras}
          showConnectors={showConnectors}
          editMode={!!isEditing}
          availableMetrics={availableMetrics}
          onBindingChange={handleBindingChange}
          onBindingDelete={handleBindingDelete}
        />
      </SchematicCanvas>
      {isEditing && svgUrl && (
        <div className="absolute top-2 left-2 right-2 z-10 pointer-events-none flex justify-between">
          <div className="rounded-md bg-black/85 backdrop-blur-sm border border-white/15 px-3 py-2 text-[10px] text-white/85 space-y-1 max-w-[280px]">
            <div className="text-[10px] uppercase tracking-[0.16em] text-white/55 mb-1">
              Editing pins
            </div>
            <div className="flex gap-2">
              <span className="text-white/45 w-12 shrink-0">click</span>
              <span>a labeled part to drop a new pin</span>
            </div>
            <div className="flex gap-2">
              <span className="text-white/45 w-12 shrink-0">click</span>
              <span>a chip to edit metric / threshold</span>
            </div>
            <div className="flex gap-2">
              <span className="text-white/45 w-12 shrink-0">drag</span>
              <span>a chip to reposition its label</span>
            </div>
          </div>
          <div className="rounded-md bg-black/85 backdrop-blur-sm border border-white/15 px-2.5 py-1.5 text-[10px] text-white/65">
            <span className="text-white/45">{bindings.length} pin{bindings.length === 1 ? "" : "s"}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyDropState() {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-3 p-8">
      <div className="rounded-full p-3 bg-muted/40 border border-border">
        <Workflow className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <div className="text-xs font-medium text-foreground">
          No schematic uploaded
        </div>
        <div className="text-[11px] text-muted-foreground max-w-[24ch]">
          Upload an SVG in the panel settings to drop live values onto the
          diagram.
        </div>
      </div>
    </div>
  );
}
