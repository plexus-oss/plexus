import { NextResponse } from "next/server";
import { drainOnce } from "@/lib/notifications/drain";

/**
 * GET /api/cron/process-webhooks
 *
 * Manual/back-up trigger for the delivery queues. The in-process drain loop
 * (lib/notifications/drain.ts, started in instrumentation.ts) handles this
 * continuously; this endpoint remains for ad-hoc draining and ops.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // drainOnce runs with the service-role client — no session on cron calls.
    const processed = await drainOnce();

    return NextResponse.json({
      success: true,
      processed,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "cron_process_webhooks_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );

    return NextResponse.json(
      { error: "Failed to process deliveries" },
      { status: 500 },
    );
  }
}
