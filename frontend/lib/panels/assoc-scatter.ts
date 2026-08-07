/**
 * Association-scatter helpers — pure logic shared by the renderer and the
 * config section.
 *
 * The panel is a TIME-axis scatter: one point per row at (time, yColumn), with
 * the value in categoryColumn selecting a glyph (color + shape) via a legend.
 * X being real time (not a discrete index) lets it inherit the app's shared
 * chart interactions — dashboard time-range filtering, cmd/ctrl+scroll zoom,
 * drag-pan, and the synced crosshair. Scout's "Satellite Measurement
 * Association Verification" is the canonical use: y = satellite id lane,
 * category = verification verdict.
 */

import type { AssocCategory, GlyphShape } from "@/lib/types/dashboard";

export interface AssocRow {
  /** X position as epoch milliseconds (the row's timestamp). */
  x: number;
  /** Y lane key (categorical). */
  y: string;
  /** Category value as it appears in the data. */
  category: string;
}

/** A palette + shape rotation for categories we can't map to a known verdict. */
const FALLBACK_COLORS = [
  "#16a34a", // green
  "#dc2626", // red
  "#2563eb", // blue
  "#d97706", // amber
  "#9333ea", // violet
  "#0891b2", // cyan
];
const FALLBACK_SHAPES: GlyphShape[] = ["circle", "diamond", "square", "triangle"];

/**
 * Scout's canonical verdict styling — matches the matplotlib reference chart:
 * green = correct, red = incorrect, black = wrong-measurement; filled circle =
 * "association", open diamond = "no association". Matched by fuzzy keyword so
 * minor naming differences (`correct_assoc`, `correctAssociation`) still land.
 */
const KNOWN_VERDICTS: Array<{
  test: (norm: string) => boolean;
  style: Omit<AssocCategory, "value">;
}> = [
  {
    test: (n) => n.includes("wrong") && n.includes("meas"),
    style: {
      label: "Incorrect Association (Wrong Measurement)",
      color: "#111827",
      shape: "circle",
      filled: true,
    },
  },
  {
    test: (n) => n.includes("incorrect") && n.includes("no") && n.includes("assoc"),
    style: {
      label: "Incorrect No Association",
      color: "#dc2626",
      shape: "diamond",
      filled: false,
    },
  },
  {
    test: (n) => n.includes("incorrect") && n.includes("assoc"),
    style: {
      label: "Incorrect Association",
      color: "#dc2626",
      shape: "circle",
      filled: true,
    },
  },
  {
    test: (n) => n.includes("correct") && n.includes("no") && n.includes("assoc"),
    style: {
      label: "Correct No Association",
      color: "#16a34a",
      shape: "diamond",
      filled: false,
    },
  },
  {
    test: (n) => n.includes("correct") && n.includes("assoc"),
    style: {
      label: "Correct Association",
      color: "#16a34a",
      shape: "circle",
      filled: true,
    },
  },
];

function prettifyLabel(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Build a default category style for a raw value (known verdict, else palette). */
export function defaultCategoryStyle(
  value: string,
  index: number,
): AssocCategory {
  const norm = value.toLowerCase();
  for (const v of KNOWN_VERDICTS) {
    if (v.test(norm)) return { value, ...v.style };
  }
  return {
    value,
    label: prettifyLabel(value),
    color: FALLBACK_COLORS[index % FALLBACK_COLORS.length],
    shape: FALLBACK_SHAPES[Math.floor(index / FALLBACK_COLORS.length) % FALLBACK_SHAPES.length],
    filled: true,
  };
}

/**
 * Merge a saved legend (`config.assocCategories`) with the categories actually
 * present in the data, so new verdict values appear automatically and removed
 * ones drop off. Saved styles win; order follows the saved legend, then any
 * newly-seen values.
 */
export function resolveCategories(
  saved: AssocCategory[] | undefined,
  present: string[],
): AssocCategory[] {
  const byValue = new Map<string, AssocCategory>();
  (saved ?? []).forEach((c) => byValue.set(c.value, c));
  const out: AssocCategory[] = [];
  const seen = new Set<string>();
  // Saved first (preserve user ordering), but only if still present — unless
  // there's no data at all (design mode), where we keep the saved legend.
  const presentSet = new Set(present);
  for (const c of saved ?? []) {
    if (present.length === 0 || presentSet.has(c.value)) {
      out.push(c);
      seen.add(c.value);
    }
  }
  let idx = out.length;
  for (const value of present) {
    if (seen.has(value)) continue;
    out.push(byValue.get(value) ?? defaultCategoryStyle(value, idx++));
    seen.add(value);
  }
  return out;
}

/** Pick sensible default columns from a SQL result's column names/types. */
export function autoDetectColumns(
  columns: Array<{ name: string; type: string }>,
): { timeColumn?: string; yColumn?: string; categoryColumn?: string } {
  const names = columns.map((c) => c.name);
  const find = (re: RegExp) => names.find((n) => re.test(n.toLowerCase()));
  const isTimeType = (name: string) => {
    const col = columns.find((c) => c.name === name);
    return col ? /time|date|timestamp/i.test(col.type) : false;
  };
  const timeColumn =
    names.find((n) => isTimeType(n)) ??
    find(/time|epoch|date|_at$|^ts$|observed|collected/);
  const categoryColumn =
    find(/status|verif|assoc|result|verdict|maneuver|flag|class|categor|outcome/) ??
    names[names.length - 1];
  const yColumn =
    find(/sat|norad|object|target|track|orbit|^id$|_id$/) ??
    names.find((n) => n !== timeColumn && n !== categoryColumn) ??
    names[0];
  return { timeColumn, yColumn, categoryColumn };
}

/** Parse a SQL time value (ISO string, Date, or epoch number) → epoch ms. */
export function toEpochMs(v: unknown): number {
  if (v == null) return NaN;
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v; // seconds vs ms
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : NaN;
}

/** Map raw SQL rows → time-based plot points using the chosen column bindings. */
export function rowsToPoints(
  rows: Array<Record<string, unknown>>,
  cols: { timeColumn?: string; yColumn?: string; categoryColumn?: string },
): AssocRow[] {
  const { timeColumn, yColumn, categoryColumn } = cols;
  if (!timeColumn || !yColumn || !categoryColumn) return [];
  const points: AssocRow[] = [];
  for (const row of rows) {
    const x = toEpochMs(row[timeColumn]);
    const yVal = row[yColumn];
    if (!Number.isFinite(x) || yVal == null) continue;
    const cat = row[categoryColumn];
    points.push({
      x,
      y: String(yVal),
      category: cat == null ? "" : String(cat),
    });
  }
  return points;
}

// ── Sample data (design mode) ──────────────────────────────────────────────
// Mirrors Scout's reference chart so the panel looks complete in the gallery
// and while a dashboard is built before real algorithm data is flowing. The
// renderer spreads these across the visible time domain (see buildSamplePoints).

export const SAMPLE_CATEGORIES: AssocCategory[] = [
  { value: "correct_association", label: "Correct Association", color: "#16a34a", shape: "circle", filled: true },
  { value: "correct_no_association", label: "Correct No Association", color: "#16a34a", shape: "diamond", filled: false },
  { value: "incorrect_association", label: "Incorrect Association", color: "#dc2626", shape: "circle", filled: true },
  { value: "incorrect_no_association", label: "Incorrect No Association", color: "#dc2626", shape: "diamond", filled: false },
  { value: "incorrect_association_wrong_measurement", label: "Incorrect Association (Wrong Measurement)", color: "#111827", shape: "circle", filled: true },
];

// (lane, category) pairs; the renderer assigns timestamps across the domain.
const SAMPLE_GRID: Array<[string, string]> = [
  ["45026", "correct_association"],
  ["23124", "correct_no_association"],
];

/** Build sample points spread evenly across [start, end] (epoch ms). */
export function buildSamplePoints(start: number, end: number): AssocRow[] {
  const N = 6;
  const span = end - start || 1;
  const out: AssocRow[] = [];
  for (const [y, category] of SAMPLE_GRID) {
    for (let i = 0; i < N; i++) {
      out.push({ x: start + ((i + 0.5) / N) * span, y, category });
    }
  }
  return out;
}
