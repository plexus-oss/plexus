/**
 * Next.js instrumentation hook — runs once when the server process boots.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // ⚠️ These are in-process background loops (setInterval). They only run in a
    // PERSISTENT server process — i.e. the always-on Fly machine
    // (min_machines_running=1, auto_stop off). They do NOT run on Vercel
    // serverless, where functions are ephemeral and setInterval doesn't survive.
    // If the web app is ever moved to Vercel-only, ALL of these stop silently:
    //   - notification/webhook delivery retries (startDrainLoop)
    //   - "stream stopped" offline alert detection (startOfflineLoop)
    //   - poll-based alert detection: event+threshold monitors on connection
    //     sources, event monitors on device sources (startPollLoop)
    //   - entity discovery: minted sources, association rows, per-entity
    //     freshness (startDiscoveryLoop)
    // Move them to a dedicated worker (or back to an external cron) before doing
    // that. Running on ZERO is the failure mode to fear; if they ever run on
    // multiple machines, the offline detector's findOpenByRuleAndSource check
    // and the event poller's persisted watermark still bound duplicate alerts.
    const { startDrainLoop } = await import("@/lib/notifications/drain");
    startDrainLoop();

    const { startOfflineLoop } = await import("@/lib/scheduler/offline-loop");
    startOfflineLoop();

    const { startPollLoop } = await import("@/lib/scheduler/poll-loop");
    startPollLoop();

    const { startDiscoveryLoop } = await import(
      "@/lib/scheduler/discovery-loop"
    );
    startDiscoveryLoop();
  }
}
