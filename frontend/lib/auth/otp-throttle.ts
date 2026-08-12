/**
 * Brute-force throttle for email one-time-code verification.
 *
 * The magic-code sign-in verifies a 6-digit code, so the guess space is only
 * ~1e6 and several codes can be live at once. Auth.js consumes a code only on a
 * CORRECT guess, so without this a wrong guess is free and unlimited — an
 * attacker who knows a victim's email can brute-force a full session. This
 * caps failed guesses per identifier per window; once tripped, the caller also
 * invalidates all outstanding codes for that identifier (see the adapter's
 * useVerificationToken), forcing a fresh request.
 *
 * In-memory / per-instance, matching lib/rate-limiter.ts. Counters reset on
 * deploy and are not shared across Fly machines, so the effective ceiling is
 * MAX_FAILURES × instance-count per window — still a hard bound versus the
 * unlimited guessing it replaces. Move to Redis if the frontend scales out.
 */

import "server-only";

const MAX_FAILURES = 5; // failed guesses per identifier before lockout
const WINDOW_MS = 10 * 60_000; // ~ the code's own validity window
const CLEANUP_INTERVAL_MS = 60_000;

interface Entry {
  failures: number;
  windowStart: number;
}

const attempts = new Map<string, Entry>();

let cleanupTimer: ReturnType<typeof setInterval> | null = null;
function ensureCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of attempts) {
      if (now - entry.windowStart > WINDOW_MS) attempts.delete(key);
    }
    if (attempts.size === 0 && cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }, CLEANUP_INTERVAL_MS);
  if (cleanupTimer && typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    cleanupTimer.unref();
  }
}

function keyOf(identifier: string): string {
  return identifier.trim().toLowerCase();
}

function liveEntry(identifier: string): Entry | undefined {
  const entry = attempts.get(keyOf(identifier));
  if (!entry) return undefined;
  if (Date.now() - entry.windowStart >= WINDOW_MS) {
    attempts.delete(keyOf(identifier));
    return undefined;
  }
  return entry;
}

/** True once an identifier has exceeded MAX_FAILURES within the window. */
export function isOtpLocked(identifier: string): boolean {
  const entry = liveEntry(identifier);
  return !!entry && entry.failures >= MAX_FAILURES;
}

/**
 * Record a failed code guess. Returns `{ locked }` = true when this failure
 * reaches the lockout threshold (the caller should then invalidate outstanding
 * codes for the identifier).
 */
export function recordOtpFailure(identifier: string): { locked: boolean } {
  const key = keyOf(identifier);
  const now = Date.now();
  const entry = liveEntry(identifier);
  if (!entry) {
    attempts.set(key, { failures: 1, windowStart: now });
    ensureCleanup();
    return { locked: 1 >= MAX_FAILURES };
  }
  entry.failures += 1;
  return { locked: entry.failures >= MAX_FAILURES };
}

/** Clear the counter after a successful verification. */
export function clearOtpFailures(identifier: string): void {
  attempts.delete(keyOf(identifier));
}
