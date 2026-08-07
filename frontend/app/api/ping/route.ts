/**
 * GET /api/ping — Fly's HTTP health check (see fly.toml http_checks).
 *
 * Beyond process liveness, this now verifies the in-process background loops
 * (poll / drain / offline) are actually firing. Those loops ARE the alerting
 * system's detection and delivery for everything the alert-service doesn't
 * cover; if they stall, alerts stop with no error anywhere else. A stale loop
 * turns this check red (503), which drops the machine from the proxy pool and
 * shows up immediately in `fly checks list`.
 */

import { NextResponse } from "next/server";
import { getLoopHealth } from "@/lib/scheduler/loop-heartbeat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const loops = getLoopHealth();

  // Loops never started in this process: dev servers and serverless runtimes.
  // Report it rather than fail — instrumentation.ts always starts them on Fly.
  if (!loops.started) {
    return NextResponse.json({ ok: true, loops: "not_started" });
  }

  if (loops.stale.length > 0) {
    return NextResponse.json(
      { ok: false, stale_loops: loops.stale, loop_age_seconds: loops.ageSeconds },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true, loop_age_seconds: loops.ageSeconds });
}
