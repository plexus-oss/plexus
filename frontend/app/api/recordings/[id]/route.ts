/**
 * GET    /api/recordings/[id]  — poll recording status + playback URL
 * DELETE /api/recordings/[id]  — request early stop
 */

import { NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/lib/api/with-auth";
import { apiError, errorResponse } from "@/lib/api/errors";
import { loadAllowedSourceIds } from "@/lib/access/sources";
import { recordingQueries } from "@/lib/db/queries/recordings";

/** Scoped members can only touch recordings of allow-listed sources. */
async function assertInScope(
  orgId: string,
  userId: string,
  recording: { source_id: string | null },
): Promise<void> {
  const allowed = await loadAllowedSourceIds(orgId, userId);
  if (allowed && (!recording.source_id || !allowed.has(recording.source_id))) {
    throw apiError("NOT_FOUND", "Recording not found");
  }
}

export const GET = withAuth(async (_req, { orgId, userId, params }) => {
  try {
    const { id } = await params;
    const recording = await recordingQueries.findById(orgId, id);
    if (!recording) throw apiError("NOT_FOUND", "Recording not found");
    await assertInScope(orgId, userId, recording);
    return NextResponse.json({ recording });
  } catch (err) {
    return errorResponse(err);
  }
});

export const DELETE = withAuth(async (_req, { orgId, userId, orgRole, params }) => {
  try {
    await requirePermission({ orgId, orgRole, userId }, "action-start-recording");
    const { id } = await params;
    const recording = await recordingQueries.findById(orgId, id);
    if (!recording) throw apiError("NOT_FOUND", "Recording not found");
    await assertInScope(orgId, userId, recording);

    // Already in a terminal or stopping state — idempotent.
    if (!["requested", "recording"].includes(recording.status)) {
      return NextResponse.json({ ok: true });
    }

    await recordingQueries.stopRequested(orgId, id);

    // Push stop signal to recorder. On failure we log only — the recording
    // will self-terminate when expires_at passes.
    const recorderUrl = process.env.RECORDER_SERVICE_URL;
    if (recorderUrl) {
      try {
        const stopRes = await fetch(`${recorderUrl}/stop`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(5_000),
          body: JSON.stringify({ recording_id: id }),
        });
        if (!stopRes.ok) {
          console.warn("[recordings/stop] recorder returned", stopRes.status, "for session", id);
        }
      } catch (err) {
        console.error("[recordings/stop] push failed:", err);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
});
