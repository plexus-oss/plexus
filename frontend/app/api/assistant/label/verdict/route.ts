/**
 * POST /api/assistant/label/verdict — record the user's decision on a
 * model-proposed label (applied → became an annotation, or dismissed).
 * Same auth as the label route; logs server-side and returns 204.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { withDualAuth } from "@/lib/api/with-auth";
import { validateBody } from "@/lib/api/validate";

const VerdictSchema = z.object({
  label: z.string().min(1).max(200),
  start_ms: z.number().int(),
  end_ms: z.number().int().nullable(),
  applied: z.boolean(),
});

export const POST = withDualAuth(async (request, { orgId, userId }) => {
  const body = await validateBody(request, VerdictSchema);

  // Same reasoning as the label route: system_events' strict platform
  // event-type unions and ai_usage's token-counter shape don't fit, so log
  // verdicts as structured server output.
  console.log(
    "[assistant-label] verdict",
    JSON.stringify({
      orgId,
      userId: userId ?? null,
      label: body.label,
      window: { start: body.start_ms, end: body.end_ms },
      applied: body.applied,
    }),
  );

  return new NextResponse(null, { status: 204 });
});
