"use client";

import { useResource } from "@/hooks/use-resource";

/**
 * Generic CRUD for an `/api/integrations/{provider}` resource.
 *
 * Every integration provider (Slack, email, …) exposes the same
 * shape — a list endpoint plus create / update / toggle / delete / test — so
 * this is a thin wrapper over the canonical `useResource` CRUD hook
 * (docs/STANDARDS.md §4). Per-provider hooks supply the provider slug and
 * their concrete create/update payload types, and graft on anything
 * provider-specific (e.g. Slack's OAuth `connect`).
 *
 * All mutations optimistically patch the SWR cache (prepend / replace /
 * filter); `refresh` revalidates on demand. No toasts — callers handle UX.
 */

interface IntegrationBase {
  id: string;
}

export interface TestResult {
  success: boolean;
  message?: string;
  error?: string;
  responseTimeMs?: number;
}

export function useIntegrationsResource<
  T extends IntegrationBase,
  TCreate = unknown,
  TUpdate extends { enabled?: boolean } = { enabled?: boolean },
>(provider: string) {
  const base = `/api/integrations/${provider}`;
  const r = useResource<T, TCreate, TUpdate>({
    path: base,
    listKey: "integrations",
    itemKey: "integration",
    label: "integration",
  });

  const toggleIntegration = (id: string, enabled: boolean): Promise<T> =>
    r.update(id, { enabled } as TUpdate);

  const testIntegration = async (id: string): Promise<TestResult> => {
    const res = await fetch(`${base}/${id}/test`, { method: "POST" });
    const result = await res.json();
    if (!res.ok && !result.success) {
      throw new Error(result.error || "Test failed");
    }
    return result;
  };

  return {
    integrations: r.items,
    isLoading: r.isLoading,
    error: r.error,
    createIntegration: r.create,
    updateIntegration: r.update,
    toggleIntegration,
    deleteIntegration: r.remove,
    testIntegration,
    refresh: r.refresh,
  };
}
