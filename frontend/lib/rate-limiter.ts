/**
 * Fixed Window Rate Limiter
 *
 * In-memory, per-instance rate limiting keyed by an arbitrary string
 * (org id, client IP, share token, …). Defaults to 1-second windows;
 * pass `windowMs` for longer windows (per minute, per hour).
 *
 * NOTE: counters are per server instance (not shared across Fly machines),
 * so effective limits scale with instance count. Acceptable for abuse
 * protection at the current instance count.
 */

interface WindowEntry {
  count: number;
  windowStart: number;
  windowMs: number;
}

const windows = new Map<string, WindowEntry>();

const WINDOW_MS = 1000; // default: 1 second
const CLEANUP_INTERVAL_MS = 60_000; // Clean stale entries every 60s
const STALE_THRESHOLD_MS = 10_000; // Remove entries idle for 10s past their window

// Periodic cleanup to prevent memory leaks
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of windows) {
      if (now - entry.windowStart > entry.windowMs + STALE_THRESHOLD_MS) {
        windows.delete(key);
      }
    }
    // If map is empty, stop the timer
    if (windows.size === 0 && cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }, CLEANUP_INTERVAL_MS);
  // Don't block process exit
  if (cleanupTimer && typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    cleanupTimer.unref();
  }
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfter?: number;
}

/**
 * Check if a request is within the rate limit for a given key.
 *
 * @param key - The key to rate limit on (org id, IP, token, …). Prefix
 *   per call site (e.g. `"contact:" + ip`) to keep buckets independent.
 * @param max - Maximum requests allowed per window
 * @param windowMs - Window length in milliseconds (default 1000)
 * @returns Rate limit result with allowed status and metadata
 */
export function checkRateLimit(
  key: string,
  max: number,
  windowMs: number = WINDOW_MS,
): RateLimitResult {
  const now = Date.now();
  const entry = windows.get(key);

  // New window or expired window - reset
  if (!entry || now - entry.windowStart >= entry.windowMs) {
    windows.set(key, { count: 1, windowStart: now, windowMs });
    ensureCleanup();
    return {
      allowed: true,
      limit: max,
      remaining: max - 1,
    };
  }

  // Within current window
  entry.count++;

  if (entry.count > max) {
    const retryAfter = Math.ceil((entry.windowStart + entry.windowMs - now) / 1000);
    return {
      allowed: false,
      limit: max,
      remaining: 0,
      retryAfter: Math.max(retryAfter, 1),
    };
  }

  return {
    allowed: true,
    limit: max,
    remaining: max - entry.count,
  };
}

/**
 * Extract the client IP for rate-limit keying: first value of
 * x-forwarded-for (set by the Fly proxy), falling back to "unknown".
 */
export function getClientIp(request: { headers: Headers }): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || "unknown";
}
