"use client";

/**
 * Subscribes to the realtime row-change stream (/api/realtime/stream, backed by
 * Postgres LISTEN/NOTIFY) and invalidates the matching SWR cache keys so the UI
 * reflects DB writes without a page refresh. The server scopes events to the
 * caller's org.
 */

import { useCallback, useEffect, useRef } from "react";
import { useSWRConfig } from "swr";
import { usePlexusSession } from "@/hooks/use-plexus-session";
import { useRealtimeEvents, type RowChangeEvent } from "@/lib/realtime/use-realtime-events";

const DEBOUNCE_MS = 250;

// Postgres table name → SWR key prefix to revalidate.
const TABLE_TO_KEY_PREFIX: Record<string, string> = {
  alerts: "/api/alerts",
  event_monitors: "/api/monitors",
  dashboards: "/api/dashboards",
  sources: "/api/sources",
  annotations: "/api/annotations",
  runs: "/api/runs",
  api_keys: "/api/api-keys",
  source_limits: "/api/source-limits",
  system_events: "/api/system-events",
};

export function RealtimeInvalidationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { mutate } = useSWRConfig();
  const { isSignedIn } = usePlexusSession();
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const onRowChange = useCallback(
    (ev: RowChangeEvent) => {
      const prefix = TABLE_TO_KEY_PREFIX[ev.table];
      if (!prefix) return;
      // Trailing debounce: cancel any pending timer so only the last event in a
      // burst triggers revalidation (first-write-wins would drop later events).
      const timers = timersRef.current;
      const existing = timers.get(prefix);
      if (existing) clearTimeout(existing);
      const t = setTimeout(() => {
        timers.delete(prefix);
        // No data argument: revalidate in place. Passing `undefined` as data
        // would write undefined into the cache (SWR treats it as provided
        // data), blanking every matching view until the refetch lands.
        mutate((key) => typeof key === "string" && key.startsWith(prefix));
      }, DEBOUNCE_MS);
      timers.set(prefix, t);
    },
    [mutate],
  );

  useRealtimeEvents(onRowChange, !!isSignedIn);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  return <>{children}</>;
}
