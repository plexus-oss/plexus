/**
 * GET /api/internal/alerts/active
 *
 * Active rule-based alerts for the alert-service's reconcile loop. The
 * alert-service holds alert instances in memory only — after a restart (or
 * a dropped `closed` batch) a DB row can stay `is_alert_active=true` with
 * no instance behind it, meaning no close transition will ever arrive and,
 * via the unique active-alert index, no future open can insert either. The
 * reconcile loop fetches this list, compares against its live instances,
 * and emits synthetic `closed` transitions for the strays. See
 * houston/CONTRACT.md §5.
 *
 * Scope: threshold/outlier/compound rules only (the types the alert-service
 * evaluates). Offline-rule and poll-path (event/limit) alerts have their
 * own close paths in the frontend loops.
 *
 * Auth: server-to-server only via x-internal-secret, same as
 * /api/internal/alerts/rules/all.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAlertQueries } from "@/lib/db/server";

export async function GET(request: NextRequest) {
  const secret = request.headers.get("x-internal-secret");
  const expected = process.env.PLEXUS_INTERNAL_SECRET;

  if (!expected) {
    console.error(
      "[alerts/active] PLEXUS_INTERNAL_SECRET is not set — refusing request",
    );
    return NextResponse.json(
      { error: "Server not configured" },
      { status: 500 },
    );
  }

  if (!secret || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const alerts = await adminAlertQueries.findActiveForAlertService();
    return NextResponse.json({ alerts });
  } catch (error) {
    console.error("[alerts/active] query failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
