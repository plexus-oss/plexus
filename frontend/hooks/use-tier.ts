"use client";

/**
 * Tier hook — informational. Prefer `useFeature` from
 * `hooks/use-features.ts` for any branching on capabilities; this hook is
 * the raw tier signal those higher-level hooks read from. Use it
 * directly only for status badges or plan-name copy.
 */

import { useUsage } from "./use-usage";
import type { Tier } from "@/lib/billing/server";

export interface UseTierResult {
  tier: Tier;
  isPaid: boolean;
  isLoading: boolean;
}

export function useTier(): UseTierResult {
  const { usage, isLoading } = useUsage();

  if (!usage) {
    return { tier: "tier_1", isPaid: false, isLoading };
  }

  return {
    tier: usage.billing.tier,
    isPaid: usage.billing.isPaid,
    isLoading: false,
  };
}
