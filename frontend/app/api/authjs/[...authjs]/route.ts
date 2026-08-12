/**
 * Auth.js route handlers (sign-in, callback, session, csrf, ...).
 * Mounted at /api/authjs (see basePath in lib/auth/authjs.ts) to stay
 * clear of the app's own /api/auth/* routes.
 */

import type { NextRequest } from "next/server";
import { handlers } from "@/lib/auth/authjs";
import { checkRateLimit, getClientIp } from "@/lib/rate-limiter";

export const { GET } = handlers;

// Coarse per-IP throttle on auth POSTs (sign-in requests + code submissions),
// a second dimension alongside the per-identifier OTP throttle in the adapter.
// Session/csrf reads are GET and are unaffected. Generous enough for normal
// use; blunts rapid credential/code guessing from a single source.
const MAX_AUTH_POSTS_PER_MIN = 30;

export async function POST(request: NextRequest): Promise<Response> {
  const ip = getClientIp(request);
  const rl = checkRateLimit(`authjs-post:${ip}`, MAX_AUTH_POSTS_PER_MIN, 60_000);
  if (!rl.allowed) {
    return new Response("Too many requests", {
      status: 429,
      headers: { "retry-after": String(rl.retryAfter ?? 60) },
    });
  }
  return handlers.POST(request);
}
