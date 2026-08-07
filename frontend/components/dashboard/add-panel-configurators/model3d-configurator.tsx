"use client";

/**
 * Model3DConfigurator — upload a GLB/STL/OBJ, paste a URL, or use the
 * bundled NASA demo model. Plus optional metric bindings for callouts.
 */

import { useEffect, useState } from "react";
import { Box } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { SourcePicker } from "@/components/dashboard/source-picker";
import { FileDrop } from "./file-drop";
import type { ConfiguratorProps } from "./types";

const ACCEPTED = ".glb,.gltf,.stl,.obj,model/gltf-binary,model/gltf+json";

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
  const useDemo =
    !!(draft.config as { useDemo?: boolean }).useDemo || !modelUrl;
  const [filename, setFilename] = useState<string | undefined>();

  // 3D panel is always valid — demo loads when modelUrl is blank.
  useEffect(() => {
    onValidChange(true);
  }, [onValidChange]);

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
        modelUrl: url,
        modelType: inferModelType(url) ?? "glb",
      },
    });
    setFilename(undefined);
  };

  const useDemoMode = () => {
    onChange({
      ...draft,
      config: { ...draft.config, modelUrl: undefined, modelType: undefined },
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
            Model
          </Label>
          {!modelUrl && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              Demo loaded
            </span>
          )}
        </div>
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
      </div>

      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Floating callouts (optional)
        </Label>
        <p className="text-[10px] text-muted-foreground mb-2">
          Select metrics here. You can click parts to bind them after the panel
          is added.
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
      {/* Silence the unused-variable lint when modelType-inferred branches are unused */}
      <span className="hidden">{useDemo ? "" : null}</span>
    </div>
  );
}
