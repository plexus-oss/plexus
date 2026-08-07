"use client";

/**
 * SchematicConfigurator — inline SVG upload + data source + metric picker.
 *
 * Stores the sanitized SVG as a data URL in `config.schematicSvgUrl`
 * (same path the sidebar config-section uses). Auto-detection of pins
 * stays in the post-create sidebar — keeping this form short.
 */

import { useEffect, useState } from "react";
import { Workflow } from "lucide-react";
import { Label } from "@/components/ui/label";
import { SourcePicker } from "@/components/dashboard/source-picker";
import { sanitizeSvg } from "@/lib/schematic/sanitize";
import { FileDrop } from "./file-drop";
import type { ConfiguratorProps } from "./types";

export function SchematicConfigurator({
  draft,
  onChange,
  onValidChange,
}: ConfiguratorProps) {
  const [filename, setFilename] = useState<string | undefined>();
  const svgUrl = draft.config.schematicSvgUrl as string | undefined;
  const metrics = draft.metrics ?? [];

  const valid = !!svgUrl;
  useEffect(() => {
    onValidChange(valid);
  }, [valid, onValidChange]);

  const handleSvg = async (value: string | null, meta: { filename?: string }) => {
    if (!value) {
      onChange({
        ...draft,
        config: { ...draft.config, schematicSvgUrl: undefined },
      });
      setFilename(undefined);
      return;
    }
    // Value is the raw SVG text (FileDrop readAs=text). Sanitize → data URL.
    const cleaned = sanitizeSvg(value);
    if (!cleaned) return;
    const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(cleaned)}`;
    onChange({
      ...draft,
      config: {
        ...draft.config,
        schematicSvgUrl: dataUrl,
        schematicShowLabels: true,
        schematicShowConnectors: true,
        schematicBackgroundOpacity: 1,
      },
    });
    setFilename(meta.filename);
  };

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Schematic
        </Label>
        <div className="mt-1.5">
          <FileDrop
            accept=".svg,image/svg+xml"
            icon={Workflow}
            label="Drop schematic SVG"
            hint="P&ID, electrical, block diagram — anything vector"
            readAs="text"
            onChange={handleSvg}
            currentValue={svgUrl}
            currentLabel={
              filename
                ? filename
                : svgUrl?.startsWith("data:")
                  ? "Inline SVG"
                  : svgUrl
            }
          />
        </div>
      </div>

      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Data
        </Label>
        <p className="text-[10px] text-muted-foreground mb-2">
          Pick the metrics your pins should bind to. You can auto-detect
          matches after the panel is added.
        </p>
        <SourcePicker
          dataSource={draft.dataSource ?? { type: "realtime" }}
          selectedMetrics={metrics}
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
