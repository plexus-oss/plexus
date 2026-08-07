/**
 * Poll-based alert detection loop.
 *
 * In-process background loop started at server boot from instrumentation.ts,
 * the same pattern as the drain and offline loops. It stands in for the
 * gateway "detection consumer" that was never built — and for connection
 * sources a push consumer never could exist: the data lives in the customer's
 * own store, so arrival can only be observed by polling it. Covers event +
 * threshold monitors on connection sources and event monitors on device
 * sources (owned ClickHouse); see lib/alerts/detect-poll.ts.
 *
 * Like the other loops, this relies on the single always-on Fly machine. If
 * the frontend is ever scaled past one instance, the per-monitor watermark is
 * persisted in Postgres, so overlapping instances can double-fire at most one
 * tick's worth of rows (and the 5-min dedup window absorbs most of that).
 *
 * A tick that finds the previous tick still running returns immediately —
 * customer databases can be slower than the interval.
 */

import "server-only";

import { detectPollOnce } from "@/lib/alerts/detect-poll";
import { recordLoopTick } from "@/lib/scheduler/loop-heartbeat";

const POLL_INTERVAL_MS = 30_000;

const globalState = globalThis as typeof globalThis & {
  __plexusPollLoop?: ReturnType<typeof setInterval>;
};

let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const stats = await detectPollOnce();
    if (
      stats.fired > 0 ||
      stats.initialized > 0 ||
      stats.skipped > 0 ||
      stats.errors > 0
    ) {
      console.log(JSON.stringify({ event: "poll_scan", ...stats }));
    }
  } finally {
    running = false;
  }
}

export function startPollLoop(): void {
  if (globalState.__plexusPollLoop) return;

  const timer = setInterval(() => {
    recordLoopTick("poll");
    tick().catch((err) => {
      console.error("[poll-loop] tick failed:", err);
    });
  }, POLL_INTERVAL_MS);

  // Don't hold the process open on shutdown.
  timer.unref?.();

  recordLoopTick("poll"); // initial stamp so /api/ping is green from boot
  globalState.__plexusPollLoop = timer;
  console.log(
    JSON.stringify({
      event: "poll_loop_started",
      intervalMs: POLL_INTERVAL_MS,
    }),
  );
}
