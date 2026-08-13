"use client";

/**
 * Labeling availability — GET /api/assistant/label via SWR (env-only check
 * server-side). The Label button on chart panels renders only when a
 * provider (local Ollama or Anthropic) is configured; the POST route's 503
 * toast remains the runtime fallback.
 */

import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import type { LabelProvider } from "@/lib/ai/label/provider";

interface LabelAvailability {
  available: boolean;
  provider: LabelProvider | null;
}

export interface UseLabelAvailabilityResult {
  available: boolean;
  provider: LabelProvider | null;
}

export function useLabelAvailability(): UseLabelAvailabilityResult {
  const { data } = useSWR<LabelAvailability>("/api/assistant/label", fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60000,
  });

  return {
    available: data?.available ?? false,
    provider: data?.provider ?? null,
  };
}
