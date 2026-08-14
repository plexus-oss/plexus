"use client";

/**
 * Model3DConfigurator — pick a built-in primitive body (cylinder/box/cone,
 * zero CAD files needed) or upload a GLB/STL/OBJ / paste a URL / use the
 * bundled NASA demo model. Plus metric bindings: metrics named pitch/roll/yaw
 * drive the model's live orientation; others are available for callouts.
 */

import { useEffect, useState } from "react";
import { Box } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { SourcePicker } from "@/components/dashboard/source-picker";
import { FileDrop } from "./file-drop";
import type { ConfiguratorProps } from "./types";

const ACCEPTED = ".glb,.gltf,.stl,.obj,model/gltf-binary,model/gltf+json";

type PrimitiveShape = "cylinder" | "box" | "cone" | "capsule";

const SHAPES: { value: PrimitiveShape; label: string }[] = [
  { value: "cylinder", label: "Cylinder" },
  { value: "capsule", label: "Pod" },
  { value: "box", label: "Box" },
  { value: "cone", label: "Cone" },
];

function inferModelType(
  name: string | undefined,
): "stl" | "obj" | "gltf" | "glb" | undefined {
  if (!name) return undefined;
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "stl" || ext === "obj" || ext === "gltf" || ext === "glb") {
    return ext as "stl" | "obj" | "gltf" | "glb";
  }
  return undefined;
}

export function Model3DConfigurator({
  draft,
  onChange,
  onValidChange,
}: ConfiguratorProps) {
  const modelUrl = draft.config.modelUrl as string | undefined;
  const modelType = draft.config.modelType as
    | "stl"
    | "obj"
    | "gltf"
    | "glb"
    | undefined;
  const shape = draft.config.shape as PrimitiveShape | undefined;
  const [filename, setFilename] = useState<string | undefined>();

  // 3D panel is always valid — primitives need no file, and the demo model
  // loads when both shape and modelUrl are blank.
  useEffect(() => {
    onValidChange(true);
  }, [onValidChange]);

  const pickShape = (value: PrimitiveShape) => {
    onChange({
      ...draft,
      config: {
        ...draft.config,
        shape: value,
        modelUrl: undefined,
        modelType: undefined,
      },
    });
    setFilename(undefined);
  };

  const pickCustom = () => {
    onChange({
      ...draft,
      config: { ...draft.config, shape: undefined },
    });
  };

  const handleFile = (value: string | null, meta: { filename?: string }) => {
    if (!value) {
      onChange({
        ...draft,
        config: { ...draft.config, modelUrl: undefined, modelType: undefined },
      });
      setFilename(undefined);
      return;
    }
    const inferred = inferModelType(meta.filename);
    onChange({
      ...draft,
      config: {
        ...draft.config,
        shape: undefined,
        modelUrl: value,
        modelType: inferred,
      },
    });
    setFilename(meta.filename);
  };

  const handleUrl = (url: string) => {
    onChange({
      ...draft,
      config: {
        ...draft.config,
        shape: undefined,
        modelUrl: url,
        modelType: inferModelType(url) ?? "glb",
      },
    });
    setFilename(undefined);
  };

  const useDemoMode = () => {
    onChange({
      ...draft,
      config: {
        ...draft.config,
        shape: undefined,
        modelUrl: undefined,
        modelType: undefined,
      },
    });
  };

  const isCustom = !shape;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
            Model
          </Label>
          {isCustom && !modelUrl && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              Demo loaded
            </span>
          )}
        </div>
        <div className="flex gap-1.5 mb-2">
          {SHAPES.map((s) => (
            <Button
              key={s.value}
              variant={shape === s.value ? "secondary" : "outline"}
              size="sm"
              className="h-7 text-[11px] flex-1"
              onClick={() => pickShape(s.value)}
            >
              {s.label}
            </Button>
          ))}
          <Button
            variant={isCustom ? "secondary" : "outline"}
            size="sm"
            className="h-7 text-[11px] flex-1"
            onClick={pickCustom}
          >
            Custom
          </Button>
        </div>
        {isCustom && (
          <>
            <FileDrop
              accept={ACCEPTED}
              icon={Box}
              label="Drop GLB / GLTF / STL / OBJ"
              hint="Or paste a public URL below"
              urlPlaceholder="https://example.com/model.glb"
              readAs="dataURL"
              onChange={(value, meta) => {
                if (meta.source === "url" && value) {
                  handleUrl(value);
                } else {
                  handleFile(value, meta);
                }
              }}
              currentValue={modelUrl}
              currentLabel={
                filename ??
                (modelUrl?.startsWith("data:")
                  ? `Inline ${modelType?.toUpperCase() ?? "model"}`
                  : modelUrl)
              }
            />
            {modelUrl && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] mt-1.5 text-muted-foreground"
                onClick={useDemoMode}
              >
                Use NASA James Webb demo instead
              </Button>
            )}
          </>
        )}
      </div>

      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Orientation &amp; callouts
        </Label>
        <p className="text-[10px] text-muted-foreground mb-2">
          Metrics named pitch, roll, and yaw (degrees) drive the model&apos;s
          live orientation. Other metrics can be bound to parts as callouts
          after the panel is added.
        </p>
        <SourcePicker
          dataSource={draft.dataSource ?? { type: "realtime" }}
          selectedMetrics={draft.metrics ?? []}
          onDataSourceChange={(ds) =>
            onChange((prev) => ({ ...prev, dataSource: ds }))
          }
          onMetricsChange={(m) =>
            onChange((prev) => ({ ...prev, metrics: m }))
          }
        />
      </div>
    </div>
  );
}
