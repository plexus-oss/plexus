"use client";

/**
 * Org member list from the org_members mirror (GET /api/org/members),
 * for data-only reads.
 */

import useSWR from "swr";

export interface OrgMember {
  userId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  name: string;
  imageUrl: string | null;
  role: string;
}

export function useOrgMembers() {
  const { data, error, isLoading } = useSWR<{ members: OrgMember[] }>(
    "/api/org/members",
    (url: string) => fetch(url).then((r) => (r.ok ? r.json() : { members: [] })),
  );

  return {
    members: data?.members ?? [],
    isLoading,
    error,
  };
}
