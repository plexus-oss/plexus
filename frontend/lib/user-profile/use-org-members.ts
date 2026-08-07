"use client";

/**
 * useOrgMembers — single source for resolving a userId to a display
 * profile (name / email / avatar / role) on the client.
 *
 * Wraps the org_members-backed hook so the people-picker and access
 * panels don't each re-derive name formatting, and so they work under
 * both auth providers.
 */

import { useMemo } from "react";
import { useOrgMembers as useOrgMembersList } from "@/hooks/use-org-members";

export interface OrgMemberProfile {
  userId: string;
  name: string;
  email: string;
  imageUrl: string;
  role: string;
}

export function useOrgMembers() {
  const { members, isLoading } = useOrgMembersList();

  const list = useMemo<OrgMemberProfile[]>(
    () =>
      members.map((m) => ({
        userId: m.userId,
        name: m.name,
        email: m.email ?? "",
        imageUrl: m.imageUrl ?? "",
        role: m.role,
      })),
    [members],
  );

  const byId = useMemo(() => {
    const map = new Map<string, OrgMemberProfile>();
    for (const m of list) map.set(m.userId, m);
    return map;
  }, [list]);

  return { members: list, byId, isLoading };
}
