"use client";

import { useCallback, useMemo } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { toast } from "@/lib/toast-utils";
import type { Annotation } from "@/lib/db/types";

export interface UseAnnotationsOptions {
  sourceId?: string;
  start?: string;
  end?: string;
  enabled?: boolean;
}

export function useAnnotationsSwr(options: UseAnnotationsOptions = {}) {
  const { sourceId, start, end, enabled = true } = options;

  // Build URL with query params
  const params = new URLSearchParams();
  if (sourceId) params.set("sourceId", sourceId);
  if (start) params.set("start", start);
  if (end) params.set("end", end);

  const url = enabled ? `/api/annotations?${params.toString()}` : null;

  const { data, error, isLoading, mutate } = useSWR<{
    annotations: Annotation[];
  }>(url, fetcher, { revalidateOnFocus: false, dedupingInterval: 5000 });

  const annotations = useMemo(() => data?.annotations || [], [data]);

  const createAnnotation = useCallback(
    async (input: {
      source_id: string;
      timestamp_start: string;
      timestamp_end?: string | null;
      label: string;
      color?: string;
      notes?: string | null;
      metric_name?: string | null;
    }) => {
      // Optimistic update
      const tempId = `temp-${Date.now()}`;
      const optimistic: Annotation = {
        id: tempId,
        org_id: "",
        source_type: "device",
        source_id: input.source_id,
        telemetry_id: null,
        timestamp_start: input.timestamp_start,
        timestamp_end: input.timestamp_end || null,
        metric_name: input.metric_name || null,
        value_snapshot: null,
        label: input.label,
        notes: input.notes || null,
        color: input.color || "amber",
        run_id: null,
        created_by: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      await mutate(
        async () => {
          const res = await fetch("/api/annotations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || "Failed to create annotation");
          }
          const result = await res.json();
          return {
            annotations: [
              ...annotations.filter((a) => a.id !== tempId),
              result.annotation,
            ],
          };
        },
        {
          optimisticData: { annotations: [...annotations, optimistic] },
          revalidate: false,
          rollbackOnError: true,
        },
      );

      toast.success("Annotation saved");
    },
    [annotations, mutate],
  );

  const updateAnnotation = useCallback(
    async (
      id: string,
      updates: {
        label?: string;
        color?: string;
        notes?: string | null;
        timestamp_start?: string;
        timestamp_end?: string | null;
      },
    ) => {
      await mutate(
        async () => {
          const res = await fetch(`/api/annotations/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updates),
          });
          if (!res.ok) throw new Error("Failed to update annotation");
          const result = await res.json();
          return {
            annotations: annotations.map((a) =>
              a.id === id ? result.annotation : a,
            ),
          };
        },
        {
          optimisticData: {
            annotations: annotations.map((a) =>
              a.id === id ? { ...a, ...updates } : a,
            ),
          },
          revalidate: false,
          rollbackOnError: true,
        },
      );
    },
    [annotations, mutate],
  );

  const deleteAnnotation = useCallback(
    async (id: string) => {
      await mutate(
        async () => {
          const res = await fetch(`/api/annotations/${id}`, {
            method: "DELETE",
          });
          if (!res.ok) throw new Error("Failed to delete annotation");
          return { annotations: annotations.filter((a) => a.id !== id) };
        },
        {
          optimisticData: {
            annotations: annotations.filter((a) => a.id !== id),
          },
          revalidate: false,
          rollbackOnError: true,
        },
      );

      toast.success("Annotation deleted");
    },
    [annotations, mutate],
  );

  return {
    annotations,
    isLoading,
    error,
    mutate,
    createAnnotation,
    updateAnnotation,
    deleteAnnotation,
  };
}
