"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, FileSpreadsheet, X } from "lucide-react";
import { format } from "date-fns";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FileUpload, type FileInfo } from "@/components/file-upload";
import { toast } from "@/lib/toast-utils";
import { useRuns } from "@/hooks/use-runs";
import { parseCSV, previewCSV, type ParsedRow } from "@/lib/import/parser";
import { parseUlog, UlogError, type ParsedUlog } from "@/lib/import/ulog";

const MAX_FILE_MB = 50;
/** ULog files parse in-memory (ArrayBuffer): hard cap 200 MB, warn above 50. */
const ULOG_MAX_FILE_MB = 200;
const ULOG_WARN_FILE_MB = 50;
/** Topic-picker defaults: pre-check metrics with ≥ this many points… */
const ULOG_PRECHECK_MIN_COUNT = 100;
/** …capped at this many metrics (largest first). */
const ULOG_PRECHECK_MAX = 40;
/** Per-request cap of POST /api/import/telemetry (mirrors ingest's cap). */
const API_BATCH_SIZE = 10_000;
/** Sentinel for "wide" shape: every numeric column is its own metric. */
const WIDE = "__wide__";

/** Exact-name timestamp headers, tried before the looser substring match. */
const TS_EXACT =
  /^_?(time|timestamp|ts|date|datetime|created_at|recorded_at|logged_at)$/i;
const TS_LOOSE = /time|date/i;
/** Long-shape metric-name headers (e.g. InfluxDB's _field/_measurement). */
const METRIC_HEADER = /^_?(metric|measurement|field|channel|signal|sensor)s?$/i;
/** Long-shape value headers. */
const VALUE_HEADER = /^_?(value|val|reading)$/i;

interface DetectedMapping {
  timestamp: string;
  /** Column name, or WIDE for one-metric-per-numeric-column. */
  metric: string;
  value: string;
}

interface ParsedPreview {
  rows: ParsedRow[];
  errorCount: number;
  metricCount: number;
  start: number;
  end: number;
}

function looksLikeTimestampValue(v: unknown): boolean {
  if (typeof v === "number") return v > 1e9; // epoch s/ms/µs
  if (typeof v === "string") return !isNaN(new Date(v).getTime());
  return false;
}

function detectTimestampColumn(
  columns: string[],
  rows: Record<string, unknown>[],
): string {
  const exact = columns.find((c) => TS_EXACT.test(c));
  if (exact) return exact;
  const loose = columns.find((c) => TS_LOOSE.test(c));
  if (loose) return loose;
  // First column whose samples look ISO- or epoch-shaped.
  const sampled = columns.find((c) =>
    rows.some((r) => r[c] != null && looksLikeTimestampValue(r[c])),
  );
  return sampled ?? columns[0];
}

/** Columns whose sampled values are mostly numbers (papaparse dynamicTyping). */
function numericColumns(
  columns: string[],
  rows: Record<string, unknown>[],
): string[] {
  return columns.filter((c) => {
    let numbers = 0;
    let present = 0;
    for (const r of rows) {
      const v = r[c];
      if (v == null || v === "") continue;
      present++;
      if (typeof v === "number") numbers++;
    }
    return present > 0 && numbers >= present / 2;
  });
}

function detectMapping(
  columns: string[],
  rows: Record<string, unknown>[],
): DetectedMapping {
  const timestamp = detectTimestampColumn(columns, rows);
  const numeric = numericColumns(columns, rows).filter((c) => c !== timestamp);
  const metricCol = columns.find(
    (c) => c !== timestamp && !numeric.includes(c) && METRIC_HEADER.test(c),
  );
  if (metricCol && numeric.length > 0) {
    // LONG shape: a metric-name column plus one value column.
    const value =
      numeric.find((c) => VALUE_HEADER.test(c)) ??
      numeric.find((c) => c !== metricCol) ??
      numeric[0];
    return { timestamp, metric: metricCol, value };
  }
  // WIDE shape: each numeric column is its own metric.
  return { timestamp, metric: WIDE, value: numeric[0] ?? "" };
}

/**
 * Post-parse timestamp normalization. parser.ts scales numeric stamps with a
 * single 1e12 boundary (<1e12 → seconds×1000), which passes microsecond
 * stamps through untouched and over-scales pre-2001 epoch-ms. Anything above
 * 1e14 after the parser ran is not a plausible epoch-ms value (year ≳5138),
 * so dividing by 1000 restores both cases. Non-positive stamps are dropped —
 * unstamped points land at epoch 1970 downstream (known bug class) and the
 * API rejects them anyway.
 */
function normalizeRows(rows: ParsedRow[]): {
  rows: ParsedRow[];
  dropped: number;
} {
  const out: ParsedRow[] = [];
  let dropped = 0;
  for (const row of rows) {
    let t = row.timestamp;
    if (t > 1e14) t = Math.round(t / 1000);
    if (!Number.isFinite(t) || t <= 0) {
      dropped++;
      continue;
    }
    out.push(t === row.timestamp ? row : { ...row, timestamp: t });
  }
  out.sort((a, b) => a.timestamp - b.timestamp);
  return { rows: out, dropped };
}

const formatTs = (ms: number) => format(new Date(ms), "yyyy-MM-dd HH:mm:ss");

/** Compact value formatting for the ULog picker's min→max column. */
function formatVal(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (Number.isInteger(v) && Math.abs(v) < 1e12) return v.toLocaleString();
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(0);
  if (a >= 1) return v.toFixed(2);
  return v.toPrecision(3);
}

/** Default picker selection: count ≥ 100, capped at the 40 largest. */
function defaultUlogSelection(parsed: ParsedUlog): Set<string> {
  const eligible = [...parsed.metrics.entries()]
    .filter(([, m]) => m.count >= ULOG_PRECHECK_MIN_COUNT)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, ULOG_PRECHECK_MAX)
    .map(([name]) => name);
  return new Set(eligible);
}

interface ImportDataSheetProps {
  /** Slug of the device the points are imported into. */
  sourceSlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportDataSheet({
  sourceSlug,
  open,
  onOpenChange,
}: ImportDataSheetProps) {
  // Run creation goes through the shared runs hook (it owns toasts + cache
  // sync); enabled:false skips fetching the list this sheet never renders.
  const { createRun } = useRuns({ enabled: false });

  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [tsCol, setTsCol] = useState("");
  const [metricCol, setMetricCol] = useState<string>(WIDE);
  const [valueCol, setValueCol] = useState("");
  // ULog path — replaces the CSV column-mapping step with a topic/field picker.
  const [ulog, setUlog] = useState<ParsedUlog | null>(null);
  const [ulogSelected, setUlogSelected] = useState<Set<string>>(new Set());
  const [ulogSearch, setUlogSearch] = useState("");
  const [saveRun, setSaveRun] = useState(true);
  const [runName, setRunName] = useState("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ i: number; n: number } | null>(
    null,
  );

  const resetFile = () => {
    setFileName(null);
    setCsvText(null);
    setTsCol("");
    setMetricCol(WIDE);
    setValueCol("");
    setUlog(null);
    setUlogSelected(new Set());
    setUlogSearch("");
  };

  const handleOpenChange = (next: boolean) => {
    if (importing) return; // don't tear down mid-import
    if (!next) {
      resetFile();
      setSaveRun(true);
      setRunName("");
    }
    onOpenChange(next);
  };

  const handleFiles = async (files: FileInfo[]) => {
    const info = files[0];
    if (!info) return;
    if (/\.ulo?g$/i.test(info.name)) {
      // ULog: parse locally (the file never leaves the machine).
      if (info.size > ULOG_MAX_FILE_MB * 1024 * 1024) {
        toast.error(`Log is too large — ${ULOG_MAX_FILE_MB} MB max`);
        return;
      }
      if (info.size > ULOG_WARN_FILE_MB * 1024 * 1024) {
        toast.warning("Large log — parsing in memory, this can take a moment");
      }
      try {
        const buf = await info.file.arrayBuffer();
        const result = parseUlog(buf, {
          fileLastModifiedMs: info.file.lastModified,
        });
        if (result.metrics.size === 0) {
          toast.error("No numeric telemetry found in this log");
          return;
        }
        setFileName(info.name);
        setUlog(result);
        setUlogSelected(defaultUlogSelection(result));
        setRunName(info.name.replace(/\.[^.]+$/, ""));
      } catch (err) {
        toast.error(
          err instanceof UlogError ? err.message : "Failed to parse ULog file",
        );
      }
      return;
    }
    if (info.size > MAX_FILE_MB * 1024 * 1024) {
      toast.error(`CSV is too large — ${MAX_FILE_MB} MB max`);
      return;
    }
    try {
      const text = await info.file.text();
      const { columns, rows } = previewCSV(text, 100);
      if (columns.length === 0) {
        toast.error("Could not read any columns from this CSV");
        return;
      }
      const detected = detectMapping(columns, rows);
      setFileName(info.name);
      setCsvText(text);
      setTsCol(detected.timestamp);
      setMetricCol(detected.metric);
      setValueCol(detected.value);
      setRunName(info.name.replace(/\.[^.]+$/, ""));
    } catch {
      toast.error("Failed to read file");
    }
  };

  // Sampled header/rows for the mapping selects (cheap; full parse is below).
  const sample = useMemo(
    () => (csvText ? previewCSV(csvText, 100) : null),
    [csvText],
  );
  const columns = useMemo(() => sample?.columns ?? [], [sample]);
  const numericCols = useMemo(
    () => (sample ? numericColumns(columns, sample.rows) : []),
    [sample, columns],
  );

  const parsed = useMemo<ParsedPreview | null>(() => {
    if (!csvText || !tsCol) return null;
    const rows: ParsedRow[] = [];
    let errorCount = 0;
    if (metricCol === WIDE) {
      // WIDE: loop-parse once per numeric column, header = metric name.
      // parser.ts supports this via staticMetric — no parser changes needed.
      for (const col of numericCols.filter((c) => c !== tsCol)) {
        const r = parseCSV(
          csvText,
          { timestamp: tsCol, value: col },
          { staticMetric: col, staticSourceId: sourceSlug },
        );
        rows.push(...r.rows);
        errorCount += r.errors.length;
      }
    } else {
      if (!valueCol) return null;
      const r = parseCSV(
        csvText,
        { timestamp: tsCol, metric: metricCol, value: valueCol },
        { staticSourceId: sourceSlug },
      );
      rows.push(...r.rows);
      errorCount += r.errors.length;
    }
    const normalized = normalizeRows(rows);
    const metrics = new Set(normalized.rows.map((r) => r.metric));
    return {
      rows: normalized.rows,
      errorCount: errorCount + normalized.dropped,
      metricCount: metrics.size,
      start: normalized.rows[0]?.timestamp ?? 0,
      end: normalized.rows[normalized.rows.length - 1]?.timestamp ?? 0,
    };
  }, [csvText, tsCol, metricCol, valueCol, numericCols, sourceSlug]);

  // ── ULog picker state ─────────────────────────────────────────────────────
  // Full metric list sorted by point count desc (picker order).
  const ulogMetrics = useMemo(() => {
    if (!ulog) return [];
    return [...ulog.metrics.entries()]
      .map(([name, m]) => ({ name, count: m.count, min: m.min, max: m.max }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [ulog]);

  const ulogFiltered = useMemo(() => {
    const q = ulogSearch.trim().toLowerCase();
    if (!q) return ulogMetrics;
    return ulogMetrics.filter((m) => m.name.toLowerCase().includes(q));
  }, [ulogMetrics, ulogSearch]);

  // Footer stats for the current selection (counts only — rows materialize
  // at import time so checkbox toggles stay cheap on multi-million-point logs).
  const ulogStats = useMemo(() => {
    if (!ulog) return { points: 0, start: 0, end: 0 };
    let points = 0;
    let start = Infinity;
    let end = -Infinity;
    for (const name of ulogSelected) {
      const m = ulog.metrics.get(name);
      if (!m || m.points.length === 0) continue;
      points += m.count;
      const first = m.points[0][0];
      const last = m.points[m.points.length - 1][0];
      if (first < start) start = first;
      if (last > end) end = last;
    }
    return {
      points,
      start: start === Infinity ? 0 : start,
      end: end === -Infinity ? 0 : end,
    };
  }, [ulog, ulogSelected]);

  const toggleUlogMetric = (name: string, checked: boolean) => {
    setUlogSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(name);
      else next.delete(name);
      return next;
    });
  };

  const canImport = ulog
    ? ulogStats.points > 0 && (!saveRun || runName.trim() !== "")
    : !!parsed && parsed.rows.length > 0 && (!saveRun || runName.trim() !== "");

  /** Rows to POST, chronological — from the ULog selection or the CSV parse. */
  const buildImportRows = (): ParsedRow[] => {
    if (ulog) {
      const rows: ParsedRow[] = [];
      for (const name of ulogSelected) {
        const m = ulog.metrics.get(name);
        if (!m) continue;
        for (const [timestamp, value] of m.points) {
          rows.push({ metric: name, value, timestamp, source_id: sourceSlug });
        }
      }
      rows.sort((a, b) => a.timestamp - b.timestamp);
      return rows;
    }
    return parsed?.rows ?? [];
  };

  const handleImport = async () => {
    const rows = buildImportRows();
    if (rows.length === 0) return;
    setImporting(true);
    try {
      const batches: ParsedRow[][] = [];
      for (let i = 0; i < rows.length; i += API_BATCH_SIZE) {
        batches.push(rows.slice(i, i + API_BATCH_SIZE));
      }
      for (let i = 0; i < batches.length; i++) {
        setProgress({ i: i + 1, n: batches.length });
        const res = await fetch("/api/import/telemetry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source_id: sourceSlug,
            points: batches[i].map((p) => ({
              metric: p.metric,
              value: p.value,
              timestamp: p.timestamp,
            })),
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            message?: string;
          } | null;
          throw new Error(body?.message || "Import failed");
        }
      }
      toast.success(`Imported ${rows.length.toLocaleString()} points`);
      if (saveRun && runName.trim()) {
        try {
          await createRun({
            name: runName.trim(),
            source_id: sourceSlug,
            status: "completed",
            started_at: new Date(rows[0].timestamp).toISOString(),
            ended_at: new Date(rows[rows.length - 1].timestamp).toISOString(),
          });
        } catch {
          // createRun already toasts its own failure; the points landed.
        }
      }
      handleOpenChangeAfterImport();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
      setProgress(null);
    }
  };

  // Close + reset after a successful import (importing flag still true in
  // handleOpenChange's guard, so bypass it here).
  const handleOpenChangeAfterImport = () => {
    resetFile();
    setSaveRun(true);
    setRunName("");
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="flex flex-col gap-0 overflow-y-auto p-0">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle className="font-mono text-sm">Import data</SheetTitle>
          <SheetDescription>
            Upload a CSV or PX4 ULog (.ulg) of historical telemetry. Files are
            parsed locally and rows keep their original timestamps.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 px-6 py-5">
          {!csvText && !ulog ? (
            <FileUpload
              accept=".csv,.ulg,text/csv"
              maxFiles={1}
              maxSize={ULOG_MAX_FILE_MB}
              onUpload={handleFiles}
            />
          ) : (
            <>
              {/* Selected file */}
              <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
                <FileSpreadsheet className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  {fileName}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-muted-foreground"
                  aria-label="Remove file"
                  onClick={resetFile}
                  disabled={importing}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>

              {/* ULog topic/field picker */}
              {ulog && (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      {ulog.meta.anchor === "gps"
                        ? "Timestamps from GPS"
                        : ulog.meta.anchor === "utc_ref"
                          ? "Timestamps from UTC reference"
                          : "Timestamps approximate — anchored to file date"}
                      {ulog.meta.startMs > 0 && (
                        <>
                          {" "}
                          · {formatTs(ulog.meta.startMs)} →{" "}
                          {formatTs(ulog.meta.endMs)}
                        </>
                      )}
                    </p>
                    {(ulog.meta.partial ||
                      ulog.meta.truncated ||
                      ulog.meta.dropouts > 0 ||
                      ulog.meta.droppedPreEpoch > 0 ||
                      ulog.meta.unreadableMessages > 0) && (
                      <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        {[
                          ulog.meta.partial && "file partially parsed",
                          ulog.meta.truncated &&
                            "point cap reached — log truncated",
                          ulog.meta.dropouts > 0 &&
                            `${ulog.meta.dropouts.toLocaleString()} dropouts`,
                          ulog.meta.droppedPreEpoch > 0 &&
                            `${ulog.meta.droppedPreEpoch.toLocaleString()} pre-2002 points dropped`,
                          ulog.meta.unreadableMessages > 0 &&
                            `${ulog.meta.unreadableMessages.toLocaleString()} unreadable messages skipped`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                  </div>

                  <Input
                    value={ulogSearch}
                    onChange={(e) => setUlogSearch(e.target.value)}
                    placeholder="Filter metrics…"
                    className="h-7 text-xs"
                    disabled={importing}
                  />

                  <div className="max-h-72 divide-y divide-border/60 overflow-y-auto rounded-md border border-border">
                    {ulogFiltered.map((m) => (
                      <label
                        key={m.name}
                        className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-muted/40"
                      >
                        <Checkbox
                          checked={ulogSelected.has(m.name)}
                          onCheckedChange={(v) =>
                            toggleUlogMetric(m.name, v === true)
                          }
                          disabled={importing}
                        />
                        <span className="min-w-0 flex-1 truncate font-mono text-xs">
                          {m.name}
                        </span>
                        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                          {m.count.toLocaleString()} · {formatVal(m.min)}→
                          {formatVal(m.max)}
                        </span>
                      </label>
                    ))}
                    {ulogFiltered.length === 0 && (
                      <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                        No metrics match
                      </p>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {ulogSelected.size} selected ·{" "}
                    {ulogStats.points.toLocaleString()} points
                    {ulogStats.points > 0 && (
                      <>
                        {" "}
                        · {formatTs(ulogStats.start)} →{" "}
                        {formatTs(ulogStats.end)}
                      </>
                    )}
                  </p>
                </div>
              )}

              {/* Column mapping (CSV) */}
              {!ulog && (
                <div className="space-y-3">
                  <Field label="Timestamp column">
                    <Select value={tsCol} onValueChange={setTsCol}>
                      <SelectTrigger size="sm" className="h-7 w-full text-xs">
                        <SelectValue placeholder="Select a column" />
                      </SelectTrigger>
                      <SelectContent>
                        {columns.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field label="Metric column">
                    <Select value={metricCol} onValueChange={setMetricCol}>
                      <SelectTrigger size="sm" className="h-7 w-full text-xs">
                        <SelectValue placeholder="Select a column" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={WIDE}>
                          <span className="text-muted-foreground">
                            Wide — one metric per column
                          </span>
                        </SelectItem>
                        {columns
                          .filter((c) => c !== tsCol)
                          .map((c) => (
                            <SelectItem key={c} value={c}>
                              {c}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  {metricCol !== WIDE && (
                    <Field label="Value column">
                      <Select value={valueCol} onValueChange={setValueCol}>
                        <SelectTrigger size="sm" className="h-7 w-full text-xs">
                          <SelectValue placeholder="Select a column" />
                        </SelectTrigger>
                        <SelectContent>
                          {columns
                            .filter((c) => c !== tsCol && c !== metricCol)
                            .map((c) => (
                              <SelectItem key={c} value={c}>
                                {c}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  )}
                </div>
              )}

              {/* Preview (CSV) */}
              {parsed && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    {parsed.rows.length.toLocaleString()} points ·{" "}
                    {parsed.metricCount}{" "}
                    {parsed.metricCount === 1 ? "metric" : "metrics"}
                    {parsed.rows.length > 0 && (
                      <>
                        {" "}
                        · {formatTs(parsed.start)} → {formatTs(parsed.end)}
                      </>
                    )}
                  </p>
                  {parsed.errorCount > 0 && (
                    <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
                      <AlertTriangle className="h-3 w-3" />
                      {parsed.errorCount.toLocaleString()}{" "}
                      {parsed.errorCount === 1 ? "row" : "rows"} skipped
                    </p>
                  )}
                  {parsed.rows.length > 0 && (
                    <div className="overflow-x-auto rounded-md border border-border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="h-8 font-mono text-xs">
                              metric
                            </TableHead>
                            <TableHead className="h-8 font-mono text-xs">
                              value
                            </TableHead>
                            <TableHead className="h-8 font-mono text-xs">
                              timestamp
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {parsed.rows.slice(0, 5).map((row, i) => (
                            <TableRow key={i}>
                              <TableCell className="py-1.5 font-mono text-xs">
                                {row.metric}
                              </TableCell>
                              <TableCell className="py-1.5 font-mono text-xs">
                                {row.value}
                              </TableCell>
                              <TableCell className="py-1.5 font-mono text-xs">
                                {formatTs(row.timestamp)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              )}

              {/* Save as run */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="import-save-run"
                    checked={saveRun}
                    onCheckedChange={(v) => setSaveRun(v === true)}
                    disabled={importing}
                  />
                  <Label
                    htmlFor="import-save-run"
                    className="text-xs text-muted-foreground"
                  >
                    Save imported range as a run
                  </Label>
                </div>
                {saveRun && (
                  <Input
                    value={runName}
                    onChange={(e) => setRunName(e.target.value)}
                    placeholder="Run name"
                    maxLength={200}
                    disabled={importing}
                  />
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-6 py-4">
          <span className="text-xs text-muted-foreground">
            {progress ? `Importing… batch ${progress.i}/${progress.n}` : ""}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleOpenChange(false)}
              disabled={importing}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleImport}
              loading={importing}
              disabled={!canImport}
            >
              Import
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
