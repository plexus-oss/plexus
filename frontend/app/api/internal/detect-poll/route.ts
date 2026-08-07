/**
 * GET|POST /api/internal/detect-poll — manual poll-detection scan trigger.
 *
 * Production detection runs in-process via the poll loop (started at boot
 * from instrumentation.ts → lib/scheduler/poll-loop.ts), the same pattern as
 * the offline loop — NOT an external cron. This route stays as a
 * manual/testing trigger that runs one scan immediately. Duplicate alerts are
 * still bounded by the persisted per-monitor watermark and the shared 5-min
 * dedup window.
 *
 * Auth: x-internal-secret (PLEXUS_INTERNAL_SECRET).
 */

import { NextRequest, NextResponse } from "next/server";
import { detectPollOnce } from "@/lib/alerts/detect-poll";

export const runtime = "nodejs";
export const maxDuration = 60;

const INTERNAL_SECRET = process.env.PLEXUS_INTERNAL_SECRET;

function authorized(request: NextRequest): boolean {
  return (
    !!INTERNAL_SECRET &&
    request.headers.get("x-internal-secret") === INTERNAL_SECRET
  );
}

async function handler(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await detectPollOnce();
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "scan failed" }, { status: 500 });
  }
}

export const GET = handler;
export const POST = handler;
