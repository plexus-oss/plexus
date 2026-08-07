/**
 * Internal: Recorder session status callback
 *
 * PATCH /api/internal/recorder/[id]
 *
 * Called by the recorder service to report status transitions:
 *   { status: "recording" }
 *   { status: "done", playback_url: "https://..." }
 *   { status: "error", error_message: "..." }
 *
 * On terminal states (done/error), cleans up the temporary gateway API key.
 *
 * Authenticated with the shared internal secret (x-internal-secret). The route
 * is in the public route matcher, so this header check is the only gate — and it
 * guards a key-deleting side effect, so it must not be skipped.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { verifyInternalAuth } from "@/lib/internal/auth";
import { db } from "@/lib/db/client";
import { recordings } from "@/lib/db/schema";
import { recordingQueries } from "@/lib/db/queries/recordings";
import { adminApiKeyQueries } from "@/lib/db/server";
import type { RecordingStatus } from "@/lib/db/queries/recordings";

type Params = Promise<{ id: string }>;

const TERMINAL = new Set<RecordingStatus>(["done", "error"]);

export const PATCH = async (req: NextRequest, { params }: { params: Params }) => {
  const authError = verifyInternalAuth(req, "recorder");
  if (authError) return authError;

  try {
    const { id } = await params;
    const body = await req.json();
    const { status, playback_url, error_message } = body;

    const patch: Parameters<typeof recordingQueries.update>[1] = {};
    if (status) patch.status = status;
    if (playback_url) patch.playback_url = playback_url;
    if (error_message) patch.error_message = error_message;
    if (status === "recording") patch.started_at = new Date().toISOString();
    if (status && TERMINAL.has(status)) patch.finished_at = new Date().toISOString();

    await recordingQueries.update(id, patch);

    if (status && TERMINAL.has(status)) {
      await cleanupGatewayKey(id);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[recorder/patch]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
};

async function cleanupGatewayKey(recordingId: string) {
  try {
    const [data] = await db
      .select({ gateway_api_key_id: recordings.gateway_api_key_id })
      .from(recordings)
      .where(eq(recordings.id, recordingId))
      .limit(1);

    if (data?.gateway_api_key_id) {
      await adminApiKeyQueries.deleteById(data.gateway_api_key_id);
    }
  } catch (err) {
    console.error("[recorder/cleanup-key]", err);
  }
}
