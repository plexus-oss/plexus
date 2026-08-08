"use client";

/**
 * Import-from-Grafana sheet — the free migration path.
 *
 * Flow (two-phase, mirroring POST /api/dashboards/import/grafana):
 *   1. Paste or upload Grafana dashboard JSON → dry-run parse returns the
 *      per-panel import report + the distinct extracted metric names.
 *   2. Bind each extracted name to a real org metric (Select over the same
 *      metricsBySource the rest of the app uses) → Create.
 *
 * House pattern: Sheet matching column-metadata-sheet (header / scrolling
 * body / in-panel footer actions with the Button `loading` prop). Nothing is
 * silently dropped — the report lists every panel as mapped or skipped.
 */

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, FileJson, Minus } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAvailableMetrics } from "@/hooks/use-telemetry";
import { toast } from "@/lib/toast-utils";
import type { ImportReport } from "@/lib/import/grafana";

const UNBOUND = "__unbound__";

interface GrafanaImportSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface DryRunResponse {
  title: string;
  report: ImportReport;
}

export function GrafanaImportSheet({
  open,
  onOpenChange,
}: GrafanaImportSheetProps) {
  const router = useRouter();
  const { metricsBySource } = useAvailableMetrics();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<"input" | "bind">("input");
  const [rawText, setRawText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<DryRunResponse | null>(null);
  const [name, setName] = useState("");
  // extracted name → "source:metric" (or UNBOUND)
  const [bindings, setBindings] = useState<Record<string, string>>({});

  // Reset on open (render-phase pattern, same as column-metadata-sheet).
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setStep("input");
      setRawText("");
      setFileName(null);
      setParsing(false);
      setCreating(false);
      setResult(null);
      setName("");
      setBindings({});
    }
  }

  // Every bindable org metric as a "source:metric" option.
  const metricOptions = useMemo(
    () =>
      metricsBySource.flatMap((s) =>
        s.metrics.map((m) => ({
          value: `${s.source_id}:${m}`,
          source: s.source_id,
          metric: m,
        })),
      ),
    [metricsBySource],
  );

  /** Best-effort prefill: exact / tail-of-dot-path match on metric name. */
  const suggestBinding = (extracted: string): string => {
    const lower = extracted.toLowerCase();
    const tail = lower.split(".").pop() ?? lower;
    const exact = metricOptions.find((o) => o.metric.toLowerCase() === lower);
    if (exact) return exact.value;
    const byTail = metricOptions.find((o) => o.metric.toLowerCase() === tail);
    return byTail ? byTail.value : UNBOUND;
  };

  const handleFile = (file: File) => {
    file
      .text()
      .then((text) => {
        setRawText(text);
        setFileName(file.name);
      })
      .catch(() => toast.error("Could not read that file"));
  };

  const handleParse = async () => {
    let dashboard: unknown;
    try {
      dashboard = JSON.parse(rawText);
    } catch {
      toast.error("That isn't valid JSON — paste the Grafana dashboard JSON");
      return;
    }
    setParsing(true);
    try {
      const res = await fetch("/api/dashboards/import/grafana", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dashboard }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<
        DryRunResponse & { error: string }
      >;
      if (!res.ok || !body.report) {
        throw new Error(body.error || "Failed to parse dashboard");
      }
      setResult({ title: body.title ?? "Imported Grafana dashboard", report: body.report });
      setName(body.title ?? "");
      const prefill: Record<string, string> = {};
      for (const m of body.report.metrics) prefill[m] = suggestBinding(m);
      setBindings(prefill);
      setStep("bind");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to parse dashboard");
    } finally {
      setParsing(false);
    }
  };

  const handleCreate = async () => {
    if (!result) return;
    let dashboard: unknown;
    try {
      dashboard = JSON.parse(rawText);
    } catch {
      toast.error("Dashboard JSON is no longer valid");
      return;
    }
    const bound: Record<string, { sourceRef: string; metric: string }> = {};
    for (const [extracted, value] of Object.entries(bindings)) {
      if (value === UNBOUND) continue;
      const idx = value.indexOf(":");
      if (idx <= 0) continue;
      bound[extracted] = {
        sourceRef: value.slice(0, idx),
        metric: value.slice(idx + 1),
      };
    }
    setCreating(true);
    try {
      const res = await fetch("/api/dashboards/import/grafana", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dashboard,
          bindings: bound,
          name: name.trim() || undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        dashboard?: { id: string };
        error?: string;
      };
      if (!res.ok || !body.dashboard) {
        throw new Error(body.error || "Failed to create dashboard");
      }
      onOpenChange(false);
      router.push(`/dashboards/${body.dashboard.id}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create dashboard",
      );
      setCreating(false);
    }
  };

  const report = result?.report;
  const boundCount = Object.values(bindings).filter(
    (v) => v !== UNBOUND,
  ).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle className="text-sm">Import from Grafana</SheetTitle>
          <SheetDescription>
            {step === "input"
              ? "Paste a Grafana dashboard JSON export — layout, panels, and units carry over."
              : "Point each Grafana series at one of your metrics. Unbound panels still import, ready to wire up later."}
          </SheetDescription>
        </SheetHeader>

        {step === "input" ? (
          <div className="flex-1 space-y-4 px-6 py-5">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Dashboard JSON
              </Label>
              <Textarea
                value={rawText}
                onChange={(e) => {
                  setRawText(e.target.value);
                  setFileName(null);
                }}
                placeholder='{"title": "…", "panels": […]}'
                rows={14}
                className="font-mono text-[11px]"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <FileJson className="mr-1.5 h-3.5 w-3.5" />
                Upload .json
              </Button>
              {fileName && (
                <span className="truncate text-[11px] text-muted-foreground">
                  {fileName}
                </span>
              )}
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              In Grafana: dashboard → Share → Export → Save to file. Every
              panel is accounted for — anything that can&apos;t be mapped is
              listed with a reason before anything is created.
            </p>
          </div>
        ) : (
          <div className="flex-1 space-y-5 px-6 py-5">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Dashboard name
              </Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={result?.title}
              />
            </div>

            {report && report.metrics.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Metric bindings · {boundCount}/{report.metrics.length} bound
                </Label>
                <div className="divide-y divide-border rounded-md border border-border">
                  {report.metrics.map((m) => (
                    <div
                      key={m}
                      className="flex items-center gap-3 px-3 py-2"
                    >
                      <span
                        className="min-w-0 flex-1 truncate font-mono text-[11px]"
                        title={m}
                      >
                        {m}
                      </span>
                      <Select
                        value={bindings[m] ?? UNBOUND}
                        onValueChange={(v) =>
                          setBindings((b) => ({ ...b, [m]: v }))
                        }
                      >
                        <SelectTrigger className="h-7 w-[200px] shrink-0 text-[11px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={UNBOUND} className="text-[11px]">
                            <span className="text-muted-foreground">
                              Leave unbound
                            </span>
                          </SelectItem>
                          {metricOptions.map((o) => (
                            <SelectItem
                              key={o.value}
                              value={o.value}
                              className="text-[11px]"
                            >
                              {o.source} · {o.metric}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
                {metricOptions.length === 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    No metrics in this org yet — the dashboard imports with
                    unbound panels; connect a source and bind them in the
                    panel editor.
                  </p>
                )}
              </div>
            )}

            {report && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Import report · {report.mapped} mapped
                  {report.skipped > 0 ? ` · ${report.skipped} skipped` : ""}
                </Label>
                <div className="max-h-56 divide-y divide-border overflow-y-auto rounded-md border border-border">
                  {report.panels.map((p, i) => (
                    <div key={`${p.sourcePanelId}-${i}`} className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {p.outcome === "mapped" ? (
                          <Check className="h-3 w-3 shrink-0 text-muted-foreground" />
                        ) : (
                          <Minus className="h-3 w-3 shrink-0 text-muted-foreground" />
                        )}
                        <span className="min-w-0 flex-1 truncate text-[11px]">
                          {p.title}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                          {p.outcome === "mapped"
                            ? `${p.grafanaType} → ${p.plexusType}`
                            : p.grafanaType}
                        </span>
                      </div>
                      {p.outcome === "skipped" && p.reason && (
                        <p className="mt-0.5 pl-5 text-[10px] text-muted-foreground">
                          {p.reason}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                {report.warnings.length > 0 && (
                  <ul className="space-y-0.5 pt-1">
                    {report.warnings.map((w, i) => (
                      <li
                        key={i}
                        className="text-[10px] leading-relaxed text-muted-foreground"
                      >
                        {w}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-border px-6 py-4">
          {step === "bind" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setStep("input")}
              disabled={creating}
            >
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              Back
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={parsing || creating}
            >
              Cancel
            </Button>
            {step === "input" ? (
              <Button
                type="button"
                size="sm"
                onClick={handleParse}
                loading={parsing}
                disabled={rawText.trim().length === 0}
              >
                Parse dashboard
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={handleCreate}
                loading={creating}
                disabled={!result || (report?.mapped ?? 0) === 0}
              >
                Create dashboard
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
