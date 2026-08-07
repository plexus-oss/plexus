"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import type { ColumnMetadataRecord, ColumnSuggestion } from "@/lib/db/types";
import type {
  UpsertColumnMetadata,
  SuggestColumns,
} from "@/lib/validation/api-schemas";

/**
 * Column annotations for a source's Data tab.
 *
 * Mirrors hooks/use-integrations-resource.ts: an SWR list keyed by source, a
 * `byKey` Map for O(1) header lookup, and optimistic mutations that patch the
 * cache then revalidate in the background.
 *
 * column_key is the metric name (devices) or "table.column" (connections). It
 * is URL-encoded on write because connection keys contain dots.
 */

interface ColumnsResponse {
  columns: ColumnMetadataRecord[];
}

async function failFrom(res: Response, fallback: string): Promise<never> {
  const body = await res.json().catch(() => ({ error: fallback }));
  throw new Error(body.error || fallback);
}

export function useColumnMetadata(sourceId: string | null | undefined) {
  const base = sourceId ? `/api/sources/${sourceId}/columns` : null;
  const { data, error, isLoading, mutate } = useSWR<ColumnsResponse>(
    base,
    fetcher,
  );

  const columns = useMemo(() => data?.columns ?? [], [data]);

  const byKey = useMemo(
    () => new Map(columns.map((c) => [c.column_key, c])),
    [columns],
  );

  const upsertColumn = async (
    columnKey: string,
    patch: UpsertColumnMetadata,
  ): Promise<ColumnMetadataRecord> => {
    if (!base) throw new Error("No source selected");
    const res = await fetch(`${base}/${encodeURIComponent(columnKey)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) await failFrom(res, "Failed to save column metadata");
    const { column } = await res.json();
    mutate((current) => {
      const list = current?.columns ?? [];
      const i = list.findIndex((c) => c.column_key === columnKey);
      return {
        columns:
          i >= 0
            ? list.map((c) => (c.column_key === columnKey ? column : c))
            : [...list, column],
      };
    }, false);
    return column;
  };

  const removeColumn = async (columnKey: string): Promise<void> => {
    if (!base) throw new Error("No source selected");
    const res = await fetch(`${base}/${encodeURIComponent(columnKey)}`, {
      method: "DELETE",
    });
    if (!res.ok) await failFrom(res, "Failed to clear column metadata");
    mutate(
      (current) => ({
        columns: (current?.columns ?? []).filter(
          (c) => c.column_key !== columnKey,
        ),
      }),
      false,
    );
  };

  const applySuggestions = async (
    rows: Array<{ column_key: string } & UpsertColumnMetadata>,
  ): Promise<ColumnMetadataRecord[]> => {
    if (!base) throw new Error("No source selected");
    const res = await fetch(base, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columns: rows }),
    });
    if (!res.ok) await failFrom(res, "Failed to apply suggestions");
    const { columns: saved } = await res.json();
    mutate((current) => {
      const map = new Map(
        (current?.columns ?? []).map((c) => [c.column_key, c]),
      );
      for (const c of saved as ColumnMetadataRecord[]) map.set(c.column_key, c);
      return { columns: Array.from(map.values()) };
    }, false);
    return saved;
  };

  const suggest = async (
    cols: SuggestColumns["columns"],
  ): Promise<ColumnSuggestion[]> => {
    if (!base) throw new Error("No source selected");
    const res = await fetch(`${base}/suggest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columns: cols }),
    });
    if (!res.ok) await failFrom(res, "Suggestion failed");
    const { suggestions } = await res.json();
    return suggestions;
  };

  return {
    columns,
    byKey,
    isLoading,
    error,
    upsertColumn,
    removeColumn,
    applySuggestions,
    suggest,
    refresh: mutate,
  };
}
