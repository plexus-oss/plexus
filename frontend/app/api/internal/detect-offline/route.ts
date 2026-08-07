/**
 * GET|POST /api/internal/detect-offline — manual "stream stopped" scan trigger.
 *
 * Production detection runs in-process via the offline loop (started at boot
 * from instrumentation.ts → lib/scheduler/offline-loop.ts), the same pattern as
 * the notification drain loop — NOT an external cron. This route stays as a
 * manual/testing trigger that runs one scan immediately. Duplicate alerts are
 * prevented by the detector's findOpenByRuleAndSource check (singleton-ness
 * comes from the single always-on Fly machine, not a DB leader lease — the
 * scheduler_leases table was dropped in migration 00070).
 *
 * Auth: x-internal-secret (PLEXUS_INTERNAL_SECRET).
 */

import { NextRequest, NextResponse } from "next/server";
import { detectOfflineOnce } from "@/lib/alerts/detect-offline";
import { reconcileLastSeen } from "@/lib/alerts/reconcile-last-seen";

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
    // Refresh last_seen_at from ClickHouse first so a manual run reflects
    // current stream state, same order as the production loop tick.
    const { updated } = await reconcileLastSeen();
    const result = await detectOfflineOnce();
    return NextResponse.json({ ...result, lastSeenUpdated: updated });
  } catch {
    return NextResponse.json({ error: "scan failed" }, { status: 500 });
  }
}

export const GET = handler;
export const POST = handler;
