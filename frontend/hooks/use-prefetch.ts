"use client";

/**
 * Hover/focus prefetch — the single source of truth for warming up
 * a navigation target before the user clicks.
 *
 * We prefetch two things:
 *   1. The Next.js route (JS chunks for the destination page).
 *   2. The SWR cache keys the destination will read on mount.
 *
 * Together they mean a click on a row renders the next page from
 * cache instead of waiting for a round-trip. This is the closest
 * we get to Linear-style instant nav without a local-first store.
 *
 *   const prefetch = usePrefetch();
 *   <tr
 *     onMouseEnter={() => prefetch(href, [`/api/sources/${slug}`])}
 *     onFocus={() => prefetch(href, [`/api/sources/${slug}`])}
 *   />
 */

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { preload } from "swr";
import { fetcher } from "@/lib/fetcher";

type SWRKey = string | null | undefined;

export function usePrefetch() {
  const router = useRouter();
  return useCallback(
    (href: string, swrKeys: SWRKey[] = []) => {
      router.prefetch(href);
      for (const key of swrKeys) {
        // Warm the SWR cache with the same fetcher SWRProvider uses, so the
        // destination page reads from cache instead of refetching on mount.
        if (key) preload(key, fetcher);
      }
    },
    [router],
  );
}
