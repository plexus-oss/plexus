"use client";

/**
 * Terminal availability — GET /api/assistant/terminal via SWR (env-only check
 * server-side; the POST 503s without ANTHROPIC_API_KEY). Mirrors
 * use-label-availability: UI entry points that hand off to the Terminal (the
 * chart toolbar's "Explain" button) render only when it's configured.
 */

import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";

interface TerminalAvailability {
  available: boolean;
}

export function useTerminalAvailability(): { available: boolean } {
  const { data } = useSWR<TerminalAvailability>(
    "/api/assistant/terminal",
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60000 },
  );

  return { available: data?.available ?? false };
}
