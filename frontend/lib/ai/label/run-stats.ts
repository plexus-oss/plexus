/**
 * Pure aggregation over labeling runs for the /intelligence stat cards.
 * No server imports so it's unit-testable (see __tests__/run-stats.test.ts).
 */

export interface RunStatsRow {
  created_at: string;
  provider: string | null;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  observations: Array<{ verdict: "applied" | "dismissed" | null }>;
}

export interface LabelRunStats {
  /** Runs inside the window. */
  runs: number;
  applied: number;
  dismissed: number;
  /** applied / (applied + dismissed), or null when there are no verdicts. */
  acceptanceRate: number | null;
  /** Median of non-null latencies, or null when none. */
  medianLatencyMs: number | null;
  /** input + output tokens across all runs in the window. */
  tokens: number;
  /** Token split by provider (only providers that appear). */
  tokensByProvider: Record<string, number>;
}

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Median of a non-empty sorted-or-not list. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Aggregate the last 7 days of runs (relative to `nowMs`). */
export function computeLabelRunStats(
  rows: RunStatsRow[],
  nowMs = Date.now(),
): LabelRunStats {
  const cutoff = nowMs - WINDOW_MS;
  const windowRows = rows.filter((r) => {
    const t = new Date(r.created_at).getTime();
    return Number.isFinite(t) && t >= cutoff;
  });

  let applied = 0;
  let dismissed = 0;
  const latencies: number[] = [];
  let tokens = 0;
  const tokensByProvider: Record<string, number> = {};

  for (const row of windowRows) {
    for (const o of row.observations ?? []) {
      if (o.verdict === "applied") applied += 1;
      else if (o.verdict === "dismissed") dismissed += 1;
    }
    if (row.latency_ms != null) latencies.push(row.latency_ms);
    const t = (row.input_tokens ?? 0) + (row.output_tokens ?? 0);
    tokens += t;
    if (t > 0 && row.provider) {
      tokensByProvider[row.provider] = (tokensByProvider[row.provider] ?? 0) + t;
    }
  }

  const judged = applied + dismissed;
  return {
    runs: windowRows.length,
    applied,
    dismissed,
    acceptanceRate: judged > 0 ? applied / judged : null,
    medianLatencyMs: median(latencies),
    tokens,
    tokensByProvider,
  };
}
