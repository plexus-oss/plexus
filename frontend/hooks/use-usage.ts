"use client";

/**
 * Usage Hook
 *
 * Fetches organization usage data using SWR.
 */

import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import type { BillingStatus, EnterpriseInfo, Tier } from "@/lib/billing/server";

export interface UsageSummary {
  currentPeriod: {
    dataPoints: number;
    bytesIngested: number;
    devicesActive: number;
    dashboardsUsed: number;
    metrics: number;
    logs: number;
    videoHours: number;
  };
  plan: {
    id: string;
    name: string;
    retentionDays: number;
    isEnterprise: boolean;
    contractInfo: null;
  };
  billing: {
    tier: Tier;
    status: BillingStatus;
    isPaid: boolean;
    enterpriseInfo: EnterpriseInfo | null;
    monthlySpendCapUsd: number | null;
    platformFeeUsd: number | null;
    teamTierMetrics: number;
    teamTierLogs: number;
    rates: {
      pricePerMillionMetricsUsd: number;
      pricePerMillionLogsUsd: number;
      pricePerVideoHourUsd: number;
    };
    estimatedCharge: {
      metrics: number;
      logs: number;
      video: number;
      total: number;
    };
    estimatedChargeUsd: number;
  };
  retention: {
    totalRows: number;
    oldestData: string | null;
    newestData: string | null;
    expiringIn48Hours: number;
  };
}

export interface UseUsageResult {
  usage: UsageSummary | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => void;
}

export function useUsage(): UseUsageResult {
  const { data, error, isLoading, mutate } = useSWR<UsageSummary>(
    "/api/usage",
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
    },
  );

  return {
    usage: data ?? null,
    isLoading,
    error: error ?? null,
    refresh: () => mutate(),
  };
}
