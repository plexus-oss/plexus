"use client";

/**
 * Sources Hook
 *
 * Unified hook for managing all source types (devices, connections, tables).
 * Replaces use-fleet.ts and use-data-sources.ts with a single interface.
 */

import useSWR, { mutate as globalMutate } from "swr";
import { useCallback } from "react";
import { toast } from "sonner";
import type {
  Source,
  SourceType,
  SourceStatus,
  ConnectionType,
} from "@/lib/db/types";
import { fetcher } from "@/lib/fetcher";
import { optimisticMutation } from "./use-resource";

// Cached shape of every list key. Includes `undefined` so cache transforms
// can pass through keys that matched but have no data yet (e.g. a filtered
// view still loading) without fabricating an empty list for them.
type SourceList = { sources: Source[] } | undefined;

// =============================================================================
// Types
// =============================================================================

export interface UseSourcesOptions {
  /** Filter by source type(s) */
  type?: SourceType | SourceType[];
  /** Filter by status(es) */
  status?: SourceStatus | SourceStatus[];
  /** Search by slug or name */
  search?: string;
}

export interface CreateSourceInput {
  source_type: SourceType;
  slug: string;
  name?: string;
  description?: string;
  device_type?: string;
  connection_type?: ConnectionType;
  connectionString?: string;
  config?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  sshTunnel?: {
    enabled: boolean;
    host: string;
    port: number;
    username: string;
    authMethod: "private_key" | "password";
  };
  sshCredential?: string;
}

export interface UpdateSourceInput {
  name?: string;
  description?: string;
  device_type?: string;
  config?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface TestConnectionResult {
  success: boolean;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface SchemaInfo {
  tables: Array<{
    name: string;
    schema?: string;
    columns: Array<{
      name: string;
      type: string;
      nullable: boolean;
    }>;
    rowCount?: number;
  }>;
}

// =============================================================================
// Cache key matchers
// =============================================================================

// Matches `/api/sources` and `/api/sources?...` but not `/api/sources/{id}`.
// Used by optimistic mutations to update every cached list view.
function isSourceListKey(key: unknown): key is string {
  return (
    typeof key === "string" &&
    (key === "/api/sources" || key.startsWith("/api/sources?"))
  );
}

// =============================================================================
// Hook
// =============================================================================

export function useSourcesSwr(options?: UseSourcesOptions) {
  // Build query params
  const params = new URLSearchParams();

  if (options?.type) {
    const types = Array.isArray(options.type) ? options.type : [options.type];
    params.set("type", types.join(","));
  }

  if (options?.status) {
    const statuses = Array.isArray(options.status)
      ? options.status
      : [options.status];
    params.set("status", statuses.join(","));
  }

  if (options?.search) {
    params.set("search", options.search);
  }

  const queryString = params.toString();
  const url = `/api/sources${queryString ? `?${queryString}` : ""}`;

  const { data, error, isLoading, mutate } = useSWR<{ sources: Source[] }>(
    url,
    fetcher,
    {
      // Freshness comes from explicit mutate() after create/update/delete;
      // focus/reconnect revalidation stays disabled per the global SWR policy.
      dedupingInterval: 5000,
    },
  );

  const sources = data?.sources ?? [];

  // Filtered views
  const devices = sources.filter((s) => s.source_type === "device");
  const connections = sources.filter((s) => s.source_type === "connection");

  // Create source
  const createSource = useCallback(
    async (input: CreateSourceInput): Promise<Source> => {
      const res = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      const result = await res.json();

      if (!res.ok) {
        const errorMsg = result.error || "Failed to create source";
        toast.error(errorMsg);
        throw new Error(errorMsg);
      }

      toast.success(`Source "${input.slug}" created`);

      // Revalidate all source lists
      await globalMutate(
        (key) => typeof key === "string" && key.startsWith("/api/sources"),
      );
      await mutate();

      return result.source;
    },
    [mutate],
  );

  // Update source
  const updateSource = useCallback(
    async (id: string, updates: UpdateSourceInput): Promise<Source> => {
      const res = await fetch(`/api/sources/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      const result = await res.json();

      if (!res.ok) {
        const errorMsg = result.error || "Failed to update source";
        toast.error(errorMsg);
        throw new Error(errorMsg);
      }

      // Patch every cached list view from the response — no refetch needed.
      const updated: Source = result.source;
      await globalMutate(
        isSourceListKey,
        (current: SourceList) =>
          current
            ? {
                ...current,
                sources: current.sources.map((s) => (s.id === id ? updated : s)),
              }
            : current,
        { revalidate: false },
      );
      return updated;
    },
    [],
  );

  // Delete source — atomic optimistic removal from every cached list view:
  // items disappear immediately, SWR rolls each key back if the DELETE fails,
  // and concurrent revalidations can't resurrect them mid-request. Callers
  // can fire-and-forget and navigate immediately.
  const deleteSource = useCallback(async (id: string): Promise<void> => {
    // One DELETE shared by every matched key's mutation.
    const request = (async () => {
      const res = await fetch(`/api/sources/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const result = await res.json().catch(() => ({}));
        throw new Error(result.error || "Failed to delete source");
      }
    })();

    try {
      await globalMutate(
        isSourceListKey,
        ...optimisticMutation<SourceList>(
          (current) =>
            current
              ? {
                  ...current,
                  sources: current.sources.filter((s) => s.id !== id),
                }
              : current,
          () => request,
        ),
      );
      // Awaited directly too, in case no list key was cached (globalMutate
      // resolves without running the mutation when nothing matches).
      await request;
      toast.success("Source deleted");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete source",
      );
      throw error;
    }
  }, []);

  // Test connection (for connection sources)
  const testConnection = useCallback(
    async (id: string): Promise<TestConnectionResult> => {
      const res = await fetch(`/api/sources/${id}/test`, {
        method: "POST",
      });

      const result = await res.json();

      if (!res.ok) {
        const errorMsg = result.error || "Failed to test connection";
        toast.error(errorMsg);
        throw new Error(errorMsg);
      }

      if (result.success) {
        toast.success("Connection successful");
      } else {
        toast.error(result.error || "Connection failed");
      }

      await mutate();
      return result;
    },
    [mutate],
  );

  // Get schema (for connection sources)
  // Pass all=true to get all tables (used during initial setup)
  const getSchema = useCallback(async (id: string): Promise<SchemaInfo> => {
    const res = await fetch(`/api/sources/${id}/schema?all=true`);

    const result = await res.json();

    if (!res.ok) {
      const errorMsg = result.error || "Failed to get schema";
      toast.error(errorMsg);
      throw new Error(errorMsg);
    }

    return result.schema;
  }, []);

  // Get available metrics for a source
  const getSourceMetrics = useCallback(
    async (
      id: string,
    ): Promise<{ name: string; type?: string; table?: string }[]> => {
      const res = await fetch(`/api/sources/${id}/metrics`);
      if (!res.ok) return [];
      const result = await res.json();
      return result.metrics || [];
    },
    [],
  );

  const getDeviceSchema = useCallback(
    async (id: string): Promise<{ schemas: unknown[] } | null> => {
      const res = await fetch(`/api/devices/${id}/schema`);
      if (!res.ok) return null;
      return res.json();
    },
    [],
  );

  // Refresh and return fresh data
  const refresh = useCallback(async () => {
    const result = await mutate();
    return result?.sources ?? [];
  }, [mutate]);

  return {
    // Data
    sources,
    devices,
    connections,

    // State
    isLoading,
    error,

    // Actions
    createSource,
    updateSource,
    deleteSource,
    testConnection,
    getSchema,
    getSourceMetrics,
    getDeviceSchema,
    refresh,
  };
}

// =============================================================================
// Single Source Hook
// =============================================================================

export function useSourceSwr(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR<{ source: Source }>(
    id ? `/api/sources/${id}` : null,
    fetcher,
  );

  return {
    source: data?.source ?? null,
    isLoading,
    error,
    mutate,
  };
}

// =============================================================================
// Device Schema Hook
// =============================================================================

/**
 * Fetch a device's captured metric schemas by slug.
 *
 * The endpoint accepts either slug or UUID, so this hook can fire in
 * parallel with `useSource(slug)` instead of waiting on `source.id`.
 * That eliminates the schema fetch from the device-detail critical
 * path waterfall.
 */
export function useDeviceSchemaSwr(slug: string | null) {
  const { data, error, isLoading } = useSWR<{ schemas: unknown[] }>(
    slug ? `/api/devices/${slug}/schema` : null,
    fetcher,
  );

  return {
    schemas: data?.schemas ?? [],
    schemaCount: data?.schemas?.length ?? 0,
    isLoading,
    error,
  };
}
