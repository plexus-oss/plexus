"use client";

/**
 * Internal Admin Hooks
 * Data fetching hooks for the internal admin pages.
 */

import useSWR from "swr";

export interface OrgResult {
  id: string;
  name: string;
  slug: string | null;
  membersCount: number;
  createdAt: number;
  imageUrl: string;
  plan: string;
}

interface OrgSearchResponse {
  orgs: OrgResult[];
  totalCount: number;
}

export interface InternalOrgMember {
  userId: string;
  email: string | null;
  name: string | null;
  imageUrl: string | null;
  role: string;
  createdAt: number | null;
}

export interface InternalOrgDetail {
  org: {
    id: string;
    name: string;
    tier: string | null;
    plan: string;
    createdAt: number | null;
    stripeCustomerId: string | null;
    stripeSubscriptionStatus: string | null;
    billingMissing: boolean;
  };
  counts: {
    members: number;
    devices: number;
    connections: number;
    dashboards: number;
    monitors: number;
    alertRules: number;
    alerts: number;
    apiKeys: number;
  };
  usage: {
    periodStart: string;
    dataPointsIngested: number;
    bytesIngested: number;
    devicesActive: number;
  } | null;
  members: InternalOrgMember[];
}

// =============================================================================
// Hooks
// =============================================================================

export function useInternalOrgSearch(query: string) {
  const { data, isLoading, mutate } = useSWR<OrgSearchResponse>(
    `/api/internal/orgs?q=${encodeURIComponent(query)}&limit=20`,
    { dedupingInterval: 1000 },
  );

  return {
    orgs: data?.orgs ?? [],
    totalCount: data?.totalCount ?? 0,
    isLoading,
    mutate,
  };
}

export function useInternalOrg(orgId: string | null) {
  const { data, isLoading, error, mutate } = useSWR<InternalOrgDetail>(
    orgId ? `/api/internal/orgs/${encodeURIComponent(orgId)}` : null,
  );

  return {
    detail: data ?? null,
    isLoading,
    notFound:
      (error as { status?: number } | undefined)?.status === 404 ||
      (!isLoading && !data && !!error),
    mutate,
  };
}
