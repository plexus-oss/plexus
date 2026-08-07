import "server-only";

import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

/**
 * Shared x-internal-secret auth for all /api/internal/ routes.
 * Returns a NextResponse error if auth fails, null if OK.
 * Uses constant-time comparison to prevent timing attacks.
 */
export function verifyInternalAuth(
  request: NextRequest,
  label: string,
): NextResponse | null {
  const expected = process.env.PLEXUS_INTERNAL_SECRET;
  if (!expected) {
    console.error(
      `[${label}] PLEXUS_INTERNAL_SECRET is not set — refusing request`,
    );
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }
  const provided = request.headers.get("x-internal-secret") ?? "";
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  const match =
    providedBuf.length === expectedBuf.length &&
    timingSafeEqual(providedBuf, expectedBuf);
  if (!match) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
