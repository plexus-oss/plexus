/**
 * Model-run persistence — one row per inference call of the labeling model
 * (POST /api/assistant/label) and one row per Terminal assistant turn
 * (POST /api/assistant/terminal). The row is the full audit record:
 * retrieval (context_items), output (observations), performance
 * (provider/model/latency/tokens), and the human verdicts patched into the
 * observations jsonb afterwards (the reinforcement signal). Read by
 * /api/intelligence.
 */
import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../client";
import { aiLabelRuns } from "../schema";

/** One proposal inside a run, verdict-tracked in place. */
export interface LabelRunObservation {
  label: string;
  note: string | null;
  start_ms: number | null;
  end_ms: number | null;
  confidence: "low" | "medium" | "high" | null;
  kind: "label" | "remember";
  verdict: "applied" | "dismissed" | null;
  verdict_at: string | null;
}

/** One context item that was actually included in the prompt. */
export interface LabelRunContextItem {
  id: string;
  slug: string;
  name: string;
  chars: number;
}

export interface AiLabelRun {
  id: string;
  org_id: string;
  user_id: string | null;
  created_at: string;
  provider: string | null;
  model: string | null;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  metrics: string[];
  window_start: string | null;
  window_end: string | null;
  context_items: LabelRunContextItem[];
  observations: LabelRunObservation[];
}

const cols = {
  id: aiLabelRuns.id,
  org_id: aiLabelRuns.org_id,
  user_id: aiLabelRuns.user_id,
  created_at: aiLabelRuns.created_at,
  provider: aiLabelRuns.provider,
  model: aiLabelRuns.model,
  latency_ms: aiLabelRuns.latency_ms,
  input_tokens: aiLabelRuns.input_tokens,
  output_tokens: aiLabelRuns.output_tokens,
  metrics: aiLabelRuns.metrics,
  window_start: aiLabelRuns.window_start,
  window_end: aiLabelRuns.window_end,
  context_items: aiLabelRuns.context_items,
  observations: aiLabelRuns.observations,
};

export const aiLabelRunQueries = {
  insert: async (data: {
    org_id: string;
    user_id?: string | null;
    provider: string;
    model: string;
    latency_ms: number;
    input_tokens?: number | null;
    output_tokens?: number | null;
    metrics: string[];
    window_start: string | null;
    window_end: string | null;
    context_items: LabelRunContextItem[];
    observations: LabelRunObservation[];
  }): Promise<AiLabelRun> => {
    const [row] = await db.insert(aiLabelRuns).values(data).returning(cols);
    return row as AiLabelRun;
  },

  /**
   * Append one observation to a run's observations array — a targeted jsonb
   * concat, so verdicts already stamped on earlier observations are never
   * clobbered. Returns the appended observation's index (array length − 1),
   * or null when the run doesn't exist in this org.
   */
  appendObservation: async (
    orgId: string,
    runId: string,
    observation: LabelRunObservation,
  ): Promise<number | null> => {
    const rows = await db
      .update(aiLabelRuns)
      .set({
        observations: sql`${aiLabelRuns.observations} || ${JSON.stringify(observation)}::jsonb`,
      })
      .where(and(eq(aiLabelRuns.org_id, orgId), eq(aiLabelRuns.id, runId)))
      .returning({
        count: sql<number>`jsonb_array_length(${aiLabelRuns.observations})`,
      });
    return rows.length > 0 ? Number(rows[0].count) - 1 : null;
  },

  /**
   * Finalize a run's turn-level fields (latency/tokens/metrics/window) once
   * the assistant turn completes. Deliberately does NOT touch observations —
   * those are appended per proposal and may already carry verdicts.
   */
  finalize: async (
    orgId: string,
    runId: string,
    data: {
      latency_ms: number;
      input_tokens: number | null;
      output_tokens: number | null;
      metrics: string[];
      window_start: string | null;
      window_end: string | null;
    },
  ): Promise<void> => {
    await db
      .update(aiLabelRuns)
      .set(data)
      .where(and(eq(aiLabelRuns.org_id, orgId), eq(aiLabelRuns.id, runId)));
  },

  /** Most recent runs for an org, newest first. */
  findRecent: async (orgId: string, limit = 50): Promise<AiLabelRun[]> => {
    return (await db
      .select(cols)
      .from(aiLabelRuns)
      .where(eq(aiLabelRuns.org_id, orgId))
      .orderBy(desc(aiLabelRuns.created_at))
      .limit(limit)) as AiLabelRun[];
  },

  /**
   * Record the human's decision on one observation of a run — a targeted
   * jsonb_set on the observations array (no read-modify-write race). Returns
   * false when the run doesn't exist in this org or the index is out of
   * bounds.
   */
  setVerdict: async (
    orgId: string,
    runId: string,
    observationIndex: number,
    verdict: "applied" | "dismissed",
  ): Promise<boolean> => {
    const idx = String(observationIndex);
    const rows = await db
      .update(aiLabelRuns)
      .set({
        observations: sql`jsonb_set(
          jsonb_set(${aiLabelRuns.observations}, ARRAY[${idx}, 'verdict'], to_jsonb(${verdict}::text)),
          ARRAY[${idx}, 'verdict_at'], to_jsonb(now())
        )`,
      })
      .where(
        and(
          eq(aiLabelRuns.org_id, orgId),
          eq(aiLabelRuns.id, runId),
          sql`jsonb_array_length(${aiLabelRuns.observations}) > ${observationIndex}`,
        ),
      )
      .returning({ id: aiLabelRuns.id });
    return rows.length > 0;
  },
};
