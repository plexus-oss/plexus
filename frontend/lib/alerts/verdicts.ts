/**
 * Verdict tally — shared by the user- and admin-scoped query layers so both
 * count operator verdicts identically. See alertQueries.getVerdictStats.
 */

import type { VerdictStats } from "@/lib/db/types";

// Recency window for verdict rollups: the latest VERDICT_SAMPLE verdicted alerts
// within the last VERDICT_WINDOW_DAYS. Keeps a rule's reputation current (a rule
// you tuned stops looking noisy) and bounds the query.
export const VERDICT_WINDOW_DAYS = 90;
export const VERDICT_SAMPLE = 100;

/** Tally a recency-windowed sample of `{ current_verdict }` rows. */
export function tallyVerdicts(
  rows: Array<{ current_verdict?: string | null }> | null,
): VerdictStats {
  const stats: VerdictStats = { helpful: 0, noise: 0, total: 0 };
  for (const row of rows ?? []) {
    if (row.current_verdict === "helpful") stats.helpful++;
    else if (row.current_verdict === "noise") stats.noise++;
  }
  stats.total = stats.helpful + stats.noise;
  return stats;
}
