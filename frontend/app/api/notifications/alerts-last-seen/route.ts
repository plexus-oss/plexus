/**
 * Per-user "alerts last seen" timestamp.
 *
 * GET  /api/notifications/alerts-last-seen
 *   → { alertsLastSeenAt: string | null }
 *
 * POST /api/notifications/alerts-last-seen
 *   Body: { at?: string }  (defaults to now())
 *   Upserts the timestamp and returns the new value.
 *
 * Backs the bell-badge pulse: the dropdown calls POST when it opens, and
 * subsequent GETs reflect that across devices/browsers.
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/with-auth";
import { userNotificationStateQueries } from "@/lib/db";

export const GET = withAuth(async (_request, { userId, orgId }) => {
  const row = await userNotificationStateQueries.get(userId, orgId);
  return NextResponse.json({
    alertsLastSeenAt: row?.alerts_last_seen_at ?? null,
  });
});

export const POST = withAuth(async (request, { userId, orgId }) => {
  let at = new Date();
  try {
    const body = (await request.json()) as { at?: unknown };
    if (typeof body?.at === "string") {
      const parsed = new Date(body.at);
      if (!Number.isNaN(parsed.getTime())) at = parsed;
    }
  } catch {
    // empty body is fine — default to now()
  }

  const row = await userNotificationStateQueries.setAlertsLastSeen(
    userId,
    orgId,
    at,
  );
  return NextResponse.json({ alertsLastSeenAt: row.alerts_last_seen_at });
});
