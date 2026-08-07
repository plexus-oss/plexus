/**
 * Liveness heartbeats for the in-process background loops (poll, drain,
 * offline). Each loop stamps a timestamp on every interval firing; /api/ping
 * (Fly's health check) turns a stale stamp into a failing check.
 *
 * Why: ALL alert detection and notification delivery rides these loops on the
 * single always-on machine. If they silently stop — or the app is ever moved
 * to a serverless runtime where instrumentation.ts never starts them — alerts
 * stop with no error anywhere. This makes that state impossible to miss: the
 * health check goes red and the machine drops out of the proxy pool.
 *
 * State lives on globalThis because the API-route bundle and the
 * instrumentation bundle don't share module instances (same reason the loops'
 * start-once flags live there).
 */

import "server-only";

export type LoopName = "poll" | "drain" | "offline" | "discovery";

/** A loop is unhealthy when it hasn't fired for this long (interval is 30s). */
export const LOOP_STALE_MS = 2 * 60 * 1000;

const globalState = globalThis as typeof globalThis & {
  __plexusLoopTicks?: Partial<Record<LoopName, number>>;
};

export function recordLoopTick(name: LoopName): void {
  (globalState.__plexusLoopTicks ??= {})[name] = Date.now();
}

export interface LoopHealth {
  /** False when the loops never started in this process (serverless/dev). */
  started: boolean;
  /** Loops that haven't fired within LOOP_STALE_MS. */
  stale: LoopName[];
  /** Seconds since each loop's last firing. */
  ageSeconds: Partial<Record<LoopName, number>>;
}

export function getLoopHealth(): LoopHealth {
  const ticks = globalState.__plexusLoopTicks;
  if (!ticks) return { started: false, stale: [], ageSeconds: {} };

  const now = Date.now();
  const stale: LoopName[] = [];
  const ageSeconds: Partial<Record<LoopName, number>> = {};
  for (const name of ["poll", "drain", "offline"] as const) {
    const last = ticks[name];
    if (last == null) {
      stale.push(name);
      continue;
    }
    ageSeconds[name] = Math.round((now - last) / 1000);
    if (now - last > LOOP_STALE_MS) stale.push(name);
  }
  return { started: true, stale, ageSeconds };
}
