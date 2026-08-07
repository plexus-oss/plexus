/**
 * POST /api/auth/ws-token — mint a short-lived gateway handshake token
 * for the current session. The gateway resolves the token back to
 * { org_id, user_id } via GET /api/auth/verify-session.
 */

import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth/session";
import { mintWsToken } from "@/lib/auth/ws-token";

export async function POST() {
  const { userId, orgId } = await getAuth();
  if (!userId || !orgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = await mintWsToken({ userId, orgId });
  return NextResponse.json({ token });
}
