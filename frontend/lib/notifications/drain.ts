/**
 * Notification Drain Loop
 *
 * In-process background loop (started from instrumentation.ts at server boot)
 * that retries pending/failed notification and webhook deliveries. This is
 * the durability net behind the inline sends in lib/notifications/deliver.ts
 * and lib/webhooks/dispatcher.ts: anything a crashed/restarted process left
 * behind, or any send that failed transiently, gets retried here.
 *
 * We deploy on Fly with a single always-on machine (min_machines_running=1,
 * auto_stop off), so an in-process interval is singleton-safe and replaces
 * the external cron this codebase was originally written for.
 */

import "server-only";

import { runWithServiceRole } from "@/lib/db/queries/shared";
import { processPendingDeliveries } from "@/lib/webhooks/dispatcher";
import { processPendingNotifications } from "./deliver";
import { recordLoopTick } from "@/lib/scheduler/loop-heartbeat";

const DRAIN_INTERVAL_MS = 30_000;

const globalState = globalThis as typeof globalThis & {
  __plexusDrainLoop?: ReturnType<typeof setInterval>;
};

export async function drainOnce(): Promise<{
  notifications: number;
  webhooks: number;
}> {
  // The loop has no request context — queries must run as service-role.
  return runWithServiceRole(async () => {
    const notifications = await processPendingNotifications();
    const webhooks = await processPendingDeliveries();
    if (notifications > 0 || webhooks > 0) {
      console.log(
        JSON.stringify({ event: "drain_processed", notifications, webhooks }),
      );
    }
    return { notifications, webhooks };
  });
}

export function startDrainLoop(): void {
  if (globalState.__plexusDrainLoop) return;

  const timer = setInterval(() => {
    recordLoopTick("drain");
    drainOnce().catch((err) => {
      console.error("[drain] tick failed:", err);
    });
  }, DRAIN_INTERVAL_MS);

  // Don't hold the process open on shutdown.
  timer.unref?.();

  recordLoopTick("drain"); // initial stamp so /api/ping is green from boot
  globalState.__plexusDrainLoop = timer;
  console.log(
    JSON.stringify({ event: "drain_loop_started", intervalMs: DRAIN_INTERVAL_MS }),
  );
}
