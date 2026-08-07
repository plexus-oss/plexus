import { NextRequest, NextResponse } from "next/server";
import {
  adminDeviceAuthQueries,
  CLAIM_TTL_SECONDS,
} from "@/lib/db/queries/device-auth";
import { checkRateLimit, getClientIp } from "@/lib/rate-limiter";

/**
 * POST /api/auth/claim - Start a key-claim request (coding-agent onboarding)
 *
 * Public, unauthenticated: called by a coding agent from inside a user's
 * repo. Device-code grant — the agent receives a secret device_code (for
 * polling) and a human-facing verification_url the user opens in a signed-in
 * browser to approve. No key exists until an org admin/editor approves.
 *
 * Body: { name?: string } — display name for the key being requested.
 *
 * Response (201):
 *   { device_code, user_code, verification_url, expires_in, interval }
 */
export async function POST(request: NextRequest) {
  const rate = checkRateLimit(`claim-create:${getClientIp(request)}`, 10, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "Too many claim requests. Try again later." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter ?? 60) } },
    );
  }

  let name: string | null = null;
  try {
    const body = (await request.json()) as { name?: unknown };
    if (typeof body?.name === "string") {
      name = body.name.trim().slice(0, 100) || null;
    }
  } catch {
    // Body is optional
  }

  try {
    const row = await adminDeviceAuthQueries.create(name);
    // Behind Fly's proxy request.nextUrl.origin is the internal bind address
    // (https://[::]:3000), so the public host must come from config.
    const origin =
      process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    return NextResponse.json(
      {
        device_code: row.device_code,
        user_code: row.user_code,
        verification_url: `${origin}/claim/${row.user_code}`,
        expires_in: CLAIM_TTL_SECONDS,
        interval: 5,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Claim request creation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
