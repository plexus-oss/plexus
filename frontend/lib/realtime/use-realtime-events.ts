"use client";

/**
 * Browser side of realtime — a single shared EventSource to /api/realtime/stream
 * (replaces the Supabase Realtime client). All consumers (cache invalidation,
 * alert toasts) share ONE connection via ref-counting, so the server holds one
 * SSE → one Postgres LISTEN fan-out per tab. The server already scopes events to
 * the caller's org, so handlers receive only their org's row changes.
 */

import { useEffect, useRef } from "react";

export interface RowChangeEvent {
  table: string;
  op: "INSERT" | "UPDATE" | "DELETE";
  org_id: string | null;
  id: string | null;
}

type Handler = (ev: RowChangeEvent) => void;

const handlers = new Set<Handler>();
let source: EventSource | null = null;

function ensureSource() {
  if (source) return;
  source = new EventSource("/api/realtime/stream");
  source.addEventListener("row_change", (e) => {
    let ev: RowChangeEvent;
    try {
      ev = JSON.parse((e as MessageEvent).data) as RowChangeEvent;
    } catch {
      return;
    }
    for (const h of handlers) h(ev);
  });
  // EventSource reconnects automatically on transport errors; the server's
  // NOTIFY listener self-heals independently, so there's nothing to do here.
}

function maybeTeardown() {
  if (source && handlers.size === 0) {
    source.close();
    source = null;
  }
}

/**
 * Subscribe to org-scoped DB row-change events. `handler` may change identity
 * between renders (kept in a ref); pass `enabled=false` to opt out (e.g. when
 * signed out) without opening the connection.
 */
export function useRealtimeEvents(handler: Handler, enabled = true): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });

  useEffect(() => {
    if (!enabled) return;
    const wrapper: Handler = (ev) => ref.current(ev);
    handlers.add(wrapper);
    ensureSource();
    return () => {
      handlers.delete(wrapper);
      maybeTeardown();
    };
  }, [enabled]);
}
