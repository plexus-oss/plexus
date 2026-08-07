/**
 * Offline ("stream stopped") detector loop.
 *
 * In-process background loop started at server boot from instrumentation.ts,
 * the same pattern as the notification drain loop (lib/notifications/drain.ts)
 * — and for the same reason: this replaces the external cron the detector was
 * first written for, so it restarts with the app and needs no separate Fly
 * service or shared secret.
 *
 * Like the drain loop, this relies on the single always-on Fly machine. If the
 * frontend is ever scaled past one instance, the detector's own
 * findOpenByRuleAndSource check still prevents duplicate alerts.
 */

import "server-only";

import { detectOfflineOnce } from "@/lib/alerts/detect-offline";
import { reconcileLastSeen } from "@/lib/alerts/reconcile-last-seen";
import { recordLoopTick } from "@/lib/scheduler/loop-heartbeat";

const OFFLINE_INTERVAL_MS = 30_000;

const globalState = globalThis as typeof globalThis & {
  __plexusOfflineLoop?: ReturnType<typeof setInterval>;
};

async function tick(): Promise<void> {
  // Refresh sources.last_seen_at from ClickHouse first — nothing else writes it,
  // and the scan below is blind without it.
  const { updated } = await reconcileLastSeen();

  const { scanned, fired, resolved } = await detectOfflineOnce();
  if (updated > 0 || fired > 0 || resolved > 0) {
    console.log(
      JSON.stringify({
        event: "offline_scan",
        scanned,
        fired,
        resolved,
        lastSeenUpdated: updated,
      }),
    );
  }
}

export function startOfflineLoop(): void {
  if (globalState.__plexusOfflineLoop) return;

  const timer = setInterval(() => {
    recordLoopTick("offline");
    tick().catch((err) => {
      console.error("[offline-loop] tick failed:", err);
    });
  }, OFFLINE_INTERVAL_MS);

  // Don't hold the process open on shutdown.
  timer.unref?.();

  recordLoopTick("offline"); // initial stamp so /api/ping is green from boot
  globalState.__plexusOfflineLoop = timer;
  console.log(
    JSON.stringify({
      event: "offline_loop_started",
      intervalMs: OFFLINE_INTERVAL_MS,
    }),
  );
}
