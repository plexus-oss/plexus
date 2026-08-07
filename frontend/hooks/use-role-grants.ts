"use client";

/**
 * Dashboard grants for a SET of role groups (built-in keywords and custom
 * role ids) in one SWR entry — the Access matrix needs every column at once
 * and the column count is dynamic, so per-group hooks won't do.
 */

import useSWR from "swr";
import type { GroupGrant } from "@/lib/db/queries/access";

export type { GroupGrant };

export function useRoleGrants(groupIds: string[]) {
  const key =
    groupIds.length > 0 ? `role-grants:${groupIds.join(",")}` : null;

  const { data, error, isLoading, mutate } = useSWR<
    Record<string, GroupGrant[]>
  >(key, async () => {
    const results = await Promise.all(
      groupIds.map(async (id) => {
        const res = await fetch(`/api/access/groups/${id}/grants`);
        if (!res.ok) return [id, []] as const;
        const body = (await res.json()) as { grants: GroupGrant[] };
        return [id, body.grants] as const;
      }),
    );
    return Object.fromEntries(results);
  });

  return {
    grantsByGroup: data ?? {},
    isLoading,
    error,
    mutate,
  };
}
