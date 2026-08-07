"use client";

import { SWRConfig, useSWRConfig } from "swr";
import { ReactNode, useEffect, useRef } from "react";
import { usePlexusSession } from "@/hooks/use-plexus-session";
import { fetcher, isFetchError } from "@/lib/fetcher";

interface SWRProviderProps {
  children: ReactNode;
}

/**
 * Connection-error patterns that should NOT be retried — retrying only
 * makes the problem worse by opening more connections to an already
 * overloaded database.
 */
const CONNECTION_ERROR_PATTERNS = [
  "connection slots",
  "too many connections",
  "remaining connection slots are reserved",
  "FATAL: sorry, too many clients",
  "Connection refused",
  "Connection timed out",
  "temporarily paused",
];

function isConnectionExhaustedError(error: Error): boolean {
  const msg = error.message.toLowerCase();
  return CONNECTION_ERROR_PATTERNS.some((p) => msg.includes(p.toLowerCase()));
}

const swrConfig = {
  // Never revalidate on focus or reconnect — we do not want tab-switching
  // or network blips to cause a thundering herd of DB connections
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  // No default polling - individual hooks can override
  refreshInterval: 0,
  // 2s deduping — prevents multiple panels requesting the same data simultaneously
  dedupingInterval: 2000,
  // Reduce retry attempts and increase interval
  errorRetryCount: 2,
  errorRetryInterval: 10000,
  // Use keepPreviousData to prevent UI flashing during revalidation
  keepPreviousData: true,
  // Single shared fetcher (structured FetchError with .status/.code/.details).
  // The same fetcher is used by every hook and by use-prefetch's preload().
  fetcher,
  onError: (error: Error) => {
    console.error("SWR Error:", error);
  },
  // Stop retrying when the user's database is overloaded
  onErrorRetry: (
    error: Error,
    _key: string,
    _config: unknown,
    revalidate: (opts?: { retryCount?: number }) => void,
    { retryCount }: { retryCount: number },
  ) => {
    // Never retry connection-exhaustion errors — the DB needs breathing room
    if (isConnectionExhaustedError(error)) return;
    const status = isFetchError(error) ? error.status : 0;
    // Don't retry 4xx errors (bad request, unauthorized, not found)
    if (status >= 400 && status < 500) return;
    // Don't retry 503 (circuit breaker / service unavailable)
    if (status === 503) return;
    // Max 2 retries for other errors, with 10s backoff
    if (retryCount >= 2) return;
    setTimeout(() => revalidate({ retryCount }), 10000);
  },
};

/**
 * Clears all org-scoped SWR cache entries when the active organization changes.
 * Without this, switching orgs would show stale data from the previous org
 * because all hooks use the same cache keys (e.g. "/api/dashboards").
 */
function OrgCacheBuster({ children }: { children: ReactNode }) {
  const { orgId } = usePlexusSession();
  const { cache, mutate } = useSWRConfig();
  const prevOrgId = useRef(orgId);

  useEffect(() => {
    if (prevOrgId.current && orgId && prevOrgId.current !== orgId) {
      // Clear all /api/ cache entries — they're org-scoped server-side
      if (cache instanceof Map) {
        const keys = Array.from(cache.keys());
        for (const key of keys) {
          if (typeof key === "string" && key.startsWith("/api/")) {
            cache.delete(key);
          }
        }
      }
      // Revalidate everything so new org data loads immediately
      mutate(() => true, undefined, { revalidate: true });
    }
    prevOrgId.current = orgId;
  }, [orgId, cache, mutate]);

  return <>{children}</>;
}

export function SWRProvider({ children }: SWRProviderProps) {
  return (
    <SWRConfig value={swrConfig}>
      <OrgCacheBuster>{children}</OrgCacheBuster>
    </SWRConfig>
  );
}
