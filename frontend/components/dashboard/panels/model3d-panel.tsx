"use client";

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { Spinner } from "@/components/ui/spinner";
import { usePanelData } from "@/hooks/use-panel-data";
import type { Panel, TimeRange, TelemetryBinding } from "@/lib/types/dashboard";
import { colorScales } from "@/components/ui/lib/color-scales";
import { Callouts3DOverlay } from "./model3d/callouts-overlay";

const ModelViewer = dynamic(
  () =>
    import("@/components/ui/charts/3d-model-viewer").then(
      (mod) => mod.ModelViewer,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="h-full flex items-center justify-center">
        <Spinner />
      </div>
    ),
  },
);

interface Model3DPanelProps {
  panel: Panel;
  timeRange: TimeRange;
  isEditing?: boolean;
  onConfigChange?: (updates: Record<string, unknown>) => void;
}

// ─── NASA Public Domain Models (CORS-enabled, zero auth) ───────────────────

const DEMO_MODEL_URL =
  "https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/3D%20Models/James%20Webb%20Space%20Telescope%20(B)/James%20Webb%20Space%20Telescope%20(B).glb";

// ─── Orbital Telemetry Simulation ──────────────────────────────────────────

interface DemoTelemetry {
  solar_power_w: number;
  battery_soc_pct: number;
  bus_temp_c: number;
  reaction_wheel_rpm: number;
  signal_dbm: number;
  mag_field_nt: number;
  thruster_psi: number;
  radiator_temp_c: number;
  cpu_load_pct: number;
  eclipse: boolean;
}

const TELEM_CHANNELS: (keyof Omit<DemoTelemetry, "eclipse">)[] = [
  "solar_power_w",
  "battery_soc_pct",
  "bus_temp_c",
  "reaction_wheel_rpm",
  "signal_dbm",
  "mag_field_nt",
  "thruster_psi",
  "radiator_temp_c",
  "cpu_load_pct",
];

// State-driven emissive colors for bound meshes. Module-level so the
// reference is stable across renders (used inside a useMemo below).
//   critical → red, strong emissive pulse
//   warn     → amber, medium emissive
//   nominal  → green, soft emissive (signals "alive / flowing data")
const STATE_COLORS = {
  critical: { color: "#ef4444", intensity: 1.0 }, // red-500
  warn:     { color: "#fbbf24", intensity: 0.55 }, // amber-400
  nominal:  { color: "#22c55e", intensity: 0.22 }, // green-500 — soft "alive" tint
} as const;

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function simulateOrbit(elapsed: number): DemoTelemetry {
  const ORBIT = 30;
  const t = elapsed / ORBIT;
  const phase = t % 1;

  const enterEclipse = smoothstep(0.56, 0.6, phase);
  const exitEclipse = smoothstep(0.9, 0.94, phase);
  const eclipseFactor =
    phase < 0.6 ? enterEclipse : phase > 0.9 ? 1 - exitEclipse : 1;
  const sunFactor = 1 - eclipseFactor;

  const solar_power_w = sunFactor * 2400 * (0.96 + Math.sin(t * 47) * 0.04);

  const battCycle = sunFactor * 0.6 + 0.4;
  const battery_soc_pct = 40 + battCycle * 55 + Math.sin(t * 13) * 2;

  const thermalLag = 0.08;
  const laggedPhase = (phase - thermalLag + 1) % 1;
  const laggedSun =
    laggedPhase < 0.56
      ? 1
      : laggedPhase > 0.94
        ? 1
        : laggedPhase > 0.6 && laggedPhase < 0.9
          ? 0
          : 0.5;
  const bus_temp_c = -8 + laggedSun * 42 + Math.sin(t * 7.3) * 3;

  const wheelCycle = (t * 2.7) % 1;
  const reaction_wheel_rpm = wheelCycle * 5400 + Math.sin(t * 31) * 200;

  const pass1 = Math.exp(-((phase - 0.15) ** 2) / 0.003);
  const pass2 = Math.exp(-((phase - 0.72) ** 2) / 0.003);
  const passStrength = Math.max(pass1, pass2);
  const signal_dbm = -118 + passStrength * 56 + Math.sin(t * 19) * 2;

  const mag_field_nt =
    38000 + Math.sin(phase * Math.PI * 2) * 16000 + Math.sin(t * 11) * 800;

  const basePressure = 310 - (elapsed / 300) * 30;
  const dumpDrop = wheelCycle < 0.05 ? 4 : 0;
  const thruster_psi = Math.max(
    250,
    basePressure - dumpDrop + Math.sin(t * 23) * 1.5,
  );

  const radLag = 0.14;
  const radPhase = (phase - radLag + 1) % 1;
  const radSun =
    radPhase < 0.56
      ? 1
      : radPhase > 0.94
        ? 1
        : radPhase > 0.6 && radPhase < 0.9
          ? 0
          : 0.5;
  const radiator_temp_c = -35 + radSun * 55 + Math.sin(t * 5.7) * 4;

  const commLoad = passStrength * 28;
  const maneuverLoad = wheelCycle < 0.05 ? 15 : 0;
  const cpu_load_pct = 8 + commLoad + maneuverLoad + Math.sin(t * 41) * 3;

  return {
    solar_power_w,
    battery_soc_pct,
    bus_temp_c,
    reaction_wheel_rpm,
    signal_dbm,
    mag_field_nt,
    thruster_psi,
    radiator_temp_c,
    cpu_load_pct,
    eclipse: eclipseFactor > 0.5,
  };
}

// ─── Panel Component ───────────────────────────────────────────────────────

export function Model3DPanel({
  panel,
  timeRange,
  isEditing,
  onConfigChange,
}: Model3DPanelProps) {
  const config = panel.config;
  const modelUrl = config.modelUrl;
  const modelType = config.modelType;
  const wireframe = config.wireframe ?? false;
  const autoRotate = config.autoRotate ?? true;
  const bindings = useMemo(
    () => config.model3dPartBindings ?? [],
    [config.model3dPartBindings],
  );
  const scaleName = config.model3dColorScale ?? "viridis";
  const autoRange = config.model3dAutoRange !== false;
  const manualMin = config.model3dMinValue ?? 0;
  const manualMax = config.model3dMaxValue ?? 100;

  const scale = colorScales[scaleName] ?? colorScales.viridis;

  // ── Phase 2: floating callout bindings ──────────────────────────────
  const calloutBindings = useMemo<TelemetryBinding[]>(
    () =>
      ((config.bindings as TelemetryBinding[] | undefined) ?? []).filter(
        (b) => b.anchor.kind === "mesh-name" && b.metric,
      ),
    [config.bindings],
  );
  const visibilityMap = config.modelLayerVisibility as
    | Record<string, boolean>
    | undefined;
  const showCallouts = config.showCallouts !== false;
  const showLeaderLines = config.showLeaderLines !== false;

  // Subscribe to whatever metrics the callout bindings reference, on top
  // of the panel's own metrics list.
  const augmentedPanel = useMemo<Panel>(() => {
    const extra = (config.bindings as TelemetryBinding[] | undefined)
      ?.map((b) => b.metric)
      .filter(Boolean) as string[] | undefined;
    if (!extra || extra.length === 0) return panel;
    const merged = Array.from(new Set([...(panel.metrics ?? []), ...extra]));
    return { ...panel, metrics: merged };
  }, [panel, config.bindings]);

  const { data, metrics } = usePanelData({
    panel: augmentedPanel,
    timeRange,
  });

  // Reduce telemetry to {metric → latestValue} for the callouts.
  const calloutValues = useMemo(() => {
    const out: Record<string, number | string | null> = {};
    for (const b of calloutBindings) {
      const series = data[b.metric];
      if (!series || series.length === 0) {
        out[b.metric] = null;
        continue;
      }
      const last = series[series.length - 1];
      out[b.metric] =
        last && typeof last.value !== "undefined" ? last.value : null;
    }
    return out;
  }, [calloutBindings, data]);

  // Linear-style "extras": delta over a fixed window + last-update
  // timestamp. The Callout renders these as the meta row.
  const DELTA_WINDOW_SEC = 60;
  const calloutExtras = useMemo(() => {
    const out: Record<
      string,
      { delta?: number; deltaWindowSec?: number; lastUpdatedAt?: string }
    > = {};
    for (const b of calloutBindings) {
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
      } = {
        lastUpdatedAt: last?.timestamp,
      };
      // Delta vs. an older point ~DELTA_WINDOW_SEC ago. Searches from the
      // end backwards so it's cheap.
      if (typeof last?.value === "number" && last.timestamp) {
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
  }, [calloutBindings, data]);

  const [discoveredParts, setDiscoveredParts] = useState<string[]>([]);
  const onPartsDiscovered = useCallback((parts: string[]) => {
    setDiscoveredParts(parts);
  }, []);
  const [, setDiscoveredGroups] = useState<string[]>([]);
  const onGroupsDiscovered = useCallback((groups: string[]) => {
    setDiscoveredGroups(groups);
  }, []);
  const [partPositions, setPartPositions] = useState<
    Record<string, { x: number; y: number; depth: number }>
  >({});
  const onPartScreenPositions = useCallback(
    (positions: Record<string, { x: number; y: number; depth: number }>) => {
      setPartPositions(positions);
    },
    [],
  );

  // ── Phase 2 polish: hover outline + click-to-bind popover ──────────
  const [hoveredPart, setHoveredPart] = useState<string | null>(null);
  const [clickSelection, setClickSelection] = useState<{
    name: string;
    screen: { x: number; y: number };
  } | null>(null);
  const handlePartHover = useCallback((name: string | null) => {
    setHoveredPart(name);
  }, []);
  const handlePartClick = useCallback(
    (name: string, screen: { x: number; y: number }) => {
      if (!isEditing) return;
      setClickSelection({ name, screen });
    },
    [isEditing],
  );
  const createCalloutForSelection = useCallback(
    (metric: string) => {
      if (!clickSelection || !onConfigChange) return;
      const existing =
        (panel.config.bindings as TelemetryBinding[] | undefined) ?? [];
      const fresh: TelemetryBinding = {
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `b-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        anchor: { kind: "mesh-name", name: clickSelection.name },
        metric,
        display: "value",
      };
      onConfigChange({ bindings: [...existing, fresh] });
      setClickSelection(null);
    },
    [clickSelection, onConfigChange, panel.config.bindings],
  );

  const isDemoMode = !modelUrl;

  // Map discovered parts → telemetry channels (round-robin for demo)
  const partChannelMap = useMemo(() => {
    if (!isDemoMode || discoveredParts.length === 0) return {};
    const map: Record<string, (typeof TELEM_CHANNELS)[number]> = {};
    discoveredParts.forEach((part, i) => {
      map[part] = TELEM_CHANNELS[i % TELEM_CHANNELS.length];
    });
    return map;
  }, [isDemoMode, discoveredParts]);

  // ── Demo: orbital telemetry simulation ─────────────────────────────
  const [startTime] = useState(() => Date.now());
  const [demoTelemetry, setDemoTelemetry] = useState<DemoTelemetry | null>(
    null,
  );
  const [demoPartColors, setDemoPartColors] = useState<Record<string, string>>(
    {},
  );
  const [demoPartEmissive, setDemoPartEmissive] = useState<
    Record<string, { color: string; intensity: number }>
  >({});

  useEffect(() => {
    if (!isDemoMode) return;
    const interval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      const telem = simulateOrbit(elapsed);
      setDemoTelemetry(telem);

      // Part coloring disabled for now — just show the model cleanly
      setDemoPartColors({});
      setDemoPartEmissive({});
    }, 80);
    return () => clearInterval(interval);
  }, [isDemoMode, scale, partChannelMap, startTime]);

  // ── Live data: compute part colors from bindings ───────────────────
  // State-driven (not value-scaled). Each bound mesh is one of three
  // states based on its threshold:
  //   critical → red, strong emissive pulse
  //   warn     → amber, medium emissive
  //   nominal  → green, soft emissive (signals "alive / flowing data")
  // Skip the per-value color scale entirely — value-scaled colors made
  // the whole model look "hot" when values were near the top of their
  // range, which conveys no useful information.
  const { partColors, partEmissive } = useMemo(() => {
    if (isDemoMode)
      return { partColors: demoPartColors, partEmissive: demoPartEmissive };
    if (bindings.length === 0 || !data)
      return { partColors: undefined, partEmissive: undefined };

    const colors: Record<string, string> = {};
    const emissive: Record<string, { color: string; intensity: number }> = {};

    for (const b of bindings) {
      const metricData = data[b.metric];
      if (!metricData) continue;
      const latest = metricData[metricData.length - 1];
      if (!latest || typeof latest.value !== "number") continue;

      const v = latest.value;
      // Compute state with optional invert (for "low-is-bad" metrics
      // like UPS charge or O₂ where the alert is when value drops).
      const invert = b.invertThreshold === true;
      const overWarn =
        b.thresholdWarning !== undefined &&
        (invert ? v <= b.thresholdWarning : v >= b.thresholdWarning);
      const overCrit =
        b.thresholdCritical !== undefined &&
        (invert ? v <= b.thresholdCritical : v >= b.thresholdCritical);
      const state = overCrit ? "critical" : overWarn ? "warn" : "nominal";
      const sc = STATE_COLORS[state];
      colors[b.partName] = sc.color;
      emissive[b.partName] = sc;
      // (The hidden scale variable below stays referenced via _ to satisfy lint.)
      void manualMin; void manualMax; void autoRange; void scale;
    }

    return { partColors: colors, partEmissive: emissive };
  }, [
    isDemoMode,
    demoPartColors,
    demoPartEmissive,
    bindings,
    data,
    scale,
    autoRange,
    manualMin,
    manualMax,
  ]);

  // ── Orientation from telemetry ─────────────────────────────────────
  const orientation = useMemo(() => {
    if (!data) return { pitch: 0, roll: 0, yaw: 0 };
    let pitchValue = 0;
    let rollValue = 0;
    let yawValue = 0;

    const keysToUse = metrics.length > 0 ? metrics : Object.keys(data);
    for (const metric of keysToUse) {
      const metricData = data[metric] || [];
      const latest = metricData[metricData.length - 1];
      if (!latest || typeof latest.value !== "number") continue;
      const lowerName = metric.toLowerCase();
      if (lowerName.includes("pitch") || metric === config.pitchMetric)
        pitchValue = latest.value;
      else if (lowerName.includes("roll") || metric === config.rollMetric)
        rollValue = latest.value;
      else if (
        lowerName.includes("yaw") ||
        lowerName.includes("heading") ||
        metric === config.yawMetric
      )
        yawValue = latest.value;
    }
    return { pitch: pitchValue, roll: rollValue, yaw: yawValue };
  }, [data, metrics, config.pitchMetric, config.rollMetric, config.yawMetric]);

  const hasTelemetryOrientation =
    orientation.pitch !== 0 || orientation.roll !== 0 || orientation.yaw !== 0;

  // ── Body position in bin (x_bin, y_bin → bodyPosition) ─────────────
  const bodyPosition = useMemo((): [number, number, number] | undefined => {
    if (!data) return undefined;
    const xMetric = config.positionXMetric;
    const yMetric = config.positionYMetric;
    const zMetric = config.positionZMetric;
    const scale = config.positionScale ?? 0.9;
    if (!xMetric && !yMetric && !zMetric) return undefined;
    const get = (m?: string) => {
      if (!m || !data[m]) return 0;
      const arr = data[m];
      const last = arr[arr.length - 1];
      return last && typeof last.value === "number" ? last.value : 0;
    };
    // Map raw metric values into scene units via positionScale (scene_units per raw_unit).
    // For the weevil: raw is meters in a 5.5m-radius bin, so scale ≈ 0.9 / 5.5.
    return [get(xMetric) * scale, get(zMetric) * scale, get(yMetric) * scale];
  }, [data, config.positionXMetric, config.positionYMetric, config.positionZMetric, config.positionScale]);

  // For demo mode, always load as GLB; otherwise infer from URL
  const resolvedUrl = isDemoMode ? DEMO_MODEL_URL : modelUrl;
  const resolvedType = isDemoMode
    ? ("glb" as const)
    : modelType ||
      (() => {
        if (!modelUrl) return "gltf" as const;
        const ext = modelUrl.split(".").pop()?.toLowerCase();
        if (ext === "stl") return "stl" as const;
        if (ext === "obj") return "obj" as const;
        if (ext === "gltf") return "gltf" as const;
        if (ext === "glb") return "glb" as const;
        return "gltf" as const;
      })();

  const t = demoTelemetry;

  return (
    <div className="h-full w-full flex flex-col">
      <div className="flex-1 min-h-0 relative">
        <ModelViewer
          modelUrl={resolvedUrl}
          modelType={resolvedType}
          wireframe={wireframe}
          autoRotate={
            autoRotate && !hasTelemetryOrientation && !hoveredPart && !isEditing
          }
          showGrid={config.showGrid ?? true}
          backgroundColor={config.backgroundColor ?? "#111111"}
          width="100%"
          height="100%"
          onPartsDiscovered={onPartsDiscovered}
          onGroupsDiscovered={onGroupsDiscovered}
          onPartScreenPositions={
            showCallouts && calloutBindings.length > 0
              ? onPartScreenPositions
              : undefined
          }
          onPartHover={handlePartHover}
          onPartClick={isEditing ? handlePartClick : undefined}
          hoveredPartName={hoveredPart}
          visibilityMap={visibilityMap}
          partColors={partColors}
          partEmissive={partEmissive}
          partScales={config.partScales}
          partSpins={config.partSpins}
          fixedParts={config.fixedParts}
          bodyPosition={bodyPosition}
          modelRotationOffset={config.modelRotationOffset}
          cadStyle={config.cadStyle}
          spaceScene={(config as { spaceScene?: boolean }).spaceScene}
          earthBackdropPosition={
            (config as { earthBackdropPosition?: [number, number, number] })
              .earthBackdropPosition
          }
          earthBackdropRadius={
            (config as { earthBackdropRadius?: number }).earthBackdropRadius
          }
        />
        {showCallouts && calloutBindings.length > 0 && (
          <Callouts3DOverlay
            bindings={calloutBindings}
            values={calloutValues}
            extras={calloutExtras}
            positions={partPositions}
            showLeaderLines={showLeaderLines}
          />
        )}

        {/* Hover chip — small floating label under the cursor showing the
            hovered mesh name + bound value (if any). Only visible when the
            part isn't already labelled by a callout. */}
        {hoveredPart && !calloutBindings.some(
          (b) => b.anchor.kind === "mesh-name" && b.anchor.name === hoveredPart,
        ) && (
          <div className="absolute bottom-3 left-3 pointer-events-none rounded-md bg-background/95 backdrop-blur-sm border border-border px-2 py-1 text-[10px] font-mono">
            <span className="text-muted-foreground">part</span>{" "}
            <span className="font-semibold">{hoveredPart}</span>
          </div>
        )}

        {/* Edit-mode click-to-bind popover. Positioned at the click point;
            metric pick adds a callout binding and dismisses. */}
        {isEditing && clickSelection && (
          <ClickToBindPopover
            partName={clickSelection.name}
            screen={clickSelection.screen}
            metrics={metrics}
            onSelect={createCalloutForSelection}
            onDismiss={() => setClickSelection(null)}
          />
        )}

        {isEditing && !clickSelection && (
          <div className="absolute top-2 right-2 z-10 pointer-events-none">
            <div className="rounded-md bg-background/95 backdrop-blur-sm border border-border px-2 py-1 text-[10px] text-muted-foreground">
              Click a part to bind a metric
            </div>
          </div>
        )}
      </div>

      {/* Telemetry footer */}
      <div className="px-3 py-1.5 border-t border-border flex items-center justify-between text-[10px] text-muted-foreground font-mono">
        {isDemoMode && t ? (
          <>
            <div className="flex items-center gap-1">
              <span className={t.eclipse ? "text-blue-400" : "text-yellow-400"}>
                {t.eclipse ? "ECLIPSE" : "SUNLIT"}
              </span>
              <span className="text-muted-foreground/50">
                {discoveredParts.length > 0
                  ? `${discoveredParts.length} parts`
                  : "loading..."}
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              <span
                className={
                  t.solar_power_w > 2000
                    ? "text-yellow-300"
                    : t.solar_power_w < 100
                      ? "text-blue-400"
                      : ""
                }
              >
                PWR {(t.solar_power_w / 1000).toFixed(1)}kW
              </span>
              <span className={t.battery_soc_pct < 55 ? "text-orange-400" : ""}>
                BAT {t.battery_soc_pct.toFixed(0)}%
              </span>
              <span
                className={
                  t.bus_temp_c > 32
                    ? "text-red-400"
                    : t.bus_temp_c < -5
                      ? "text-blue-400"
                      : ""
                }
              >
                BUS {t.bus_temp_c.toFixed(0)}&deg;C
              </span>
              <span className={t.signal_dbm > -80 ? "text-green-400" : ""}>
                SIG {t.signal_dbm.toFixed(0)}dBm
              </span>
              <span>RWL {(t.reaction_wheel_rpm / 1000).toFixed(1)}k</span>
            </div>
          </>
        ) : (
          <>
            <span>{resolvedType.toUpperCase()}</span>
            <div className="flex items-center gap-3">
              {hasTelemetryOrientation && (
                <>
                  <span>P:{orientation.pitch.toFixed(1)}&deg;</span>
                  <span>R:{orientation.roll.toFixed(1)}&deg;</span>
                  <span>Y:{orientation.yaw.toFixed(0)}&deg;</span>
                </>
              )}
              {bindings.length > 0 && (
                <span>
                  {bindings.length} binding
                  {bindings.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Floating popover that opens at the click point and lets the user pick
 * which metric to bind to the clicked mesh. Click-outside dismisses;
 * clicking a metric creates the binding.
 */
function ClickToBindPopover({
  partName,
  screen,
  metrics,
  onSelect,
  onDismiss,
}: {
  partName: string;
  screen: { x: number; y: number };
  metrics: string[];
  onSelect: (metric: string) => void;
  onDismiss: () => void;
}) {
  // Position math: clamp into the viewport so the popover never falls off
  // the right or bottom edge. Window/screen-position are in CSS pixels.
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onDismiss();
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onDismiss]);

  // Convert screen-page coords to the panel's local coords. The popover
  // is positioned absolutely inside the panel, so we need to subtract the
  // panel's bounding-rect origin. The panel's parent is `relative`, so
  // we can use position:fixed with the page coords directly.
  return (
    <div
      ref={containerRef}
      className="fixed z-50 rounded-md border border-border bg-background/95 backdrop-blur-sm shadow-md min-w-[200px] max-w-[260px]"
      style={{
        left: Math.min(screen.x + 12, window.innerWidth - 280),
        top: Math.min(screen.y + 12, window.innerHeight - 320),
      }}
    >
      <div className="px-3 py-2 border-b border-border">
        <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
          Bind metric to
        </div>
        <div className="text-[12px] font-mono font-semibold truncate">
          {partName}
        </div>
      </div>
      <div className="max-h-72 overflow-y-auto py-1">
        {metrics.length === 0 ? (
          <div className="px-3 py-2 text-[11px] text-muted-foreground">
            Select metrics in the data source first.
          </div>
        ) : (
          metrics.map((m) => (
            <button
              key={m}
              type="button"
              className="w-full text-left px-3 py-1.5 text-[11px] font-mono hover:bg-muted/60 transition-colors"
              onClick={() => onSelect(m)}
            >
              {m.includes(":") ? m.split(":")[1] : m}
            </button>
          ))
        )}
      </div>
      <button
        type="button"
        className="w-full px-3 py-1.5 text-[10px] text-muted-foreground hover:bg-muted/40 border-t border-border"
        onClick={onDismiss}
      >
        Cancel
      </button>
    </div>
  );
}
