/**
 * Per-org Anthropic token accounting — the marginal AI COGS (see BILLING.md).
 *
 * `recordAiTokens` is fire-and-forget: every AI call site (Terminal loop, column
 * annotator, …) reports the tokens it burned; it must never block or throw into
 * the request path. `getAiTokensThisMonth` is the read side for report-usage /
 * the proposed `plexus_ai_tokens` Stripe meter.
 */
import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { aiUsage } from "@/lib/db/schema";

/** UTC calendar day (YYYY-MM-DD) — the granularity report-usage emits on. */
function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}
/** First day of the current UTC month, for month-to-date reads. */
function currentMonthStart(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * Add token usage for an org+model on the current UTC day. Upsert-increment so
 * concurrent calls accumulate. Daily granularity mirrors the metrics/logs/video
 * meters — report-usage emits each completed day's delta and Stripe sums the
 * month. Never awaited by callers — swallows its own errors.
 */
export function recordAiTokens(
  orgId: string | undefined,
  model: string,
  inputTokens: number,
  outputTokens: number,
): void {
  const inTok = Math.max(0, Math.round(inputTokens || 0));
  const outTok = Math.max(0, Math.round(outputTokens || 0));
  if (!orgId || (inTok === 0 && outTok === 0)) return;

  db.insert(aiUsage)
    .values({
      org_id: orgId,
      period_start: utcDay(),
      model,
      input_tokens: inTok,
      output_tokens: outTok,
    })
    .onConflictDoUpdate({
      target: [aiUsage.org_id, aiUsage.period_start, aiUsage.model],
      set: {
        input_tokens: sql`${aiUsage.input_tokens} + ${inTok}`,
        output_tokens: sql`${aiUsage.output_tokens} + ${outTok}`,
      },
    })
    .catch((err) => console.warn("[ai-usage] recordAiTokens failed:", err));
}

/** Anthropic tokens (input + output, all models) for an org on a single UTC day.
 *  This is what report-usage emits to Stripe (yesterday's completed day). */
export async function getAiTokensForDay(
  orgId: string,
  day: Date,
): Promise<number> {
  const rows = await db
    .select({
      total: sql<number>`coalesce(sum(${aiUsage.input_tokens} + ${aiUsage.output_tokens}), 0)`,
    })
    .from(aiUsage)
    .where(
      sql`${aiUsage.org_id} = ${orgId} and ${aiUsage.period_start} = ${utcDay(day)}::date`,
    );
  return Number(rows[0]?.total ?? 0);
}

/** Month-to-date Anthropic tokens for an org (display / burn-rate). */
export async function getAiTokensThisMonth(orgId: string): Promise<number> {
  const rows = await db
    .select({
      total: sql<number>`coalesce(sum(${aiUsage.input_tokens} + ${aiUsage.output_tokens}), 0)`,
    })
    .from(aiUsage)
    .where(
      sql`${aiUsage.org_id} = ${orgId} and ${aiUsage.period_start} >= ${currentMonthStart()}::date`,
    );
  return Number(rows[0]?.total ?? 0);
}
