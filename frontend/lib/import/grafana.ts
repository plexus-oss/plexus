/**
 * Grafana dashboard → Plexus dashboard converter.
 *
 * Pure and total: `convertGrafanaDashboard(json)` accepts ANY input (a bare
 * Grafana dashboard, a grafana.com download, a `GET /api/dashboards/uid/…`
 * response, or complete garbage) and never throws. Malformed shapes degrade
 * into report entries/warnings — every panel encountered is accounted for in
 * the `ImportReport` as either mapped or skipped-with-reason.
 *
 * Grid math: Grafana and Plexus both use a 24-column grid, so x/w carry over
 * 1:1. Grafana rows are 30px, Plexus rows are 40px (dashboard-grid.tsx), so
 * heights/offsets scale by 0.75; the dashboard grid's vertical compaction
 * absorbs any rounding gaps.
 *
 * Query targets are NOT assumed to exist in Plexus. Each panel's targets are
 * reduced to best-effort "extracted metric names" (PromQL metric, InfluxQL
 * measurement.field, SQL column, Graphite dot path). The caller binds those
 * names to real org sources/metrics via `applyBindings` — a two-phase flow:
 * dry-run (report + names) → bind → create.
 *
 * Verified against real SatNOGS dashboards (dashboard.satnogs.org):
 * schemaVersion 26 (graph/singlestat era) through 41 (timeseries/stat era).
 */

import type {
  DashboardConfig,
  Panel,
  PanelConfig,
  PanelLayout,
  TimeRange,
} from "@/lib/types/dashboard";
import {
  DEFAULT_PANEL_CONFIG,
  DEFAULT_TIME_RANGE,
} from "@/lib/types/dashboard";
import { DASHBOARD_COLORS } from "@/lib/dashboards/colors";

// =============================================================================
// Public types
// =============================================================================

/** One binding chosen by the user: extracted name → a real org metric. */
export interface MetricBinding {
  /** Source slug or id the metric lives on. */
  sourceRef: string;
  /** The Plexus metric name on that source. */
  metric: string;
}

export interface PanelReportEntry {
  /** Grafana panel id when present, else a synthetic ordinal. */
  sourcePanelId: string;
  /** Panel title ("(untitled)" when blank). */
  title: string;
  /** The Grafana panel type string as found. */
  grafanaType: string;
  outcome: "mapped" | "skipped";
  /** Plexus panel type when mapped. */
  plexusType?: string;
  /** Plexus panel id (matches `panels[].id`) when mapped. */
  panelId?: string;
  /** Why the panel was skipped. */
  reason?: string;
  /** Lossy-mapping notes (dropped thresholds, unknown units, …). */
  notes: string[];
  /** Extracted metric names feeding this panel (unbound identities). */
  metrics: string[];
}

export interface ImportReport {
  schemaVersion: number | null;
  /** Every panel encountered, including rows and nested/collapsed panels. */
  totalPanels: number;
  mapped: number;
  skipped: number;
  panels: PanelReportEntry[];
  /** Distinct extracted metric names across the whole dashboard. */
  metrics: string[];
  /** Dashboard-level warnings (tolerated malformed shapes, caps, …). */
  warnings: string[];
}

export interface GrafanaConversion {
  title: string;
  panels: Panel[];
  timeRange: TimeRange;
  report: ImportReport;
}

// =============================================================================
// Tunables
// =============================================================================

/** Panels beyond this become skipped-with-reason (dashboard stays sane). */
export const MAX_IMPORT_PANELS = 100;
/** Row-nesting depth cap — Grafana only nests one level; garbage may not. */
const MAX_ROW_DEPTH = 4;
/** Grafana 30px rows → Plexus 40px rows. */
const H_SCALE = 30 / 40;

const PALETTE = DASHBOARD_COLORS;

// =============================================================================
// Safe accessors — the "never throws" foundation
// =============================================================================

type Dict = Record<string, unknown>;

function isDict(v: unknown): v is Dict {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asFiniteNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

// =============================================================================
// Unit mapping — Grafana unit ids → Plexus display units
// =============================================================================

/**
 * Grafana's internal unit ids → the free-form display strings Plexus panels
 * render. Only confidently-translatable ids are mapped; anything else is
 * dropped with a per-panel note (a wrong unit is worse than none).
 */
const GRAFANA_UNIT_MAP: Record<string, string> = {
  percent: "%",
  percentunit: "%",
  volt: "V",
  amp: "A",
  watt: "W",
  watth: "Wh",
  celsius: "°C",
  fahrenheit: "°F",
  kelvin: "K",
  s: "s",
  seconds: "s",
  ms: "ms",
  µs: "µs",
  ns: "ns",
  bytes: "B",
  decbytes: "B",
  deckbytes: "KB",
  decmbytes: "MB",
  decgbytes: "GB",
  dB: "dB",
  dBm: "dBm",
  hertz: "Hz",
  rotrpm: "RPM",
  velocityms: "m/s",
  velocitykmh: "km/h",
  pressurehpa: "hPa",
  pressurebar: "bar",
  pressurepsi: "psi",
  lengthm: "m",
  lengthkm: "km",
};

/** Unit ids that intentionally carry no display unit — dropped silently. */
const UNITLESS_UNITS = new Set(["short", "none", "locale", "string"]);

function mapUnit(unit: string | undefined): {
  unit?: string;
  note?: string;
} {
  if (!unit) return {};
  if (GRAFANA_UNIT_MAP[unit]) return { unit: GRAFANA_UNIT_MAP[unit] };
  if (UNITLESS_UNITS.has(unit) || unit.startsWith("dateTime")) return {};
  return { note: `Grafana unit "${unit}" has no Plexus equivalent — dropped` };
}

// =============================================================================
// Metric extraction — per-datasource best effort
// =============================================================================

/** PromQL functions/keywords that are never the metric identifier. */
const PROMQL_NON_METRICS = new Set([
  "abs", "absent", "absent_over_time", "avg", "avg_over_time", "bool", "bottomk",
  "by", "ceil", "changes", "clamp", "clamp_max", "clamp_min", "count",
  "count_over_time", "count_values", "day_of_month", "day_of_week", "delta",
  "deriv", "exp", "floor", "group", "group_left", "group_right",
  "histogram_quantile", "holt_winters", "hour", "idelta", "ignoring",
  "increase", "irate", "label_join", "label_replace", "last_over_time", "ln",
  "log2", "log10", "max", "max_over_time", "min", "min_over_time", "minute",
  "month", "offset", "on", "or", "and", "unless", "predict_linear", "quantile",
  "quantile_over_time", "rate", "resets", "round", "scalar", "sort",
  "sort_desc", "sqrt", "stddev", "stddev_over_time", "stdvar",
  "stdvar_over_time", "sum", "sum_over_time", "time", "timestamp", "topk",
  "vector", "year", "without",
]);

function extractPromMetric(expr: string): string | undefined {
  for (const m of expr.matchAll(/[a-zA-Z_:][a-zA-Z0-9_:]*/g)) {
    const token = m[0];
    if (PROMQL_NON_METRICS.has(token)) continue;
    // Skip label names used as `name=`/`name=~` inside selectors.
    const after = expr.slice(m.index + token.length);
    if (/^\s*(=~?|!~|!=)/.test(after)) continue;
    return token;
  }
  return undefined;
}

/** A usable literal name: no Grafana variables, no regex wrappers. */
function cleanLiteral(name: string | undefined): string | undefined {
  if (!name) return undefined;
  let v = name.trim();
  // Strip InfluxQL regex wrappers like /^value$/.
  const rx = v.match(/^\/\^?(.*?)\$?\/$/);
  if (rx) v = rx[1];
  v = v.replace(/^"|"$/g, "");
  if (!v || v.includes("$") || v.includes("{")) return undefined; // variable
  if (!/^[\w.:*/-]+$/.test(v)) return undefined;
  return v;
}

/** InfluxQL structured target: select[[{type:"field",params:["name"]},…]]. */
function extractInfluxFields(target: Dict): string[] {
  const out: string[] = [];
  const measurement = cleanLiteral(asString(target.measurement));
  for (const sel of asArray(target.select)) {
    for (const part of asArray(sel)) {
      if (!isDict(part) || part.type !== "field") continue;
      const field = cleanLiteral(asString(asArray(part.params)[0]));
      if (!field) continue;
      out.push(measurement ? `${measurement}.${field}` : field);
      break; // one field per select column
    }
  }
  return out;
}

/** SQL-ish text (InfluxQL raw or SQL rawSql): best-effort column names. */
function extractSqlColumns(sql: string): string[] {
  const out: string[] = [];
  const selectMatch = sql.match(/select\s+([\s\S]*?)\s+from\b/i);
  const selectList = selectMatch ? selectMatch[1] : sql;
  // Aggregate-wrapped columns: last("pid"), mean(value), …
  for (const m of selectList.matchAll(
    /\b(?:last|mean|avg|max|min|sum|count|first|median|distinct|percentile)\s*\(\s*"?([A-Za-z_][\w.-]*)"?/gi,
  )) {
    const name = cleanLiteral(m[1]);
    if (name && !/^(time|timestamp)$/i.test(name)) out.push(name);
  }
  if (out.length > 0) return out;
  // Fall back to the first plain identifier in the select list that isn't a
  // time macro / keyword.
  for (const m of selectList.matchAll(/"([A-Za-z_][\w.-]*)"|\b([A-Za-z_][\w.-]*)\b/g)) {
    const name = cleanLiteral(m[1] ?? m[2]);
    if (!name) continue;
    if (/^(as|time|timestamp|now|interval|select|distinct|value)$/i.test(name)) continue;
    if (name.startsWith("__")) continue;
    out.push(name);
    break;
  }
  return out;
}

/** Graphite target: the longest dot path, functions stripped. */
function extractGraphitePath(target: string): string | undefined {
  let best: string | undefined;
  for (const m of target.matchAll(/[A-Za-z0-9_*-]+(?:\.[A-Za-z0-9_*{},-]+)+/g)) {
    // The char class admits commas for {a,b} globs — trim stray trailing ones
    // picked up from function argument lists like aliasByNode(path, 2).
    const candidate = m[0].replace(/[,.]+$/, "");
    if (!best || candidate.length > best.length) best = candidate;
  }
  return best && !best.includes("$") ? best : undefined;
}

/** Flux query: r._measurement == "x" / r._field == "y" → x.y. */
function extractFluxMetric(query: string): string | undefined {
  const meas = query.match(/_measurement\s*==\s*"([^"$]+)"/)?.[1];
  const field = query.match(/_field\s*==\s*"([^"$]+)"/)?.[1];
  if (meas && field) return `${meas}.${field}`;
  return field ?? meas ?? undefined;
}

/**
 * Reduce one Grafana target to zero or more extracted metric names.
 * The datasource type is inferred from the target's shape (expr → PromQL,
 * rawSql → SQL, select/measurement → InfluxQL, target → Graphite, |> → Flux)
 * — old-schema dashboards name datasources with free-form strings, so shape
 * is the only reliable signal.
 */
function extractTargetMetrics(target: unknown): string[] {
  if (!isDict(target)) return [];
  if (target.hide === true) return [];

  const expr = asString(target.expr);
  const rawSql = asString(target.rawSql);
  const query = asString(target.query);
  const graphiteTarget = asString(target.target);

  // PromQL (expr is Prometheus-only regardless of declared datasource)
  if (expr) {
    const name = extractPromMetric(expr);
    return name ? [name] : [];
  }
  // SQL datasources
  if (rawSql) return extractSqlColumns(rawSql);
  // InfluxDB: raw query wins over the structured builder when enabled
  if (target.rawQuery === true && query) {
    if (query.includes("|>")) {
      const name = extractFluxMetric(query);
      return name ? [name] : [];
    }
    return extractSqlColumns(query);
  }
  if (Array.isArray(target.select)) return extractInfluxFields(target);
  // Graphite
  if (graphiteTarget) {
    const name = extractGraphitePath(graphiteTarget);
    return name ? [name] : [];
  }
  // Generic query string (Flux, unknown datasources)
  if (query) {
    if (query.includes("|>")) {
      const name = extractFluxMetric(query);
      return name ? [name] : [];
    }
    if (/\bselect\b/i.test(query)) return extractSqlColumns(query);
    const name = extractPromMetric(query);
    return name ? [name] : [];
  }
  return [];
}

function extractPanelMetrics(panel: Dict): string[] {
  const out: string[] = [];
  for (const target of asArray(panel.targets)) {
    for (const name of extractTargetMetrics(target)) {
      if (!out.includes(name)) out.push(name);
    }
  }
  return out;
}

// =============================================================================
// Panel type mapping
// =============================================================================

interface TypeMapping {
  type: string;
  notes: string[];
}

/** Grafana types that map 1:1 without inspection. */
const DIRECT_TYPE_MAP: Record<string, string> = {
  stat: "stat",
  singlestat: "stat",
  table: "datagrid",
  "table-old": "datagrid",
  heatmap: "heatmap",
  text: "text",
  logs: "list",
  alertlist: "alerts",
  piechart: "bar",
  barchart: "bar",
};

const DIRECT_TYPE_NOTES: Record<string, string> = {
  singlestat: "legacy singlestat imported as a stat tile",
  piechart: "pie chart imported as a bar chart (no pie panel in Plexus)",
  barchart: "category bar chart imported as a bar chart",
  logs: "logs panel imported as a Logs list panel",
  alertlist: "Grafana alert list imported as the Plexus alerts feed",
};

function mapTimeseriesType(panel: Dict): TypeMapping {
  const notes: string[] = [];
  const fieldConfig = isDict(panel.fieldConfig) ? panel.fieldConfig : {};
  const defaults = isDict(fieldConfig.defaults) ? fieldConfig.defaults : {};
  const custom = isDict(defaults.custom) ? defaults.custom : {};
  const drawStyle = asString(custom.drawStyle);
  if (drawStyle === "bars") return { type: "bar", notes };
  if (drawStyle === "points") return { type: "scatter", notes };
  const fillOpacity = asFiniteNumber(custom.fillOpacity) ?? 0;
  return { type: fillOpacity >= 30 ? "area" : "line", notes };
}

function mapLegacyGraphType(panel: Dict): TypeMapping {
  const notes: string[] = ["legacy graph panel imported"];
  if (panel.bars === true) return { type: "bar", notes };
  if (panel.points === true && panel.lines !== true)
    return { type: "scatter", notes };
  const fill = asFiniteNumber(panel.fill) ?? 0;
  return { type: fill >= 5 ? "area" : "line", notes };
}

/**
 * Map a (non-row) Grafana panel type to a Plexus panel type, or return a
 * skip reason. Unknown types with extractable data degrade to a line chart —
 * the data survives even when the visualization doesn't.
 */
function mapPanelType(
  grafanaType: string,
  panel: Dict,
  hasMetrics: boolean,
): { mapping?: TypeMapping; skipReason?: string } {
  if (grafanaType === "timeseries") return { mapping: mapTimeseriesType(panel) };
  if (grafanaType === "graph") return { mapping: mapLegacyGraphType(panel) };
  if (grafanaType === "gauge" || grafanaType === "bargauge") {
    return {
      mapping: {
        type: "stat",
        notes: [
          `${grafanaType} imported as a stat tile (Plexus has no gauge panel)`,
        ],
      },
    };
  }
  const direct = DIRECT_TYPE_MAP[grafanaType];
  if (direct) {
    const note = DIRECT_TYPE_NOTES[grafanaType];
    return { mapping: { type: direct, notes: note ? [note] : [] } };
  }
  // Unknown/plugin panel: keep the data as a line chart when there is any.
  if (hasMetrics) {
    return {
      mapping: {
        type: "line",
        notes: [
          `unknown panel type "${grafanaType}" — imported as a line chart`,
        ],
      },
    };
  }
  return {
    skipReason: `unsupported panel type "${grafanaType}" with no importable query`,
  };
}

// =============================================================================
// Field config → Plexus panel config
// =============================================================================

interface FieldDefaults {
  unit?: string;
  decimals?: number;
  thresholdValues: number[];
  notes: string[];
}

function readFieldDefaults(panel: Dict): FieldDefaults {
  const notes: string[] = [];
  const fieldConfig = isDict(panel.fieldConfig) ? panel.fieldConfig : {};
  const defaults = isDict(fieldConfig.defaults) ? fieldConfig.defaults : {};

  // Legacy singlestat/graph keep unit at panel.format / yaxes[0].format.
  const yaxes = asArray(panel.yaxes);
  const legacyUnit =
    asString(panel.format) ??
    (isDict(yaxes[0]) ? asString(yaxes[0].format) : undefined);

  const { unit, note } = mapUnit(asString(defaults.unit) ?? legacyUnit);
  if (note) notes.push(note);

  const decimals =
    asFiniteNumber(defaults.decimals) ?? asFiniteNumber(panel.decimals);

  const thresholdValues: number[] = [];
  const thresholds = isDict(defaults.thresholds) ? defaults.thresholds : {};
  for (const step of asArray(thresholds.steps)) {
    if (!isDict(step)) continue;
    const v = asFiniteNumber(step.value);
    if (v !== undefined) thresholdValues.push(v);
  }
  if (thresholdValues.length > 0) {
    notes.push(
      `Grafana thresholds (${thresholdValues.join(", ")}) are not imported — recreate as Plexus alert rules if needed`,
    );
  }

  return {
    unit,
    decimals: decimals !== undefined ? clamp(Math.round(decimals), 0, 6) : undefined,
    thresholdValues,
    notes,
  };
}

// =============================================================================
// Grid position
// =============================================================================

function convertGridPos(panel: Dict, yOffset: number, notes: string[]): PanelLayout {
  const gp = isDict(panel.gridPos) ? panel.gridPos : undefined;
  if (!gp) notes.push("missing gridPos — placed by grid compaction");
  const rawW = gp ? asFiniteNumber(gp.w) : undefined;
  const rawH = gp ? asFiniteNumber(gp.h) : undefined;
  const rawX = gp ? asFiniteNumber(gp.x) : undefined;
  const rawY = gp ? asFiniteNumber(gp.y) : undefined;

  const w = clamp(Math.round(rawW ?? 12), 2, 24);
  const x = clamp(Math.round(rawX ?? 0), 0, 24 - w);
  const h = clamp(Math.round((rawH ?? 6) * H_SCALE), 2, 60);
  const y = clamp(Math.round(((rawY ?? 0) + yOffset) * H_SCALE), 0, 10_000);
  return { x, y, w, h, minW: 2, minH: 2 };
}

// =============================================================================
// The converter
// =============================================================================

/** Result shape of `GET /api/dashboards/uid/…` and grafana.com downloads. */
function unwrapDashboard(input: unknown): Dict | undefined {
  if (!isDict(input)) return undefined;
  if (isDict(input.dashboard)) return input.dashboard;
  return input;
}

function mapTimeRange(dashboard: Dict): TimeRange {
  const time = isDict(dashboard.time) ? dashboard.time : {};
  const from = asString(time.from);
  const m = from?.match(/^now-(\d+[smhd])$/);
  if (m) return { type: "relative", value: m[1] };
  return DEFAULT_TIME_RANGE;
}

interface FlatPanel {
  raw: Dict;
  grafanaType: string;
  /** Extra y offset (collapsed-row children keep row-relative coords). */
  yOffset: number;
}

/** Depth-first flatten: rows contribute a header entry + their children. */
function flattenPanels(
  rawPanels: unknown[],
  warnings: string[],
): FlatPanel[] {
  const out: FlatPanel[] = [];
  const visit = (panels: unknown[], depth: number, yOffset: number) => {
    for (const p of panels) {
      if (!isDict(p)) {
        warnings.push("non-object entry in panels[] ignored");
        continue;
      }
      const type = asString(p.type) ?? "(untyped)";
      out.push({ raw: p, grafanaType: type, yOffset });
      if (type === "row") {
        const children = asArray(p.panels);
        if (children.length > 0) {
          if (depth + 1 > MAX_ROW_DEPTH) {
            warnings.push(
              `row nesting deeper than ${MAX_ROW_DEPTH} levels — deeper panels ignored`,
            );
            continue;
          }
          const gp = isDict(p.gridPos) ? p.gridPos : {};
          const rowY = asFiniteNumber(gp.y) ?? 0;
          // Collapsed children keep coordinates relative to the row's era —
          // offsetting below the row keeps ordering; compaction closes gaps.
          visit(children, depth + 1, yOffset + rowY + 1);
        }
      }
    }
  };
  visit(rawPanels, 0, 0);
  return out;
}

function panelTitle(raw: Dict): string {
  const t = asString(raw.title)?.trim();
  return t && t.length > 0 ? t : "";
}

function buildPanelConfig(
  plexusType: string,
  raw: Dict,
  fieldDefaults: FieldDefaults,
  seriesCount: number,
): PanelConfig {
  const config: PanelConfig = {
    ...DEFAULT_PANEL_CONFIG,
    colors: Array.from(
      { length: Math.max(1, seriesCount) },
      (_, i) => PALETTE[i % PALETTE.length],
    ),
    showLegend: seriesCount > 1,
  };
  if (fieldDefaults.unit) config.unit = fieldDefaults.unit;
  if (fieldDefaults.decimals !== undefined)
    config.decimals = fieldDefaults.decimals;

  if (plexusType === "stat") {
    config.aggregation = "last";
    config.showLegend = false;
  }
  if (plexusType === "line" || plexusType === "area") {
    config.smoothLines = true;
  }
  if (plexusType === "area") {
    // Grafana stacking carries over when declared.
    const custom = isDict(raw.fieldConfig)
      ? isDict((raw.fieldConfig as Dict).defaults)
        ? ((raw.fieldConfig as Dict).defaults as Dict)
        : {}
      : {};
    const stacking = isDict(custom.custom)
      ? (custom.custom as Dict).stacking
      : undefined;
    if (isDict(stacking) && asString(stacking.mode) === "normal") {
      config.stacked = true;
    }
  }
  if (plexusType === "text") {
    const options = isDict(raw.options) ? raw.options : {};
    const content =
      asString(options.content) ?? asString(raw.content) ?? "";
    config.content = content;
  }
  return config;
}

/**
 * Convert any input claiming to be a Grafana dashboard. Never throws.
 */
export function convertGrafanaDashboard(input: unknown): GrafanaConversion {
  const warnings: string[] = [];
  const entries: PanelReportEntry[] = [];
  const panels: Panel[] = [];
  const allMetrics: string[] = [];

  const dashboard = unwrapDashboard(input);
  const title =
    (dashboard && asString(dashboard.title)?.trim()) ||
    "Imported Grafana dashboard";

  if (!dashboard) {
    warnings.push(
      "input is not a Grafana dashboard object — nothing to import",
    );
    return {
      title,
      panels,
      timeRange: DEFAULT_TIME_RANGE,
      report: {
        schemaVersion: null,
        totalPanels: 0,
        mapped: 0,
        skipped: 0,
        panels: entries,
        metrics: allMetrics,
        warnings,
      },
    };
  }

  const schemaVersion = asFiniteNumber(dashboard.schemaVersion) ?? null;
  if (schemaVersion !== null && schemaVersion < 14) {
    warnings.push(
      `schemaVersion ${schemaVersion} predates the supported range (~14+) — importing best-effort`,
    );
  }

  if (dashboard.panels !== undefined && !Array.isArray(dashboard.panels)) {
    warnings.push("dashboard.panels is not an array — no panels to import");
  }
  // Pre-gridPos dashboards (rows[] of panels) — flatten those rows too.
  const rawPanels =
    asArray(dashboard.panels).length > 0
      ? asArray(dashboard.panels)
      : asArray(dashboard.rows).flatMap((r) =>
          isDict(r) ? [{ type: "row", title: asString(r.title), panels: asArray(r.panels) }] : [],
        );

  const templating = isDict(dashboard.templating)
    ? asArray(dashboard.templating.list)
    : [];
  if (templating.length > 0) {
    warnings.push(
      `${templating.length} Grafana template variable(s) not imported — queries referencing them were resolved best-effort`,
    );
  }

  const flat = flattenPanels(rawPanels, warnings);
  let ordinal = 0;

  for (const { raw, grafanaType, yOffset } of flat) {
    ordinal += 1;
    const sourcePanelId = String(
      asFiniteNumber(raw.id) ?? asString(raw.id) ?? `#${ordinal}`,
    );
    const entry: PanelReportEntry = {
      sourcePanelId,
      title: panelTitle(raw) || "(untitled)",
      grafanaType,
      outcome: "skipped",
      notes: [],
      metrics: [],
    };
    entries.push(entry);

    // Belt-and-braces: a single hostile panel must never sink the import.
    try {
      if (grafanaType === "row") {
        const rowTitle = panelTitle(raw);
        if (!rowTitle) {
          entry.reason = "layout-only row (no title) — section merged into layout";
          continue;
        }
        // Titled rows become full-width section headers.
        const id = `grafana-${panels.length + 1}`;
        const layout = convertGridPos(raw, yOffset, entry.notes);
        panels.push({
          id,
          type: "text",
          title: "",
          metrics: [],
          config: { content: `### ${rowTitle}`, verticalCenter: true },
          layout: { ...layout, w: 24, x: 0, h: 2 },
        });
        entry.outcome = "mapped";
        entry.plexusType = "text";
        entry.panelId = id;
        entry.notes.push("row rendered as a section-header text panel");
        continue;
      }

      if (panels.length >= MAX_IMPORT_PANELS) {
        entry.reason = `beyond the ${MAX_IMPORT_PANELS}-panel import cap`;
        continue;
      }

      const metrics = extractPanelMetrics(raw);
      entry.metrics = metrics;
      for (const m of metrics) {
        if (!allMetrics.includes(m)) allMetrics.push(m);
      }

      const { mapping, skipReason } = mapPanelType(grafanaType, raw, metrics.length > 0);
      if (!mapping) {
        entry.reason = skipReason ?? "unsupported panel";
        continue;
      }

      // Text panels with no content have nothing to show.
      if (mapping.type === "text") {
        const options = isDict(raw.options) ? raw.options : {};
        const content = asString(options.content) ?? asString(raw.content);
        if (!content || content.trim().length === 0) {
          entry.reason = "text panel with no content";
          continue;
        }
      } else if (metrics.length === 0 && mapping.type !== "alerts") {
        // Data panels whose queries yielded no extractable metric identity
        // still import — as clearly-unbound panels the user wires up later.
        entry.notes.push(
          "no metric could be extracted from the panel's queries — imported unbound",
        );
      }

      const fieldDefaults = readFieldDefaults(raw);
      const id = `grafana-${panels.length + 1}`;
      const layout = convertGridPos(raw, yOffset, entry.notes);
      const config = buildPanelConfig(mapping.type, raw, fieldDefaults, metrics.length);

      panels.push({
        id,
        type: mapping.type,
        title: panelTitle(raw),
        // Unbound placeholders: extracted names go in the report; the panel's
        // metrics stay empty until applyBindings resolves them.
        metrics: [],
        sources: [],
        dataSource: { type: "realtime" },
        config,
        layout,
      });

      entry.outcome = "mapped";
      entry.plexusType = mapping.type;
      entry.panelId = id;
      entry.notes.push(...mapping.notes, ...fieldDefaults.notes);
    } catch (err) {
      entry.outcome = "skipped";
      entry.reason = `panel could not be parsed (${err instanceof Error ? err.message : "unknown error"})`;
    }
  }

  const mapped = entries.filter((e) => e.outcome === "mapped").length;
  return {
    title,
    panels,
    timeRange: mapTimeRange(dashboard),
    report: {
      schemaVersion,
      totalPanels: entries.length,
      mapped,
      skipped: entries.length - mapped,
      panels: entries,
      metrics: allMetrics,
      warnings,
    },
  };
}

// =============================================================================
// Binding — extracted names → real org metrics
// =============================================================================

export interface BindingResult {
  panels: Panel[];
  /** Extracted names that had no binding (their panels import unbound). */
  unbound: string[];
}

/**
 * Resolve each converted panel's extracted metric names to real
 * `source:metric` pairs. Pure: returns new panel objects. Names without a
 * binding are left off the panel (it stays an unbound placeholder the user
 * can configure in the panel editor).
 */
export function applyBindings(
  conversion: GrafanaConversion,
  bindings: Record<string, MetricBinding>,
): BindingResult {
  const unbound = conversion.report.metrics.filter((name) => {
    const b = bindings[name];
    return !b || !b.sourceRef || !b.metric;
  });

  const byPanelId = new Map<string, PanelReportEntry>();
  for (const e of conversion.report.panels) {
    if (e.panelId) byPanelId.set(e.panelId, e);
  }

  const panels = conversion.panels.map((panel) => {
    const entry = byPanelId.get(panel.id);
    if (!entry || entry.metrics.length === 0) return panel;
    const metricKeys: string[] = [];
    const sources: string[] = [];
    for (const name of entry.metrics) {
      const b = bindings[name];
      if (!b || !b.sourceRef || !b.metric) continue;
      const key = `${b.sourceRef}:${b.metric}`;
      if (!metricKeys.includes(key)) metricKeys.push(key);
      if (!sources.includes(b.sourceRef)) sources.push(b.sourceRef);
    }
    if (metricKeys.length === 0) return panel;
    return {
      ...panel,
      metrics: metricKeys,
      sources,
      config: {
        ...panel.config,
        colors: metricKeys.map((_, i) => PALETTE[i % PALETTE.length]),
        showLegend:
          panel.type === "stat" ? false : metricKeys.length > 1,
      },
    };
  });

  return { panels, unbound };
}

/**
 * Assemble the final dashboard config from bound panels — same display
 * defaults the quick-start route persists, so imported dashboards behave
 * like house-built ones.
 */
export function buildDashboardConfig(
  conversion: GrafanaConversion,
  panels: Panel[],
): DashboardConfig {
  return {
    panels,
    timeRange: conversion.timeRange,
    refreshInterval: 5000,
    displaySettings: { autoRefresh: 5, syncTooltips: true },
  };
}
