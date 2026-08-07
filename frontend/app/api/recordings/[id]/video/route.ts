/**
 * GET /api/recordings/[id]/video
 *
 * Auth-gates access, then asks the recorder service to generate a
 * short-lived presigned Tigris URL and redirects the browser to it.
 *
 * Tigris credentials never leave the recorder — the frontend has no
 * direct knowledge of the storage backend.
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/with-auth";
import { loadAllowedSourceIds } from "@/lib/access/sources";
import { recordingQueries } from "@/lib/db/queries/recordings";

export const GET = withAuth(async (_req, { orgId, userId, params }) => {
  const { id } = await params;

  const recording = await recordingQueries.findById(orgId, id);
  if (!recording?.playback_url || recording.status !== "done") {
    return new NextResponse(null, { status: 404 });
  }

  // Scoped members can only play recordings of allow-listed sources.
  const allowed = await loadAllowedSourceIds(orgId, userId);
  if (allowed && (!recording.source_id || !allowed.has(recording.source_id))) {
    return new NextResponse(null, { status: 404 });
  }

  const recorderUrl = process.env.RECORDER_SERVICE_URL;
  if (!recorderUrl) {
    return new NextResponse("Recorder not configured", { status: 503 });
  }

  // Extract the S3 key from the stored Tigris URL
  // playback_url format: https://<bucket>.fly.storage.tigris.dev/<key>
  const key = new URL(recording.playback_url).pathname.slice(1);

  const presignRes = await fetch(`${recorderUrl}/presign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(5_000),
    body: JSON.stringify({ key, expires_in: 3600 }),
  });

  if (!presignRes.ok) {
    console.error("[video] presign failed:", presignRes.status);
    return new NextResponse(null, { status: 502 });
  }

  const { url } = await presignRes.json();
  return NextResponse.redirect(url, { status: 307 });
});
