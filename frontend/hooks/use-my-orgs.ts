"use client";

/**
 * The current user's org memberships + active-org switching, backed by
 * /api/me/orgs and /api/me/active-org. The active org is tracked by a
 * cookie, validated server-side against real memberships.
 */

import useSWR from "swr";

export interface MyOrg {
  orgId: string;
  name: string;
  imageUrl: string | null;
  role: string;
}

export function useMyOrgs() {
  const { data, isLoading, mutate } = useSWR<{
    activeOrgId: string | null;
    orgs: MyOrg[];
  }>("/api/me/orgs", (url: string) =>
    fetch(url).then((r) => (r.ok ? r.json() : { activeOrgId: null, orgs: [] })),
  );

  return {
    isLoaded: !isLoading,
    activeOrgId: data?.activeOrgId ?? null,
    orgs: data?.orgs ?? [],
    refresh: mutate,
  };
}

export async function setActiveOrg(orgId: string): Promise<boolean> {
  const res = await fetch("/api/me/active-org", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgId }),
  });
  return res.ok;
}

export async function createOrg(name: string): Promise<{ orgId: string } | null> {
  const res = await fetch("/api/orgs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) return null;
  return (await res.json()) as { orgId: string };
}
