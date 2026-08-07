/**
 * Fuzzy-match SVG labels to telemetry metric names.
 *
 * Engineering schematics often use tag prefixes (PT-101, FT-203, TT-99)
 * that don't naïvely match metric names like `pressure_transducer_101`.
 * We expand the alias map before fuzzy matching to boost recall.
 */

import Fuse from "fuse.js";
import type {
  AnchorRef,
  TelemetryBinding,
} from "@/lib/types/dashboard";
import type { ExtractedLabel } from "./extract-labels";

/**
 * Industrial Society of Automation tag-letter conventions. Expanded as
 * synonyms during fuzzy matching so a label like "PT-101" matches a
 * metric called "pressure_main".
 */
const ALIAS_MAP: Record<string, string[]> = {
  PT: ["pressure", "press"],
  FT: ["flow"],
  TT: ["temperature", "temp"],
  LT: ["level"],
  VT: ["valve", "voltage"],
  IT: ["current", "amperage"],
  WT: ["weight", "mass"],
  ST: ["speed", "rpm"],
  PI: ["pressure"],
  TI: ["temperature"],
  FI: ["flow"],
  LI: ["level"],
  HV: ["high voltage", "hv"],
  OCP: ["overcurrent protect", "ocp"],
  OVP: ["overvoltage protect", "ovp"],
};

export interface SuggestedBinding {
  /** The original SVG label text. */
  label: string;
  /** The metric we matched (full "sourceId:metricName" key). */
  metric: string;
  /** Fuse score 0..1, lower = better. */
  confidence: number;
  /** AnchorRef we'd attach the binding to. */
  anchor: AnchorRef;
}

interface MatchOptions {
  /** Maximum fuse score to accept (default 0.45). */
  threshold?: number;
}

/**
 * Score each extracted label against the candidate metric list and return
 * suggested bindings. Same label is never matched twice — once consumed,
 * the metric is removed from the candidate pool.
 */
export function matchLabelsToMetrics(
  labels: ExtractedLabel[],
  candidateMetrics: string[],
  options: MatchOptions = {},
): SuggestedBinding[] {
  const threshold = options.threshold ?? 0.45;

  // Build searchable index where each metric carries its own canonical
  // "haystack" string (sourceId stripped, underscores/dashes → spaces).
  const haystack = candidateMetrics.map((metric) => ({
    metric,
    text: normalize(stripSourceId(metric)),
  }));

  const fuse = new Fuse(haystack, {
    keys: ["text"],
    threshold,
    includeScore: true,
    ignoreLocation: true,
    minMatchCharLength: 2,
  });

  const used = new Set<string>();
  const suggestions: SuggestedBinding[] = [];

  for (const label of labels) {
    const needle = expandAliases(normalize(label.text));
    const results = fuse.search(needle);
    const top = results.find((r) => !used.has(r.item.metric));
    if (!top) continue;

    used.add(top.item.metric);
    suggestions.push({
      label: label.text,
      metric: top.item.metric,
      confidence: top.score ?? 1,
      anchor: bestAnchorFor(label),
    });
  }

  return suggestions;
}

/**
 * Pick the best anchor available: an id on the text element itself
 * (rare but ideal) > nearest ancestor with an id (common for grouped
 * P&IDs) > the raw point.
 */
function bestAnchorFor(label: ExtractedLabel): AnchorRef {
  if (label.id) return { kind: "svg-id", id: label.id };
  if (label.ancestorId) return { kind: "svg-id", id: label.ancestorId };
  return { kind: "svg-point", x: label.x, y: label.y };
}

function stripSourceId(metric: string): string {
  const idx = metric.indexOf(":");
  return idx === -1 ? metric : metric.slice(idx + 1);
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * If the label starts with a known instrument-tag prefix (PT, FT, …),
 * append the alias keywords so fuzzy search has more material to match.
 */
function expandAliases(normalized: string): string {
  // Pull a leading 2-3 char prefix that maps to an alias entry.
  for (const prefix of Object.keys(ALIAS_MAP)) {
    const re = new RegExp(`^${prefix.toLowerCase()}\\b`);
    if (re.test(normalized)) {
      const synonyms = ALIAS_MAP[prefix].join(" ");
      return `${normalized} ${synonyms}`;
    }
  }
  return normalized;
}

/**
 * Convert a SuggestedBinding (accepted by the user) into a real
 * TelemetryBinding ready to be persisted in panel config.
 */
export function suggestionToBinding(
  suggestion: SuggestedBinding,
): TelemetryBinding {
  return {
    id: crypto.randomUUID(),
    anchor: suggestion.anchor,
    metric: suggestion.metric,
    display: "value",
    label: suggestion.label,
  };
}
