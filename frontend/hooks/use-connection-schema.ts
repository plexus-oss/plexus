"use client";

/**
 * Connection Schema Hook
 *
 * Fetch available tables and columns from a connection source.
 */

import useSWR from "swr";
import { useMemo } from "react";

// =============================================================================
// Types
// =============================================================================

export interface SchemaColumn {
  name: string;
  type: string;
  nullable?: boolean;
  /** True when this column is part of the table's primary key (Postgres/Timescale only). */
  isPrimaryKey?: boolean;
  /** Declared foreign-key target, when the driver exposes it (Postgres/Timescale only). */
  foreignKey?: { table: string; column: string } | null;
}

export interface SchemaTable {
  name: string;
  schema?: string;
  columns: SchemaColumn[];
}

export interface SchemaInfo {
  tables: SchemaTable[];
}

// =============================================================================
// Fetcher
// =============================================================================

const PLEXUS_SOURCE_ID = "__plexus__";

const schemaFetcher = async (
  sourceId: string,
  showAll?: boolean,
): Promise<SchemaInfo> => {
  let url =
    sourceId === PLEXUS_SOURCE_ID
      ? "/api/telemetry/connection/schema"
      : `/api/sources/${sourceId}/schema`;

  if (showAll && sourceId !== PLEXUS_SOURCE_ID) {
    url += "?all=true";
  }

  const res = await fetch(url);

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(error.error || "Failed to fetch schema");
  }

  const data = await res.json();
  return data.schema;
};

// =============================================================================
// Hook
// =============================================================================

export interface UseConnectionSchemaOptions {
  showAll?: boolean;
}

export function useConnectionSchema(
  sourceId: string | null,
  options?: UseConnectionSchemaOptions,
) {
  const showAll = options?.showAll;
  const { data, error, isLoading, mutate } = useSWR<SchemaInfo>(
    sourceId ? `connection-schema-${sourceId}${showAll ? "-all" : ""}` : null,
    () => schemaFetcher(sourceId!, showAll),
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000, // Cache for 1 minute
    },
  );

  const tables = useMemo(() => data?.tables ?? [], [data]);

  return {
    schema: data ?? null,
    tables,
    isLoading,
    error,
    mutate,
  };
}
