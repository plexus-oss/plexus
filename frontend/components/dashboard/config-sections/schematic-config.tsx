"use client";

/**
 * Schematic panel config sidebar.
 *
 * Sections (top → bottom):
 *   1. Source       — upload SVG / paste URL / clear
 *   2. Auto-detect  — extract <text> labels from the uploaded SVG and fuzzy
 *                     match them to the panel's candidate metrics, then
 *                     review/accept the suggestions.
 *   3. Bindings     — list each TelemetryBinding with per-row metric picker,
 *                     display mode, label override, thresholds, offset, delete.
 *   4. Display      — show labels / show connectors / background opacity.
 */

import { useRef, useState } from "react";
import { Upload, Trash2, Plus, AlertCircle } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type { TelemetryBinding } from "@/lib/types/dashboard";
import { sanitizeSvg } from "@/lib/schematic/sanitize";
import { extractLabels } from "@/lib/schematic/extract-labels";
import {
  matchLabelsToMetrics,
  suggestionToBinding,
  type SuggestedBinding,
} from "@/lib/schematic/match-metrics";

interface Props {
  config: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
  metrics?: string[];
}

export function SchematicConfig({ config, onChange, metrics = [] }: Props) {
  const svgUrl = config.schematicSvgUrl as string | undefined;
  const bindings =
    (config.schematicBindings as TelemetryBinding[] | undefined) ?? [];

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Auto-detect state
  const [suggestions, setSuggestions] = useState<SuggestedBinding[] | null>(
    null,
  );
  const [detectError, setDetectError] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [acceptedSuggestionLabels, setAcceptedSuggestionLabels] = useState<
    Set<string>
  >(new Set());

  // ── Upload ─────────────────────────────────────────────────────────
  const handleFile = async (file: File) => {
    setUploadError(null);
    setUploading(true);
    try {
      if (
        !file.name.toLowerCase().endsWith(".svg") &&
        file.type !== "image/svg+xml"
      ) {
        throw new Error("Please upload a .svg file.");
      }
      const text = await file.text();
      // Sanitize before storing so the persisted config can't carry an XSS.
      const cleaned = sanitizeSvg(text);
      if (!cleaned) throw new Error("SVG was empty after sanitization.");
      // Inline as a data URL so the schematic loads without a separate
      // upload pipeline. SVGs of typical schematic size (<200KB) work fine.
      const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(cleaned)}`;
      onChange({
        schematicSvgUrl: dataUrl,
        // Reset bindings when the schematic changes — id-anchors won't
        // generally survive a different SVG.
        schematicBindings: [],
      });
      setSuggestions(null);
      setAcceptedSuggestionLabels(new Set());
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Could not load SVG");
    } finally {
      setUploading(false);
    }
  };

  // ── Auto-detect ────────────────────────────────────────────────────
  const handleAutoDetect = async () => {
    setDetectError(null);
    setSuggestions(null);
    if (!svgUrl) {
      setDetectError("Upload an SVG first.");
      return;
    }
    if (metrics.length === 0) {
      setDetectError(
        "Select at least one metric in the data source before auto-detecting.",
      );
      return;
    }
    setDetecting(true);
    try {
      // Fetch from URL (handles data: URLs natively).
      const text = await (await fetch(svgUrl)).text();
      const cleaned = sanitizeSvg(text);
      // Parse into a detached DOM tree.
      const parser = new DOMParser();
      const doc = parser.parseFromString(cleaned, "image/svg+xml");
      const svg = doc.documentElement as unknown as SVGSVGElement;
      // Attach to the DOM in an off-screen container so getCTM/getBBox work.
      const host = document.createElement("div");
      host.style.cssText =
        "position:fixed;top:-99999px;left:-99999px;width:1000px;height:1000px;visibility:hidden;";
      const importedSvg = document.importNode(svg, true);
      host.appendChild(importedSvg);
      document.body.appendChild(host);
      try {
        const labels = extractLabels(importedSvg as SVGSVGElement);
        const suggested = matchLabelsToMetrics(labels, metrics, {
          threshold: 0.5,
        });
        setSuggestions(suggested);
        if (suggested.length === 0) {
          setDetectError(
            "No matches found. Try labeling more pins or selecting more metrics.",
          );
        }
      } finally {
        document.body.removeChild(host);
      }
    } catch (e) {
      setDetectError(e instanceof Error ? e.message : "Detection failed");
    } finally {
      setDetecting(false);
    }
  };

  const acceptSuggestion = (s: SuggestedBinding) => {
    const next = [...bindings, suggestionToBinding(s)];
    onChange({ schematicBindings: next });
    setAcceptedSuggestionLabels((prev) => new Set(prev).add(s.label));
  };

  const acceptAllSuggestions = () => {
    if (!suggestions) return;
    const fresh = suggestions
      .filter((s) => !acceptedSuggestionLabels.has(s.label))
      .map(suggestionToBinding);
    onChange({ schematicBindings: [...bindings, ...fresh] });
    setAcceptedSuggestionLabels(new Set(suggestions.map((s) => s.label)));
  };

  // ── Manual binding edits ───────────────────────────────────────────
  const updateBinding = (id: string, updates: Partial<TelemetryBinding>) => {
    onChange({
      schematicBindings: bindings.map((b) =>
        b.id === id ? { ...b, ...updates } : b,
      ),
    });
  };

  const removeBinding = (id: string) => {
    onChange({
      schematicBindings: bindings.filter((b) => b.id !== id),
    });
  };

  const addBlankBinding = () => {
    const fresh: TelemetryBinding = {
      id: crypto.randomUUID(),
      anchor: { kind: "svg-point", x: 0, y: 0 },
      metric: metrics[0] ?? "",
      display: "value",
    };
    onChange({ schematicBindings: [...bindings, fresh] });
  };

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <>
      {/* Source */}
      <section className="px-3 py-3 border-b border-border space-y-2">
        <SectionLabel>Schematic</SectionLabel>
        {svgUrl ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 truncate text-[11px] text-muted-foreground">
              {svgUrl.startsWith("data:")
                ? "Inline SVG"
                : svgUrl.split("/").pop()}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px]"
              onClick={() => {
                onChange({ schematicSvgUrl: undefined, schematicBindings: [] });
                setSuggestions(null);
              }}
            >
              Clear
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px]"
              onClick={() => fileInputRef.current?.click()}
            >
              Replace
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full h-16 rounded-md border border-dashed border-border bg-muted/20 hover:bg-muted/30 hover:border-border/60 transition-colors flex flex-col items-center justify-center gap-1.5"
          >
            <Upload className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground">
              {uploading ? "Loading…" : "Upload SVG"}
            </span>
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".svg,image/svg+xml"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) await handleFile(file);
            e.target.value = "";
          }}
        />
        {uploadError && (
          <p className="text-[11px] text-destructive flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            {uploadError}
          </p>
        )}
      </section>

      {/* Auto-detect */}
      {svgUrl && (
        <section className="px-3 py-3 border-b border-border space-y-2">
          <SectionLabel>Auto-detect pins</SectionLabel>
          <p className="text-[10px] text-muted-foreground">
            Reads &lt;text&gt; labels from your SVG and matches them to your
            selected metrics.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-full text-[11px]"
            disabled={detecting}
            onClick={handleAutoDetect}
          >
            {detecting ? <Spinner className="h-3 w-3" /> : null}
            {detecting ? "Detecting…" : "Detect from labels"}
          </Button>
          {detectError && (
            <p className="text-[11px] text-destructive">{detectError}</p>
          )}
          {suggestions && suggestions.length > 0 && (
            <div className="space-y-1.5 mt-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">
                  {suggestions.length} suggestion
                  {suggestions.length !== 1 ? "s" : ""}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px]"
                  onClick={acceptAllSuggestions}
                  disabled={suggestions.every((s) =>
                    acceptedSuggestionLabels.has(s.label),
                  )}
                >
                  Accept all
                </Button>
              </div>
              <ul className="space-y-1">
                {suggestions.map((s) => {
                  const accepted = acceptedSuggestionLabels.has(s.label);
                  return (
                    <li
                      key={s.label + s.metric}
                      className="flex items-center gap-2 rounded border border-border/60 bg-muted/20 px-2 py-1.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-medium truncate">
                          {s.label}
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate font-mono">
                          {s.metric.includes(":")
                            ? s.metric.split(":")[1]
                            : s.metric}
                        </div>
                      </div>
                      <span
                        className="text-[9px] tabular-nums text-muted-foreground"
                        title={`Confidence ${(1 - s.confidence).toFixed(2)}`}
                      >
                        {Math.round((1 - s.confidence) * 100)}%
                      </span>
                      <Button
                        variant={accepted ? "ghost" : "outline"}
                        size="sm"
                        className="h-6 text-[10px] px-2"
                        disabled={accepted}
                        onClick={() => acceptSuggestion(s)}
                      >
                        {accepted ? "Added" : "Add"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Bindings */}
      {svgUrl && (
        <section className="px-3 py-3 border-b border-border space-y-2">
          <div className="flex items-center justify-between">
            <SectionLabel>Pins ({bindings.length})</SectionLabel>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px]"
              onClick={addBlankBinding}
            >
              <Plus className="h-3 w-3 mr-1" />
              Add
            </Button>
          </div>
          {bindings.length === 0 && (
            <p className="text-[10px] text-muted-foreground">
              No pins yet. Use Auto-detect or click Add to place one manually.
            </p>
          )}
          <div className="space-y-2">
            {bindings.map((b) => (
              <BindingEditor
                key={b.id}
                binding={b}
                metrics={metrics}
                onChange={(updates) => updateBinding(b.id, updates)}
                onDelete={() => removeBinding(b.id)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Display */}
      {svgUrl && (
        <section className="px-3 py-3 border-b border-border space-y-1.5">
          <SectionLabel>Display</SectionLabel>
          <Label className="flex items-center gap-2 text-[11px]">
            <Checkbox
              checked={(config.schematicShowConnectors as boolean) !== false}
              onCheckedChange={(checked) =>
                onChange({ schematicShowConnectors: checked === true })
              }
              className="h-3 w-3"
            />
            Connector lines
          </Label>
          <Label className="flex items-center gap-2 text-[11px]">
            <Checkbox
              checked={(config.schematicShowLabels as boolean) !== false}
              onCheckedChange={(checked) =>
                onChange({ schematicShowLabels: checked === true })
              }
              className="h-3 w-3"
            />
            Pin labels
          </Label>
          <div>
            <Label className="text-[10px] text-muted-foreground">
              Schematic opacity
            </Label>
            <Input
              type="number"
              min={0.1}
              max={1}
              step={0.05}
              value={(config.schematicBackgroundOpacity as number) ?? 1}
              onChange={(e) =>
                onChange({
                  schematicBackgroundOpacity: Math.min(
                    1,
                    Math.max(0.1, parseFloat(e.target.value) || 1),
                  ),
                })
              }
              className="h-7 text-[11px] mt-0.5"
            />
          </div>
        </section>
      )}
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
      {children}
    </Label>
  );
}

function BindingEditor({
  binding,
  metrics,
  onChange,
  onDelete,
}: {
  binding: TelemetryBinding;
  metrics: string[];
  onChange: (updates: Partial<TelemetryBinding>) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);

  // Collapse when a metric gets assigned — keeps the list scannable when a
  // panel has 20+ pins. Adjusting state from a changed prop during render
  // (tracking the previous value) avoids a setState-in-effect cascade.
  const [prevMetric, setPrevMetric] = useState(binding.metric);
  if (binding.metric !== prevMetric) {
    setPrevMetric(binding.metric);
    if (binding.metric) setOpen(false);
  }

  const metricLabel = binding.metric
    ? binding.metric.includes(":")
      ? binding.metric.split(":")[1]
      : binding.metric
    : "No metric";

  return (
    <div className="rounded border border-border/60 bg-muted/20">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-muted/40 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium truncate">
            {binding.label || metricLabel}
          </div>
          <div className="text-[10px] text-muted-foreground truncate font-mono">
            {metricLabel}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-muted-foreground hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </button>
      {open && (
        <div className="px-2 pb-2 space-y-1.5 border-t border-border/60 pt-2">
          {/* Metric */}
          <div>
            <Label className="text-[9px] text-muted-foreground">Metric</Label>
            <Select
              value={binding.metric || "_none"}
              onValueChange={(v) =>
                onChange({ metric: v === "_none" ? "" : v })
              }
            >
              <SelectTrigger className="h-6 text-[11px] mt-0.5">
                <SelectValue placeholder="Pick a metric" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none" className="text-xs">
                  No metric
                </SelectItem>
                {metrics.map((m) => (
                  <SelectItem key={m} value={m} className="text-xs">
                    {m.includes(":") ? m.split(":")[1] : m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Display + label */}
          <div className="flex gap-1.5">
            <div className="flex-1">
              <Label className="text-[9px] text-muted-foreground">Show</Label>
              <Select
                value={binding.display}
                onValueChange={(v) =>
                  onChange({ display: v as TelemetryBinding["display"] })
                }
              >
                <SelectTrigger className="h-6 text-[11px] mt-0.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="value" className="text-xs">
                    Value
                  </SelectItem>
                  <SelectItem value="state" className="text-xs">
                    State
                  </SelectItem>
                  <SelectItem value="indicator" className="text-xs">
                    Indicator
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <Label className="text-[9px] text-muted-foreground">Label</Label>
              <Input
                value={binding.label ?? ""}
                onChange={(e) =>
                  onChange({ label: e.target.value || undefined })
                }
                className="h-6 text-[11px] mt-0.5"
                placeholder="Auto"
              />
            </div>
          </div>

          {/* Thresholds */}
          <div className="flex gap-1.5">
            <div className="flex-1">
              <Label className="text-[9px] text-muted-foreground">Warn ≥</Label>
              <Input
                type="number"
                value={binding.thresholdWarning ?? ""}
                onChange={(e) =>
                  onChange({
                    thresholdWarning: e.target.value
                      ? parseFloat(e.target.value)
                      : undefined,
                  })
                }
                className="h-6 text-[11px] mt-0.5"
                placeholder="–"
              />
            </div>
            <div className="flex-1">
              <Label className="text-[9px] text-muted-foreground">Crit ≥</Label>
              <Input
                type="number"
                value={binding.thresholdCritical ?? ""}
                onChange={(e) =>
                  onChange({
                    thresholdCritical: e.target.value
                      ? parseFloat(e.target.value)
                      : undefined,
                  })
                }
                className="h-6 text-[11px] mt-0.5"
                placeholder="–"
              />
            </div>
          </div>

          {/* Callout offset */}
          <div className="flex gap-1.5">
            <div className="flex-1">
              <Label className="text-[9px] text-muted-foreground">
                Offset X
              </Label>
              <Input
                type="number"
                value={binding.calloutOffset?.dx ?? ""}
                onChange={(e) => {
                  const dx = parseFloat(e.target.value);
                  onChange({
                    calloutOffset: {
                      dx: Number.isFinite(dx) ? dx : 28,
                      dy: binding.calloutOffset?.dy ?? -22,
                    },
                  });
                }}
                className="h-6 text-[11px] mt-0.5"
                placeholder="28"
              />
            </div>
            <div className="flex-1">
              <Label className="text-[9px] text-muted-foreground">
                Offset Y
              </Label>
              <Input
                type="number"
                value={binding.calloutOffset?.dy ?? ""}
                onChange={(e) => {
                  const dy = parseFloat(e.target.value);
                  onChange({
                    calloutOffset: {
                      dx: binding.calloutOffset?.dx ?? 28,
                      dy: Number.isFinite(dy) ? dy : -22,
                    },
                  });
                }}
                className="h-6 text-[11px] mt-0.5"
                placeholder="-22"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
