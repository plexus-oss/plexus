/**
 * Prompt construction + response validation for local-model labeling.
 *
 * Pure functions (no server imports) so they're unit-testable: summarize the
 * visible window's series into a compact plain-text context, define the JSON
 * schema the model must answer with, and clamp/validate what comes back.
 * The model proposes; nothing here mutates anything.
 */

export interface SeriesPoint {
  /** ISO timestamp */
  timestamp: string;
  value: number;
  min?: number;
  max?: number;
}

export interface SeriesBucket {
  /** Bucket start, epoch ms */
  t: number;
  avg: number;
  min: number;
  max: number;
}

export interface SeriesSummary {
  key: string;
  count: number;
  min: number;
  max: number;
  mean: number;
  firstMs: number;
  lastMs: number;
  buckets: SeriesBucket[];
}

export interface WindowAnnotation {
  label: string;
  startMs: number;
  endMs: number | null;
}

/**
 * One user-maintained context item for a plotted source, newest-first as
 * returned by sourceContextQueries.findBySource. `content` carries the text
 * body for note items; file/link items pass null and contribute only their
 * name + description lines.
 */
export interface SourceContextItem {
  /** Source slug the item belongs to. */
  slug: string;
  name: string;
  description: string | null;
  content: string | null;
}

export interface RememberProposal {
  content: string;
}

export interface LabelObservation {
  start_ms: number;
  end_ms: number | null;
  label: string;
  note: string;
  confidence: "low" | "medium" | "high";
}

export const MAX_OBSERVATIONS = 5;
export const MAX_LABEL_LENGTH = 60;
export const MAX_NOTE_LENGTH = 200;
export const MAX_REMEMBER = 2;
export const MAX_REMEMBER_LENGTH = 200;
/** Budget for the rendered source-context section of the prompt. */
export const MAX_CONTEXT_CHARS = 1500;
const MAX_BUCKETS = 40;

/** JSON schema for Ollama structured outputs (`format`). */
export const LABEL_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    observations: {
      type: "array",
      maxItems: MAX_OBSERVATIONS,
      items: {
        type: "object",
        properties: {
          start_ms: { type: "integer" },
          end_ms: { type: ["integer", "null"] },
          label: { type: "string", maxLength: MAX_LABEL_LENGTH },
          note: { type: "string", maxLength: MAX_NOTE_LENGTH },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
        },
        required: ["start_ms", "end_ms", "label", "note", "confidence"],
      },
    },
    remember: {
      type: "array",
      maxItems: MAX_REMEMBER,
      description:
        "Durable facts about the subject worth saving for future analysis, " +
        "ONLY if strongly supported by the visible data (e.g. a recurring " +
        "baseline), never speculation.",
      items: {
        type: "object",
        properties: {
          content: { type: "string", maxLength: MAX_REMEMBER_LENGTH },
        },
        required: ["content"],
      },
    },
  },
  required: ["observations"],
};

export const LABEL_SYSTEM_PROMPT = [
  "You are a telemetry analyst. You label only what you can SEE in the",
  "numeric summaries you are given: peaks, drops, plateaus, gaps in data,",
  "oscillations, and correlations between series.",
  "Rules:",
  "- Do not invent domain facts, causes, or events not visible in the data.",
  "- Do not give medical or operational advice.",
  "- Every observation's note must name the series key(s) it refers to.",
  "- All times are epoch milliseconds (UTC); answer start_ms/end_ms in the",
  "  same coordinates, inside the given window. Use end_ms: null for a",
  "  single instant.",
  "- Skip anything already covered by an existing annotation.",
  "- Return at most 5 observations; fewer, high-signal observations are",
  "  better than many weak ones. Return an empty list if nothing stands out.",
  "- Use the provided source context to make observations specific (e.g.",
  "  age-adjusted, goal-aware), but never invent context facts not present.",
  "- Optionally return up to 2 remember items: durable facts about the",
  "  subject worth saving for future analysis, ONLY if strongly supported by",
  "  the visible data (e.g. a recurring baseline), never speculation. Omit",
  "  them entirely when nothing qualifies.",
].join("\n");

const round = (v: number): number =>
  Number.isFinite(v) ? Number(v.toPrecision(5)) : 0;

/**
 * Summarize one series' points into stats + a ≤40-bucket downsample over the
 * window. Returns null for an empty series.
 */
export function summarizeSeries(
  key: string,
  points: SeriesPoint[],
  windowStartMs: number,
  windowEndMs: number,
): SeriesSummary | null {
  const parsed = points
    .map((p) => ({ ...p, ms: new Date(p.timestamp).getTime() }))
    .filter((p) => Number.isFinite(p.ms) && Number.isFinite(p.value));
  if (parsed.length === 0) return null;

  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let firstMs = Infinity;
  let lastMs = -Infinity;
  for (const p of parsed) {
    min = Math.min(min, p.min ?? p.value);
    max = Math.max(max, p.max ?? p.value);
    sum += p.value;
    firstMs = Math.min(firstMs, p.ms);
    lastMs = Math.max(lastMs, p.ms);
  }

  const span = Math.max(1, windowEndMs - windowStartMs);
  const bucketCount = Math.min(MAX_BUCKETS, Math.max(1, parsed.length));
  const bucketMs = span / bucketCount;
  const acc = new Map<number, { sum: number; n: number; min: number; max: number }>();
  for (const p of parsed) {
    const idx = Math.min(
      bucketCount - 1,
      Math.max(0, Math.floor((p.ms - windowStartMs) / bucketMs)),
    );
    const b = acc.get(idx) || { sum: 0, n: 0, min: Infinity, max: -Infinity };
    b.sum += p.value;
    b.n += 1;
    b.min = Math.min(b.min, p.min ?? p.value);
    b.max = Math.max(b.max, p.max ?? p.value);
    acc.set(idx, b);
  }
  const buckets: SeriesBucket[] = [...acc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([idx, b]) => ({
      t: Math.round(windowStartMs + idx * bucketMs),
      avg: round(b.sum / b.n),
      min: round(b.min),
      max: round(b.max),
    }));

  return {
    key,
    count: parsed.length,
    min: round(min),
    max: round(max),
    mean: round(sum / parsed.length),
    firstMs,
    lastMs,
    buckets,
  };
}

/**
 * Render the user-maintained context section: one line per item, newest first,
 * capped at MAX_CONTEXT_CHARS of item text. When over budget the oldest items
 * are dropped (the newest-first prefix is kept) and the cut is noted; a single
 * oversized newest item is sliced rather than dropped.
 */
function renderContextLines(items: SourceContextItem[]): string[] {
  const lines: string[] = [
    "Context about these sources (user-maintained — treat as ground truth about the subject):",
  ];
  let used = 0;
  let truncated = false;
  for (const item of items) {
    const body = (item.content ?? item.description ?? "").trim();
    const line = `- [${item.slug}] ${item.name}${body ? `: ${body}` : ""}`
      .replace(/\s+/g, " ")
      .trim();
    if (used + line.length > MAX_CONTEXT_CHARS) {
      if (used === 0) {
        lines.push(`${line.slice(0, MAX_CONTEXT_CHARS - 1)}…`);
        used = MAX_CONTEXT_CHARS;
      }
      truncated = true;
      break;
    }
    lines.push(line);
    used += line.length;
  }
  if (truncated) lines.push("(older context truncated to fit)");
  return lines;
}

/**
 * Compact plain-text context for the model: window bounds, per-series stats +
 * downsample, user-maintained source context, and existing annotations. Stays
 * well under ~4k tokens.
 */
export function buildLabelPrompt(input: {
  windowStartMs: number;
  windowEndMs: number;
  series: SeriesSummary[];
  annotations: WindowAnnotation[];
  /** User-maintained source context, newest-first (see SourceContextItem). */
  context?: SourceContextItem[];
}): string {
  const lines: string[] = [
    `Window: ${input.windowStartMs} to ${input.windowEndMs} (epoch ms, UTC).`,
    `Series in view: ${input.series.length}.`,
  ];

  for (const s of input.series) {
    lines.push(
      "",
      `Series "${s.key}": ${s.count} points, min=${s.min}, max=${s.max}, mean=${s.mean}, first=${s.firstMs}, last=${s.lastMs}.`,
      "Buckets (t avg min max):",
      ...s.buckets.map((b) => `${b.t} ${b.avg} ${b.min} ${b.max}`),
    );
  }

  if (input.context && input.context.length > 0) {
    lines.push("", ...renderContextLines(input.context));
  }

  lines.push("");
  if (input.annotations.length === 0) {
    lines.push("Existing annotations in window: none.");
  } else {
    lines.push("Existing annotations in window (do not duplicate):");
    for (const a of input.annotations) {
      lines.push(
        `- "${a.label}" from ${a.startMs}${a.endMs != null ? ` to ${a.endMs}` : " (point)"}`,
      );
    }
  }
  lines.push(
    "",
    "Label the notable features you can see in these numbers.",
  );
  return lines.join("\n");
}

/**
 * Validate + clamp the model's reply. Times are clamped into the requested
 * window; observations with unparseable fields are dropped; label/note are
 * truncated; at most MAX_OBSERVATIONS survive. Ranges that collapse to a
 * single instant after clamping become point observations (end_ms: null).
 */
export function clampObservations(
  raw: unknown,
  windowStartMs: number,
  windowEndMs: number,
): LabelObservation[] {
  const list = (raw as { observations?: unknown[] } | null)?.observations;
  if (!Array.isArray(list)) return [];

  const clamp = (ms: number): number =>
    Math.min(windowEndMs, Math.max(windowStartMs, Math.round(ms)));

  const out: LabelObservation[] = [];
  for (const item of list) {
    if (out.length >= MAX_OBSERVATIONS) break;
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;

    if (typeof o.start_ms !== "number" || !Number.isFinite(o.start_ms)) continue;
    if (typeof o.label !== "string" || o.label.trim().length === 0) continue;
    if (typeof o.note !== "string") continue;
    if (o.confidence !== "low" && o.confidence !== "medium" && o.confidence !== "high")
      continue;
    const endOk =
      o.end_ms === null ||
      o.end_ms === undefined ||
      (typeof o.end_ms === "number" && Number.isFinite(o.end_ms));
    if (!endOk) continue;

    const start_ms = clamp(o.start_ms);
    let end_ms: number | null =
      typeof o.end_ms === "number" ? clamp(o.end_ms) : null;
    if (end_ms !== null && end_ms <= start_ms) end_ms = null;

    out.push({
      start_ms,
      end_ms,
      label: o.label.trim().slice(0, MAX_LABEL_LENGTH),
      note: o.note.trim().slice(0, MAX_NOTE_LENGTH),
      confidence: o.confidence,
    });
  }
  return out;
}

/**
 * Validate + clamp the model's optional remember proposals: strings only,
 * trimmed, truncated to MAX_REMEMBER_LENGTH, at most MAX_REMEMBER survive.
 */
export function clampRemember(raw: unknown): RememberProposal[] {
  const list = (raw as { remember?: unknown[] } | null)?.remember;
  if (!Array.isArray(list)) return [];

  const out: RememberProposal[] = [];
  for (const item of list) {
    if (out.length >= MAX_REMEMBER) break;
    if (typeof item !== "object" || item === null) continue;
    const content = (item as Record<string, unknown>).content;
    if (typeof content !== "string" || content.trim().length === 0) continue;
    out.push({ content: content.trim().slice(0, MAX_REMEMBER_LENGTH) });
  }
  return out;
}
