"use client";

import { useResource } from "@/hooks/use-resource";
import { toast } from "@/lib/toast-utils";

/** Client shape of a test run (see lib/db/queries/runs.ts for the server type). */
export interface Run {
  id: string;
  org_id: string;
  name: string;
  source_id: string | null;
  status: "active" | "completed" | "aborted";
  started_at: string;
  ended_at: string | null;
  tags: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  pass_criteria: Array<{
    metric: string;
    operator: ">" | ">=" | "<" | "<=" | "=" | "!=";
    value: number;
    label?: string;
  }>;
  test_result: unknown;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateRunInput {
  name: string;
  source_id?: string | null;
  status?: Run["status"];
  started_at?: string;
  ended_at?: string | null;
  tags?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  pass_criteria?: Run["pass_criteria"];
}

export type UpdateRunInput = Partial<Omit<CreateRunInput, "source_id">>;

export interface UseRunsOptions {
  /** Filter to a single source (slug or UUID). */
  sourceId?: string;
  /** Filter by status. */
  status?: Run["status"];
  enabled?: boolean;
  /**
   * Override the API base path — e.g. `/api/shared/<token>/runs` on shared
   * dashboards (read-only; mutations 404 there, which shared UIs never call).
   */
  basePath?: string;
}

export interface UseRunsResult {
  runs: Run[];
  isLoading: boolean;
  error: Error | null;
  createRun: (input: CreateRunInput) => Promise<Run>;
  updateRun: (id: string, updates: UpdateRunInput) => Promise<Run>;
  deleteRun: (id: string) => Promise<void>;
  refresh: () => Promise<unknown>;
}

export function useRuns(opts: UseRunsOptions = {}): UseRunsResult {
  // Always fetch the unfiltered list: useResource builds mutation URLs as
  // `${path}/${id}`, so the path must stay query-free. Filters apply below —
  // run lists are small (<=100) and one shared cache key means the realtime
  // invalidation (prefix "/api/runs") revalidates every consumer at once.
  const r = useResource<Run, CreateRunInput, UpdateRunInput>({
    path: opts.basePath ?? "/api/runs",
    listKey: "runs",
    itemKey: "run",
    label: "run",
    enabled: opts.enabled !== false,
    toast,
    messages: {
      created: (input) => `Run "${input.name}" saved`,
      deleted: "Run deleted",
    },
  });

  return {
    runs: r.items,
    isLoading: r.isLoading,
    error: r.error ?? null,
    createRun: r.create,
    updateRun: (id, updates) => r.update(id, updates),
    deleteRun: r.remove,
    refresh: r.refresh,
  };
}
