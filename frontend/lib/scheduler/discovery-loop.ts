/**
 * Entity-discovery loop.
 *
 * In-process background loop started at server boot from instrumentation.ts,
 * same shape as the poll loop: single always-on Fly machine, globalThis
 * start-once guard, re-entrancy skip (customer DBs can be slower than the
 * interval), unref'd timer. Each tick syncs every connection's discovery
 * rules (see lib/discovery/discover.ts): distinct identity values → minted
 * sources + association rows + per-entity freshness.
 *
 * Idempotency makes multi-instance overlap harmless: minting converges on
 * the (org, slug) unique constraint and associations upsert.
 */

import "server-only";

import { discoverOnce } from "@/lib/discovery/discover";
import { recordLoopTick } from "@/lib/scheduler/loop-heartbeat";

const DISCOVERY_INTERVAL_MS = 60_000;

const globalState = globalThis as typeof globalThis & {
  __plexusDiscoveryLoop?: ReturnType<typeof setInterval>;
};

let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const stats = await discoverOnce();
    if (stats.discovered > 0 || stats.errors > 0) {
      console.log(JSON.stringify({ event: "discovery_scan", ...stats }));
    }
  } finally {
    running = false;
  }
}

export function startDiscoveryLoop(): void {
  if (globalState.__plexusDiscoveryLoop) return;

  const timer = setInterval(() => {
    recordLoopTick("discovery");
    tick().catch((err) => {
      console.error("[discovery-loop] tick failed:", err);
    });
  }, DISCOVERY_INTERVAL_MS);
  timer.unref();
  globalState.__plexusDiscoveryLoop = timer;
}
