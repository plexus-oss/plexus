/**
 * GET /api/internal/sources/recording
 *
 * Bootstrap endpoint for the ch-loader's in-memory RecordingStore.
 *
 * The loader calls this once at startup to build its set of (org_id, source_slug)
 * pairs that have recording enabled. Runtime updates happen via push
 * (POST /recording on the loader side, called by pushToService).
 *
 * Auth: server-to-server only via x-internal-secret header.
 * Security: reads across tenant boundaries — uses service-role client.
 *
 * Response shape matches the loader's bootstrap_recording_store parser:
 * { "sources": [{ "org_id": "...", "source_id": "<slug>" }, ...] }
 */

import { NextRequest, NextResponse } from "next/server";
import { adminSourceQueries } from "@/lib/db/server";
import { verifyInternalAuth } from "@/lib/internal/auth";

export async function GET(request: NextRequest) {
  const authError = verifyInternalAuth(request, "sources/recording");
  if (authError) return authError;

  try {
    const rows = await adminSourceQueries.findAllRecording();
    return NextResponse.json({
      sources: rows.map((r) => ({ org_id: r.org_id, source_id: r.slug })),
    });
  } catch (error) {
    console.error("[sources/recording] bootstrap query failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
