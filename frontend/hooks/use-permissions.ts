"use client";

/**
 * Client-side permission hook.
 *
 * Fetches the permission catalog + the org's custom roles once (SWR dedups
 * across components; OrgCacheBuster invalidates `/api/*` on org switch) and
 * exposes a `can(actionId)` resolver that mirrors the server: built-in roles
 * answer from manifest thresholds, custom roles from their exception set.
 *
 * NOTE: this gates UI only. The real boundary is server-side withPermission /
 * requirePermission. Never rely on `can()` to protect data.
 */

import useSWR from "swr";
import { usePlexusSession } from "@/hooks/use-plexus-session";
import { useCallback, useMemo } from "react";
import { useRole } from "./use-role";
import {
  canFor,
  type AccessCatalog,
  type CustomRoleDef,
} from "@/lib/access/resolver";
import type { ActionId } from "@/lib/manifest/types";

interface RolesResponse {
  catalog: AccessCatalog;
  customRoles: CustomRoleDef[];
  callerRoleId: string | null;
  /** True when the caller has a visibility scope (restricted allow-list). */
  scoped?: boolean;
}

const fetcher = async (url: string): Promise<RolesResponse> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to load permissions");
  return res.json();
};

export function usePermissions() {
  const { orgId } = usePlexusSession();
  const { role } = useRole();

  const { data, error, mutate, isLoading } = useSWR<RolesResponse>(
    orgId ? "/api/access/roles" : null,
    fetcher,
  );

  const customRoles = useMemo(() => {
    const map: Record<string, CustomRoleDef> = {};
    for (const r of data?.customRoles ?? []) map[r.id] = r;
    return map;
  }, [data?.customRoles]);

  const callerRoleId = data?.callerRoleId ?? null;

  const can = useCallback(
    (actionId: ActionId) =>
      canFor({ base: role, roleId: callerRoleId }, actionId, customRoles),
    [role, callerRoleId, customRoles],
  );

  return {
    can,
    catalog: data?.catalog,
    /** The org's custom roles, keyed by id. */
    customRoles,
    /** The caller's custom role id, if they hold one. */
    callerRoleId,
    /** True when the caller's visibility is scope-restricted. */
    scoped: data?.scoped ?? false,
    isLoading: orgId ? isLoading : false,
    isError: !!error,
    mutate,
  };
}
