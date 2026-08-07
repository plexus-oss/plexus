"use client";

/**
 * Feature gate hooks.
 *
 *   const terminal = useFeature("terminal");
 *   if (!ai.enabled) return <UpgradeStub />;
 *
 *   // Nav / multi-check surfaces — one tier read, all flags
 *   const { flags } = useFeatures();
 *
 * `isLoading` is true while the tier read is in flight. Treat it as "not
 * yet enabled" for UX but don't show an upgrade prompt against it.
 */

import { useMemo } from "react";
import { useTier } from "./use-tier";
import { FEATURES, isEnabled, type FeatureKey } from "@/lib/features";

export interface FeatureState {
  enabled: boolean;
  isLoading: boolean;
}

export function useFeature(key: FeatureKey): FeatureState {
  const { isPaid, isLoading } = useTier();
  return useMemo(
    () => ({ enabled: isEnabled(FEATURES[key], { isPaid }), isLoading }),
    [key, isPaid, isLoading],
  );
}

export type FeatureFlags = Record<FeatureKey, boolean>;

export function useFeatures(): { flags: FeatureFlags; isLoading: boolean } {
  const { isPaid, isLoading } = useTier();
  const flags = useMemo<FeatureFlags>(() => {
    const out = {} as FeatureFlags;
    for (const key of Object.keys(FEATURES) as FeatureKey[]) {
      out[key] = isEnabled(FEATURES[key], { isPaid });
    }
    return out;
  }, [isPaid]);
  return { flags, isLoading };
}
