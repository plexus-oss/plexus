/**
 * GET /api/realtime/stream — Server-Sent Events feed of DB row changes.
 *
 * Replaces the browser's Supabase Realtime subscriptions. Authenticates the
 * session, then streams `row_change` events for the caller's org only (scoped
 * server-side via getAuth → orgId, stricter than the old RLS filter). The
 * browser uses these to bust SWR caches and toast new alerts; payloads carry
 * only {table, op, org_id, id}, so the client refetches through the normal API.
 *
 * Node runtime: holds a Postgres LISTEN connection via the shared notify hub.
 */

import { getAuth } from "@/lib/auth/session";
import { notifyHub, type RowChange } from "@/lib/realtime/notify-listener";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000; // keep the connection alive past the Fly proxy idle timeout

export async function GET(req: Request): Promise<Response> {
  const { orgId } = await getAuth();
  if (!orgId) return new Response("Unauthorized", { status: 401 });

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (unsubscribe) unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // SSE preamble: a comment line opens the stream; clients ignore it.
      send(": connected\n\n");

      unsubscribe = await notifyHub().subscribe(orgId, (ev: RowChange) => {
        send(`event: row_change\ndata: ${JSON.stringify(ev)}\n\n`);
      });

      heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);

      // Browser navigated away / EventSource closed → tear down listener + timer.
      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      closed = true;
      if (unsubscribe) unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable proxy buffering so events flush immediately.
      "X-Accel-Buffering": "no",
    },
  });
}
