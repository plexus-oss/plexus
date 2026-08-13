/**
 * POST /api/assistant/label/verdict — record the user's decision on a
 * model proposal: a label (applied → became an annotation) or a remember
 * memory (applied → became a source-context note), or dismissed.
 * Same auth as the label route; logs server-side and returns 204.
 *
 * When the client sends run_id + observation_index (threaded through from the
 * label response), the verdict is also persisted onto that observation in
 * ai_label_runs — the reinforcement signal the /intelligence page reads.
 * Older clients that omit them still get the log-only behavior.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { withDualAuth } from "@/lib/api/with-auth";
import { validateBody } from "@/lib/api/validate";
import { aiLabelRunQueries } from "@/lib/db";

const VerdictSchema = z.object({
  /** What was judged: a chart label (default, for older clients) or a
   * remember-memory proposal. */
  kind: z.enum(["label", "remember"]).default("label"),
  /** The proposal text — the label for labels, the content for memories. */
  label: z.string().min(1).max(200),
  /** Window coordinates; only label verdicts carry them. */
  start_ms: z.number().int().nullable().optional(),
  end_ms: z.number().int().nullable().optional(),
  applied: z.boolean(),
  /** The ai_label_runs row this proposal came from (newer clients). */
  run_id: z.string().uuid().optional(),
  /** Index into the run's observations array (labels first, then remember). */
  observation_index: z.number().int().min(0).optional(),
});

export const POST = withDualAuth(async (request, { orgId, userId }) => {
  const body = await validateBody(request, VerdictSchema);

  // Persist the verdict onto the run's observation when the client told us
  // which one. Org-scoped update; a missing run or stale index is a no-op.
  if (body.run_id !== undefined && body.observation_index !== undefined) {
    await aiLabelRunQueries.setVerdict(
      orgId,
      body.run_id,
      body.observation_index,
      body.applied ? "applied" : "dismissed",
    );
  }

  // Same reasoning as the label route: system_events' strict platform
  // event-type unions and ai_usage's token-counter shape don't fit, so log
  // verdicts as structured server output.
  console.log(
    "[assistant-label] verdict",
    JSON.stringify({
      orgId,
      userId: userId ?? null,
      kind: body.kind,
      label: body.label,
      window: { start: body.start_ms ?? null, end: body.end_ms ?? null },
      applied: body.applied,
    }),
  );

  return new NextResponse(null, { status: 204 });
});
