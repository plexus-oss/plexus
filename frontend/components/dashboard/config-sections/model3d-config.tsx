"use client";

import { useState } from "react";
import { Eye, EyeOff, Trash2, Plus } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MetricCombobox } from "@/components/dashboard/metric-combobox";
import {
  colorScales,
  type ColorScaleName,
} from "@/components/ui/lib/color-scales";
import type { TelemetryBinding } from "@/lib/types/dashboard";
import { discoverGltf } from "@/lib/schematic/discover-gltf";

const MODEL_TYPES = [
  { value: "gltf", label: "GLTF" },
  { value: "glb", label: "GLB" },
  { value: "stl", label: "STL" },
  { value: "obj", label: "OBJ" },
];

const COLOR_SCALE_OPTIONS = Object.keys(colorScales) as ColorScaleName[];

interface PartBinding {
  partName: string;
  metric: string;
  thresholdWarning?: number;
  thresholdCritical?: number;
}

interface Props {
  config: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
  metrics?: string[];
}

export function Model3DConfig({ config, onChange, metrics = [] }: Props) {
  const bindings = (config.model3dPartBindings as PartBinding[]) ?? [];
  const calloutBindings =
    (config.bindings as TelemetryBinding[] | undefined) ?? [];
  const visibilityMap =
    (config.modelLayerVisibility as Record<string, boolean> | undefined) ?? {};
  const isGltf = config.modelType === "gltf" || config.modelType === "glb";
  const modelUrl = config.modelUrl as string | undefined;

  const [discoverState, setDiscoverState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "done"; meshes: string[]; groups: string[] }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const handleDiscover = async () => {
    if (!modelUrl) return;
    setDiscoverState({ kind: "loading" });
    try {
      const { meshes, groups } = await discoverGltf(modelUrl);
      setDiscoverState({ kind: "done", meshes, groups });
    } catch (e) {
      setDiscoverState({
        kind: "error",
        message: e instanceof Error ? e.message : "Discovery failed",
      });
    }
  };

  const setLayerVisible = (name: string, visible: boolean) => {
    onChange({
      modelLayerVisibility: { ...visibilityMap, [name]: visible },
    });
  };

  const addCalloutBinding = (meshName: string) => {
    const fresh: TelemetryBinding = {
      id: crypto.randomUUID(),
      anchor: { kind: "mesh-name", name: meshName },
      metric: metrics[0] ?? "",
      display: "value",
    };
    onChange({ bindings: [...calloutBindings, fresh] });
  };

  const updateCalloutBinding = (
    id: string,
    updates: Partial<TelemetryBinding>,
  ) => {
    onChange({
      bindings: calloutBindings.map((b) =>
        b.id === id ? { ...b, ...updates } : b,
      ),
    });
  };

  const removeCalloutBinding = (id: string) => {
    onChange({
      bindings: calloutBindings.filter((b) => b.id !== id),
    });
  };

  const updateBinding = (index: number, updates: Partial<PartBinding>) => {
    const next = [...bindings];
    next[index] = { ...next[index], ...updates };
    onChange({ model3dPartBindings: next });
  };

  const addBinding = () => {
    onChange({
      model3dPartBindings: [
        ...bindings,
        { partName: "", metric: metrics[0] ?? "" },
      ],
    });
  };

  const removeBinding = (index: number) => {
    onChange({
      model3dPartBindings: bindings.filter((_, i) => i !== index),
    });
  };

  return (
    <>
      {/* Model Source */}
      <div className="px-3 py-2 border-b border-border space-y-2">
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Model Source
        </Label>
        <Select
          value={(config.shape as string) || "custom"}
          onValueChange={(v) =>
            onChange(
              v === "custom"
                ? { shape: undefined }
                : { shape: v, modelUrl: undefined, modelType: undefined },
            )
          }
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cylinder" className="text-xs">
              Cylinder (built-in)
            </SelectItem>
            <SelectItem value="capsule" className="text-xs">
              Pod — capsule (built-in)
            </SelectItem>
            <SelectItem value="box" className="text-xs">
              Box (built-in)
            </SelectItem>
            <SelectItem value="cone" className="text-xs">
              Cone (built-in)
            </SelectItem>
            <SelectItem value="custom" className="text-xs">
              Custom model (URL)
            </SelectItem>
          </SelectContent>
        </Select>
        {!config.shape && (
          <>
            <Input
              value={(config.modelUrl as string) || ""}
              onChange={(e) =>
                onChange({ modelUrl: e.target.value || undefined })
              }
              className="h-7 text-xs"
              placeholder="https://example.com/model.glb"
            />
            <Select
              value={(config.modelType as string) || "gltf"}
              onValueChange={(v) => onChange({ modelType: v })}
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODEL_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value} className="text-xs">
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              Leave empty to load NASA James Webb Space Telescope with live
              orbital telemetry.
            </p>
          </>
        )}
      </div>

      {/* Display */}
      <div className="px-3 py-2 border-b border-border space-y-1.5">
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Display
        </Label>
        <Label className="flex items-center gap-2 text-[11px]">
          <Checkbox
            checked={(config.wireframe as boolean) ?? false}
            onCheckedChange={(checked) =>
              onChange({ wireframe: checked === true })
            }
            className="h-3 w-3"
          />
          Wireframe
        </Label>
        <Label className="flex items-center gap-2 text-[11px]">
          <Checkbox
            checked={(config.autoRotate as boolean) !== false}
            onCheckedChange={(checked) =>
              onChange({ autoRotate: checked === true })
            }
            className="h-3 w-3"
          />
          Auto-rotate
        </Label>
        <Label className="flex items-center gap-2 text-[11px]">
          <Checkbox
            checked={
              (config.showGrid as boolean | undefined) ??
              config.shape !== "capsule"
            }
            onCheckedChange={(checked) =>
              onChange({ showGrid: checked === true })
            }
            className="h-3 w-3"
          />
          Ground grid
        </Label>
      </div>

      {/* Floating callouts + layer toggles (GLTF only) */}
      {(isGltf || !modelUrl) && (
        <div className="px-3 py-2 border-b border-border space-y-2">
          <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
            Floating Callouts
          </Label>
          <p className="text-[10px] text-muted-foreground">
            Pin live values to named parts of the model.
          </p>
          <div className="flex gap-2">
            <Label className="flex items-center gap-1.5 text-[11px] flex-1">
              <Checkbox
                checked={(config.showCallouts as boolean) !== false}
                onCheckedChange={(checked) =>
                  onChange({ showCallouts: checked === true })
                }
                className="h-3 w-3"
              />
              Show callouts
            </Label>
            <Label className="flex items-center gap-1.5 text-[11px] flex-1">
              <Checkbox
                checked={(config.showLeaderLines as boolean) !== false}
                onCheckedChange={(checked) =>
                  onChange({ showLeaderLines: checked === true })
                }
                className="h-3 w-3"
              />
              Leader lines
            </Label>
          </div>
          {modelUrl && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-full text-[11px]"
              disabled={discoverState.kind === "loading"}
              onClick={handleDiscover}
            >
              {discoverState.kind === "loading" ? (
                <Spinner className="h-3 w-3" />
              ) : null}
              {discoverState.kind === "loading"
                ? "Loading model…"
                : "Discover parts & layers"}
            </Button>
          )}
          {discoverState.kind === "error" && (
            <p className="text-[10px] text-destructive">
              {discoverState.message}
            </p>
          )}
          {calloutBindings.length === 0 && discoverState.kind !== "done" && (
            <p className="text-[10px] text-muted-foreground italic">
              Click discover, then pick parts to label.
            </p>
          )}
          {calloutBindings.map((b) => {
            const meshName = b.anchor.kind === "mesh-name" ? b.anchor.name : "";
            return (
              <div
                key={b.id}
                className="rounded border border-border/60 bg-muted/20 p-1.5 space-y-1"
              >
                <div className="flex items-center gap-1.5">
                  <Input
                    value={meshName}
                    onChange={(e) =>
                      updateCalloutBinding(b.id, {
                        anchor: { kind: "mesh-name", name: e.target.value },
                      })
                    }
                    placeholder="Mesh name"
                    className="h-6 text-[11px] flex-1"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 text-muted-foreground hover:text-destructive"
                    onClick={() => removeCalloutBinding(b.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                <MetricCombobox
                  value={b.metric || undefined}
                  onChange={(v) =>
                    updateCalloutBinding(b.id, { metric: v ?? "" })
                  }
                  emptyLabel="No metric"
                />
              </div>
            );
          })}
          {discoverState.kind === "done" && discoverState.meshes.length > 0 && (
            <details className="text-[10px]">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground py-1">
                Available parts ({discoverState.meshes.length})
              </summary>
              <div className="max-h-32 overflow-y-auto space-y-0.5 py-1">
                {discoverState.meshes.map((m) => {
                  const alreadyBound = calloutBindings.some(
                    (b) => b.anchor.kind === "mesh-name" && b.anchor.name === m,
                  );
                  return (
                    <button
                      key={m}
                      type="button"
                      disabled={alreadyBound}
                      className="w-full text-left px-1.5 py-1 rounded text-[10px] font-mono flex items-center gap-1.5 hover:bg-muted/40 disabled:opacity-40 disabled:cursor-default"
                      onClick={() => addCalloutBinding(m)}
                    >
                      <Plus className="h-2.5 w-2.5" />
                      <span className="truncate">{m}</span>
                    </button>
                  );
                })}
              </div>
            </details>
          )}
        </div>
      )}

      {/* Layer visibility */}
      {(isGltf || !modelUrl) &&
        discoverState.kind === "done" &&
        discoverState.groups.length > 0 && (
          <div className="px-3 py-2 border-b border-border space-y-1.5">
            <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
              Layers
            </Label>
            <p className="text-[10px] text-muted-foreground">
              Toggle whole groups on/off.
            </p>
            {discoverState.groups.map((groupName) => {
              const visible = visibilityMap[groupName] !== false;
              return (
                <button
                  key={groupName}
                  type="button"
                  onClick={() => setLayerVisible(groupName, !visible)}
                  className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/40 transition-colors"
                >
                  {visible ? (
                    <Eye className="h-3 w-3 text-foreground" />
                  ) : (
                    <EyeOff className="h-3 w-3 text-muted-foreground/60" />
                  )}
                  <span
                    className={
                      "text-[11px] font-mono truncate flex-1 text-left " +
                      (visible ? "" : "text-muted-foreground/60")
                    }
                  >
                    {groupName}
                  </span>
                </button>
              );
            })}
          </div>
        )}

      {/* Appearance (built-in shapes + GLTF/GLB models) */}
      {(config.shape != null || isGltf || !modelUrl) && (
        <div className="px-3 py-2 border-b border-border space-y-2">
          <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
            Appearance
          </Label>
          {(config.shape === "capsule" || isGltf || !config.shape) && (
            <>
              <Label className="flex items-center gap-2 text-[11px]">
                <Checkbox
                  checked={
                    (config.model3dHullGradient as boolean | undefined) ??
                    config.shape === "capsule"
                  }
                  onCheckedChange={(checked) =>
                    onChange({ model3dHullGradient: checked === true })
                  }
                  className="h-3 w-3"
                />
                Attitude gradient
              </Label>
              <p className="text-[10px] text-muted-foreground">
                Paints the model with the color scale along its long axis so
                rotation reads as moving color.
              </p>
            </>
          )}
          {(config.shape === "capsule" || isGltf || !config.shape) &&
            ((config.model3dHullGradient as boolean | undefined) ??
              config.shape === "capsule") && (
              <div>
                <Label className="text-[10px] text-muted-foreground">
                  Color scale
                </Label>
                <Select
                  value={(config.model3dColorScale as string) || "viridis"}
                  onValueChange={(v) => onChange({ model3dColorScale: v })}
                >
                  <SelectTrigger className="h-7 text-xs mt-0.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COLOR_SCALE_OPTIONS.map((name) => (
                      <SelectItem key={name} value={name} className="text-xs">
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          {config.shape != null && (
          <div>
            <Label className="text-[10px] text-muted-foreground">
              Hologram color
            </Label>
            <div className="flex gap-1.5 mt-1">
              {[
                ["#22c55e", "Green"],
                ["#22d3ee", "Cyan"],
                ["#f59e0b", "Amber"],
                ["#a78bfa", "Violet"],
                ["#fb7185", "Rose"],
                ["#e2e8f0", "White"],
              ].map(([hex, label]) => {
                const active =
                  (config.modelColor ?? "#22c55e") === hex;
                return (
                  <button
                    key={hex}
                    type="button"
                    title={label}
                    onClick={() =>
                      onChange({
                        modelColor: hex === "#22c55e" ? undefined : hex,
                      })
                    }
                    className={
                      "h-5 w-5 rounded-full border transition-shadow " +
                      (active
                        ? "ring-2 ring-offset-1 ring-offset-background ring-primary/60 border-transparent"
                        : "border-border hover:scale-110")
                    }
                    style={{ backgroundColor: hex }}
                  />
                );
              })}
            </div>
          </div>
          )}
        </div>
      )}

      {/* Part Bindings (GLTF/GLB only, or demo mode) */}
      {(isGltf || !config.modelUrl) && (
        <div className="px-3 py-2 border-b border-border space-y-2">
          <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
            Part Bindings
          </Label>
          {bindings.length === 0 && (
            <p className="text-[10px] text-muted-foreground">
              Bind metrics to model parts for data-driven coloring.
            </p>
          )}
          {bindings.map((binding, i) => (
            <div
              key={i}
              className="p-2 rounded border border-border space-y-1.5 bg-muted/30"
            >
              <div className="flex items-center justify-between">
                <Input
                  value={binding.partName}
                  onChange={(e) =>
                    updateBinding(i, { partName: e.target.value })
                  }
                  className="h-6 text-[11px] flex-1 mr-1"
                  placeholder="Part name"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeBinding(i)}
                  className="text-muted-foreground hover:text-destructive text-xs h-auto w-auto px-1"
                >
                  &times;
                </Button>
              </div>
              <MetricCombobox
                value={binding.metric || undefined}
                onChange={(v) => updateBinding(i, { metric: v ?? "" })}
                emptyLabel="No metric"
              />
              <div className="flex gap-2">
                <div className="flex-1">
                  <Label className="text-[9px] text-muted-foreground">
                    Warn &ge;
                  </Label>
                  <Input
                    type="number"
                    value={binding.thresholdWarning ?? ""}
                    onChange={(e) =>
                      updateBinding(i, {
                        thresholdWarning: e.target.value
                          ? parseFloat(e.target.value)
                          : undefined,
                      })
                    }
                    className="h-6 text-[11px]"
                    placeholder="-"
                  />
                </div>
                <div className="flex-1">
                  <Label className="text-[9px] text-muted-foreground">
                    Crit &ge;
                  </Label>
                  <Input
                    type="number"
                    value={binding.thresholdCritical ?? ""}
                    onChange={(e) =>
                      updateBinding(i, {
                        thresholdCritical: e.target.value
                          ? parseFloat(e.target.value)
                          : undefined,
                      })
                    }
                    className="h-6 text-[11px]"
                    placeholder="-"
                  />
                </div>
              </div>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="w-full h-7 text-xs"
            onClick={addBinding}
          >
            + Add Binding
          </Button>
        </div>
      )}

      {/* Orientation Metrics */}
      <div className="px-3 py-2 border-b border-border space-y-2">
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Orientation
        </Label>
        {(["pitchMetric", "rollMetric", "yawMetric"] as const).map((key) => {
          const label = key
            .replace("Metric", "")
            .replace(/^./, (c) => c.toUpperCase());
          return (
            <div key={key}>
              <Label className="text-[10px] text-muted-foreground">
                {label}
              </Label>
              <MetricCombobox
                value={(config[key] as string) || undefined}
                onChange={(v) => onChange({ [key]: v })}
                emptyLabel="Auto-detect"
                className="mt-0.5"
              />
            </div>
          );
        })}
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide pt-1 block">
          Quaternion
        </Label>
        <p className="text-[10px] text-muted-foreground">
          When all four are set, quaternion overrides pitch/roll/yaw.
        </p>
        {(
          [
            ["quatWMetric", "W"],
            ["quatXMetric", "X"],
            ["quatYMetric", "Y"],
            ["quatZMetric", "Z"],
          ] as const
        ).map(([key, label]) => (
          <div key={key}>
            <Label className="text-[10px] text-muted-foreground">
              {label}
            </Label>
            <MetricCombobox
              value={(config[key] as string) || undefined}
              onChange={(v) => onChange({ [key]: v })}
              emptyLabel="Not set"
              className="mt-0.5"
            />
          </div>
        ))}
      </div>
    </>
  );
}
