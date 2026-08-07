import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";

/**
 * GET /api/authjs/precheck?email=… → { exists: boolean }
 *
 * Lets the sign-in / sign-up card enforce intent before sending an OTP:
 * sign-up rejects an email that already has an account, sign-in rejects one
 * that doesn't. A static segment, so it resolves ahead of the [...authjs]
 * catch-all. Public (pre-auth) and service-role; email is lowercased to match
 * the users table's case-insensitive identity.
 *
 * This necessarily reveals whether an account exists — the same thing the
 * sign-up/sign-in messages surface — which is an accepted trade-off for the
 * "you already have an account" / "no account found" UX.
 */
export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams
    .get("email")
    ?.trim()
    .toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }

  try {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    const data = rows[0] ?? null;
    return NextResponse.json({ exists: !!data });
  } catch {
    // Fail closed on our side (500); the client treats a non-OK response as
    // "unknown" and skips the gate rather than blocking a legitimate user.
    return NextResponse.json({ error: "lookup failed" }, { status: 500 });
  }
}
