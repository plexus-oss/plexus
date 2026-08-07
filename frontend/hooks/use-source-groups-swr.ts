"use client";

/**
 * Source Groups Hook
 *
 * Manages source groups (renamed from device groups) for fleet management.
 * Thin wrapper over the canonical `useResource` CRUD hook
 * (docs/STANDARDS.md §4).
 */

import { toast } from "sonner";
import type {
  SourceGroup,
  SourceGroupWithMembers,
  SourceGroupFilterCriteria,
  SourceType,
} from "@/lib/db/types";
import { useResource } from "./use-resource";

export interface CreateGroupInput {
  name: string;
  description?: string;
  filterCriteria?: SourceGroupFilterCriteria;
  staticMemberIds?: string[];
  color?: string;
  icon?: string;
  sourceTypes?: SourceType[];
}

export interface UpdateGroupInput {
  name?: string;
  description?: string;
  filterCriteria?: SourceGroupFilterCriteria;
  staticMemberIds?: string[];
  color?: string;
  icon?: string;
  sourceTypes?: SourceType[];
}

export function useSourceGroupsSwr() {
  const r = useResource<
    SourceGroupWithMembers,
    CreateGroupInput,
    UpdateGroupInput,
    SourceGroup & { memberCount: number }
  >({
    path: "/api/sources/groups",
    listKey: "groups",
    itemKey: "group",
    label: "group",
    cache: "revalidate",
    swr: { revalidateOnFocus: false, dedupingInterval: 5000 },
    toast,
    messages: {
      created: (input) => `Group "${input.name}" created`,
      updated: "Group updated",
      deleted: "Group deleted",
    },
  });

  const refresh = async () => {
    await r.refresh();
  };

  return {
    groups: r.items,
    isLoading: r.isLoading,
    error: r.error,
    createGroup: r.create,
    updateGroup: r.update,
    deleteGroup: r.remove,
    refresh,
  };
}
