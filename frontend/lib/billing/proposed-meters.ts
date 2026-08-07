/**
 * PROPOSAL — not wired into live billing. See BILLING.md.
 *
 * Models "meter the marginal COGS": extend today's ingestion + video meters with
 * RETENTION (priced as a multiplier on ingestion by the customer's chosen window)
 * and AI (Anthropic tokens with a markup). Enterprise (tier_2) stays flat-fee;
 * connection sources are the customer's own store so they're never metered here.
 *
 * Nothing imports this yet. To adopt: (1) instrument the two new inputs
 * (retention_days on org_billing; token usage captured per Anthropic call),
 * (2) add the Stripe meters, (3) have report-usage emit them. The billing
 * plumbing mirrors the existing per-row pipeline — the work is instrumentation.
 */

import {
  PRICE_PER_MILLION_METRICS_USD,
  PRICE_PER_MILLION_LOGS_USD,
  PRICE_PER_VIDEO_HOUR_USD,
} from "./server";

// ── New pricing knobs (env-overridable, mirroring the existing constants) ─────

/**
 * Retention priced as a multiplier on ingestion by the chosen window. Approximates
 * storage COGS (which scales with rows × how long they're held) without a per-org
 * GB-months meter. Keyed by retention days; interpolate/clamp for other values.
 */
export const RETENTION_MULTIPLIER: ReadonlyArray<[days: number, mult: number]> = [
  [90, 1.0], // 90-day: baseline
  [365, 2.0], // 1-year
  [1095, 4.0], // 3-year (today's default raw retention)
];

/** Price per 1M Anthropic tokens billed to the customer (cost × markup). Set per model. */
export const PRICE_PER_MILLION_AI_TOKENS_USD = Number(
  process.env.BILLING_PRICE_PER_MILLION_AI_TOKENS_USD ?? "5.00",
);

export function retentionMultiplier(retentionDays: number): number {
  const table = RETENTION_MULTIPLIER;
  if (retentionDays <= table[0][0]) return table[0][1];
  const last = table[table.length - 1];
  if (retentionDays >= last[0]) return last[1];
  for (let i = 1; i < table.length; i++) {
    const [d0, m0] = table[i - 1];
    const [d1, m1] = table[i];
    if (retentionDays <= d1) {
      const t = (retentionDays - d0) / (d1 - d0);
      return m0 + t * (m1 - m0); // linear interp between the two nearest tiers
    }
  }
  return last[1];
}

// ── Extended usage shape + estimate ───────────────────────────────────────────

export interface CogsUsage {
  /** metric rows ingested this month (owned pipeline only — connections excluded). */
  metrics: number;
  /** log/event rows this month. */
  logs: number;
  /** video hours relayed this month. */
  videoHours: number;
  /** Anthropic tokens consumed this month across Terminal / annotator / suggestions. */
  aiTokens: number;
  /** the org's chosen raw-telemetry retention window (days). */
  retentionDays: number;
}

export interface CogsBreakdown {
  ingestion: number; // metrics + logs, scaled by retention
  video: number;
  ai: number;
  total: number;
  retentionMult: number;
}

/**
 * Proposed monthly charge. Ingestion (metrics+logs) is multiplied by the retention
 * multiplier — the row was cheap to process but expensive to hold for N days. Video
 * and AI are straight pass-through-with-margin. No free allotment (matches current).
 */
export function estimateMonthlyChargeWithCogs(u: CogsUsage): CogsBreakdown {
  const mult = retentionMultiplier(u.retentionDays);
  const metrics = (Math.max(0, u.metrics) / 1_000_000) * PRICE_PER_MILLION_METRICS_USD;
  const logs = (Math.max(0, u.logs) / 1_000_000) * PRICE_PER_MILLION_LOGS_USD;
  const ingestion = (metrics + logs) * mult;
  const video = Math.max(0, u.videoHours) * PRICE_PER_VIDEO_HOUR_USD;
  const ai = (Math.max(0, u.aiTokens) / 1_000_000) * PRICE_PER_MILLION_AI_TOKENS_USD;
  return {
    ingestion,
    video,
    ai,
    total: ingestion + video + ai,
    retentionMult: mult,
  };
}
