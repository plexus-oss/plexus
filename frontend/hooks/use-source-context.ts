"use client";

/**
 * Source Context Hook
 *
 * Hook for managing context attachments (files, links, notes) for sources.
 */

import useSWR from "swr";
import { useCallback } from "react";
import { toast } from "sonner";
import type { SourceContext, SourceContextType } from "@/lib/db/types";
import { fetcher } from "@/lib/fetcher";

// =============================================================================
// Types
// =============================================================================

export interface CreateLinkInput {
  name: string;
  description?: string;
  link_url: string;
}

export interface CreateNoteInput {
  name: string;
  description?: string;
  content: string;
}

export interface UpdateContextInput {
  name?: string;
  description?: string;
  content?: string;
  link_url?: string;
}

// =============================================================================
// Fetcher
// =============================================================================


// =============================================================================
// Hook
// =============================================================================

export function useSourceContext(
  sourceId: string | null,
  type?: SourceContextType
) {
  // Build URL with optional type filter
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  const queryString = params.toString();

  const url = sourceId
    ? `/api/sources/${sourceId}/context${queryString ? `?${queryString}` : ""}`
    : null;

  const { data, error, isLoading, mutate } = useSWR<{
    context: SourceContext[];
  }>(url, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 5000,
  });

  const context = data?.context ?? [];

  // Group by type for convenience
  const files = context.filter((c) => c.context_type === "file");
  const links = context.filter((c) => c.context_type === "link");
  const notes = context.filter((c) => c.context_type === "note");

  // Create link
  const createLink = useCallback(
    async (input: CreateLinkInput): Promise<SourceContext | null> => {
      if (!sourceId) return null;

      try {
        const res = await fetch(`/api/sources/${sourceId}/context`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ context_type: "link", ...input }),
        });

        const result = await res.json();

        if (!res.ok) {
          toast.error(result.error || "Failed to add link");
          return null;
        }

        toast.success("Link added");
        await mutate();
        return result.contextItem;
      } catch (err) {
        toast.error("Failed to add link");
        console.error("Error creating link:", err);
        return null;
      }
    },
    [sourceId, mutate]
  );

  // Create note
  const createNote = useCallback(
    async (input: CreateNoteInput): Promise<SourceContext | null> => {
      if (!sourceId) return null;

      try {
        const res = await fetch(`/api/sources/${sourceId}/context`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ context_type: "note", ...input }),
        });

        const result = await res.json();

        if (!res.ok) {
          toast.error(result.error || "Failed to add note");
          return null;
        }

        toast.success("Note added");
        await mutate();
        return result.contextItem;
      } catch (err) {
        toast.error("Failed to add note");
        console.error("Error creating note:", err);
        return null;
      }
    },
    [sourceId, mutate]
  );

  // Upload file
  const uploadFile = useCallback(
    async (
      file: File,
      name?: string,
      description?: string
    ): Promise<SourceContext | null> => {
      if (!sourceId) return null;

      try {
        const formData = new FormData();
        formData.append("file", file);
        if (name) formData.append("name", name);
        if (description) formData.append("description", description);

        const res = await fetch(`/api/sources/${sourceId}/context/upload`, {
          method: "POST",
          body: formData,
        });

        const result = await res.json();

        if (!res.ok) {
          toast.error(result.error || "Failed to upload file");
          return null;
        }

        toast.success("File uploaded");
        await mutate();
        return result.contextItem;
      } catch (err) {
        toast.error("Failed to upload file");
        console.error("Error uploading file:", err);
        return null;
      }
    },
    [sourceId, mutate]
  );

  // Update context item
  const updateContext = useCallback(
    async (
      contextId: string,
      updates: UpdateContextInput
    ): Promise<SourceContext | null> => {
      if (!sourceId) return null;

      try {
        const res = await fetch(
          `/api/sources/${sourceId}/context/${contextId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updates),
          }
        );

        const result = await res.json();

        if (!res.ok) {
          toast.error(result.error || "Failed to update");
          return null;
        }

        await mutate();
        return result.contextItem;
      } catch (err) {
        toast.error("Failed to update");
        console.error("Error updating context:", err);
        return null;
      }
    },
    [sourceId, mutate]
  );

  // Delete context item
  const deleteContext = useCallback(
    async (contextId: string): Promise<boolean> => {
      if (!sourceId) return false;

      try {
        const res = await fetch(
          `/api/sources/${sourceId}/context/${contextId}`,
          {
            method: "DELETE",
          }
        );

        if (!res.ok) {
          const result = await res.json().catch(() => ({}));
          toast.error(result.error || "Failed to delete");
          return false;
        }

        toast.success("Deleted");
        await mutate();
        return true;
      } catch (err) {
        toast.error("Failed to delete");
        console.error("Error deleting context:", err);
        return false;
      }
    },
    [sourceId, mutate]
  );

  // Get download URL for file
  const getDownloadUrl = useCallback(
    async (contextId: string): Promise<string | null> => {
      if (!sourceId) return null;

      try {
        const res = await fetch(
          `/api/sources/${sourceId}/context/${contextId}`
        );
        const result = await res.json();

        if (!res.ok) {
          console.error("Error fetching download URL:", result.error);
          return null;
        }

        return result.contextItem.download_url || result.contextItem.file_url;
      } catch (err) {
        console.error("Error fetching download URL:", err);
        return null;
      }
    },
    [sourceId]
  );

  return {
    // Data
    context,
    files,
    links,
    notes,

    // State
    isLoading,
    error,

    // Actions
    createLink,
    createNote,
    uploadFile,
    updateContext,
    deleteContext,
    getDownloadUrl,

    // SWR
    refresh: mutate,
  };
}
