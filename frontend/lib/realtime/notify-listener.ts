/**
 * Postgres LISTEN/NOTIFY hub — the server side of browser realtime.
 *
 * Replaces Supabase Realtime. The `notify_row_change` trigger (migration 0003)
 * fires a tiny NOTIFY on the `row_change` channel for every insert/update/delete
 * on the watched app tables. This hub holds ONE dedicated `pg.Client` that
 * `LISTEN`s on that channel and fans each event to in-process subscribers keyed
 * by `org_id`. The SSE endpoint (app/api/realtime/stream) is the only consumer;
 * it forwards events for the caller's org to the browser.
 *
 * One listener connection per server process. Postgres broadcasts NOTIFY to
 * every listening connection, so this works on a single Fly machine and, if
 * scaled out, on each machine independently — every process sees every event and
 * filters for its own connected clients. Matches the single-server-first plan.
 */

import "server-only";

import { Client } from "pg";
import { EventEmitter } from "node:events";

import { globalSingleton } from "@/lib/global-singleton";

export interface RowChange {
  table: string;
  op: "INSERT" | "UPDATE" | "DELETE";
  org_id: string | null;
  id: string | null;
}

class NotifyHub {
  private emitter = new EventEmitter();
  private client: Client | null = null;
  private starting: Promise<void> | null = null;

  constructor() {
    // One emitter event per org; an active app can have many SSE clients.
    this.emitter.setMaxListeners(0);
  }

  /** Subscribe to row-change events for one org. Returns an unsubscribe fn. */
  async subscribe(
    orgId: string,
    handler: (ev: RowChange) => void,
  ): Promise<() => void> {
    await this.ensureConnected();
    this.emitter.on(orgId, handler);
    return () => this.emitter.off(orgId, handler);
  }

  private async ensureConnected(): Promise<void> {
    if (this.client) return;
    if (!this.starting) {
      this.starting = this.connect().finally(() => {
        this.starting = null;
      });
    }
    return this.starting;
  }

  private async connect(): Promise<void> {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    client.on("notification", (msg) => {
      if (msg.channel !== "row_change" || !msg.payload) return;
      let ev: RowChange;
      try {
        ev = JSON.parse(msg.payload) as RowChange;
      } catch {
        return;
      }
      // Org-scoped dispatch — SSE handlers only ever see their own org's events.
      if (ev.org_id) this.emitter.emit(ev.org_id, ev);
    });
    client.on("error", (err) => {
      console.error("[notify-listener] client error:", err.message);
      this.handleDrop();
    });
    client.on("end", () => this.handleDrop());

    await client.connect();
    await client.query("LISTEN row_change");
    this.client = client;
  }

  /** Drop the dead client and self-heal if anyone is still listening. */
  private handleDrop(): void {
    const dead = this.client;
    this.client = null;
    if (dead) {
      dead.removeAllListeners();
      dead.end().catch(() => {});
    }
    // Reconnect on a short delay while there are active subscribers, so
    // long-lived SSE connections recover without needing a fresh subscribe().
    setTimeout(() => {
      if (this.emitter.eventNames().length > 0) {
        this.ensureConnected().catch((e) =>
          console.error("[notify-listener] reconnect failed:", e),
        );
      }
    }, 1_000);
  }
}

// HMR-safe singleton (Next reloads modules in dev; one hub per process).
export function notifyHub(): NotifyHub {
  return globalSingleton("notifyHub", () => new NotifyHub());
}
