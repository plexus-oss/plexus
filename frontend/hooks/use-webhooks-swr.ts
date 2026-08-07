"use client";

/**
 * Webhooks Hook
 *
 * Manages webhook configurations: CRUD operations, testing, and delivery logs.
 * The list hook is a thin wrapper over the canonical `useResource` CRUD hook
 * (docs/STANDARDS.md §4); create stays bespoke (returns the one-time secret),
 * as do the single-webhook test hook and the polling delivery-log hook.
 */

import useSWR from "swr";
import { useCallback } from "react";
import { toast } from "sonner";
import type {
  Webhook,
  WebhookDelivery,
  WebhookEventType,
  WebhookSourceFilter,
} from "@/lib/db/types";
import { fetcher } from "@/lib/fetcher";
import { useResource } from "./use-resource";

// =============================================================================
// Types
// =============================================================================

export interface WebhookWithoutSecret extends Omit<Webhook, "secret"> {
  secretPrefix: string;
}

export interface CreateWebhookInput {
  name: string;
  description?: string;
  url: string;
  events: WebhookEventType[];
  sourceFilter?: WebhookSourceFilter;
  customHeaders?: Record<string, string>;
}

export interface UpdateWebhookInput {
  name?: string;
  description?: string;
  url?: string;
  events?: WebhookEventType[];
  sourceFilter?: WebhookSourceFilter | null;
  customHeaders?: Record<string, string>;
  enabled?: boolean;
}

export interface TestWebhookResult {
  success: boolean;
  responseStatus?: number;
  responseBody?: string;
  responseTimeMs?: number;
  error?: string;
  payload: unknown;
}

export interface DeliveryStats {
  total: number;
  delivered: number;
  failed: number;
  pending: number;
  avgResponseTime: number;
}

// =============================================================================
// Fetcher
// =============================================================================


// =============================================================================
// Hook: useWebhooks
// =============================================================================

export function useWebhooksSwr() {
  const r = useResource<WebhookWithoutSecret, CreateWebhookInput, UpdateWebhookInput>({
    path: "/api/webhooks",
    listKey: "webhooks",
    itemKey: "webhook",
    label: "webhook",
    cache: "revalidate",
    swr: { revalidateOnFocus: false, dedupingInterval: 5000 },
    toast,
    messages: {
      updated: "Webhook updated",
      deleted: "Webhook deleted",
    },
  });

  // Create stays bespoke: the response carries the one-time secret
  // ({ webhook, message }) and the success toast warns about saving it.
  const createWebhook = async (
    input: CreateWebhookInput,
  ): Promise<{ webhook: Webhook; message: string }> => {
    const res = await fetch("/api/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    const result = await res.json();

    if (!res.ok) {
      const errorMsg = result.error || "Failed to create webhook";
      toast.error(errorMsg);
      throw new Error(errorMsg);
    }

    toast.success(`Webhook "${input.name}" created`, {
      description: "Save the secret - it won't be shown again.",
    });
    await r.refresh();

    return result;
  };

  // Toggle is an update with its own toast copy
  const toggleWebhook = (
    id: string,
    enabled: boolean,
  ): Promise<WebhookWithoutSecret> =>
    r.update(id, { enabled }, {
      success: enabled ? "Webhook enabled" : "Webhook disabled",
      fallback: "Failed to toggle webhook",
    });

  const refresh = async () => {
    await r.refresh();
  };

  return {
    webhooks: r.items,
    isLoading: r.isLoading,
    error: r.error,
    createWebhook,
    updateWebhook: r.update,
    toggleWebhook,
    deleteWebhook: r.remove,
    refresh,
  };
}

// =============================================================================
// Hook: useWebhook (single webhook)
// =============================================================================

export function useWebhookSwr(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR<{
    webhook: WebhookWithoutSecret;
  }>(id ? `/api/webhooks/${id}` : null, fetcher, {
    revalidateOnFocus: false,
  });

  // Test webhook
  const testWebhook = useCallback(async (): Promise<TestWebhookResult> => {
    if (!id) throw new Error("No webhook ID");

    const res = await fetch(`/api/webhooks/${id}/test`, {
      method: "POST",
    });

    const result = await res.json();

    if (!res.ok) {
      const errorMsg = result.error || "Failed to send test webhook";
      toast.error(errorMsg);
      throw new Error(errorMsg);
    }

    if (result.success) {
      toast.success("Test webhook delivered", {
        description: `Response: ${result.responseStatus} (${result.responseTimeMs}ms)`,
      });
    } else {
      toast.error("Test webhook failed", {
        description: result.error || "Unknown error",
      });
    }

    return result;
  }, [id]);

  return {
    webhook: data?.webhook ?? null,
    isLoading,
    error,
    testWebhook,
    mutate,
  };
}

// =============================================================================
// Hook: useWebhookLogs (delivery history)
// =============================================================================

export function useWebhookLogsSwr(
  webhookId: string | null,
  options?: {
    status?: string;
    limit?: number;
    offset?: number;
  }
) {
  const params = new URLSearchParams();
  if (options?.status) params.set("status", options.status);
  if (options?.limit) params.set("limit", options.limit.toString());
  if (options?.offset) params.set("offset", options.offset.toString());

  const queryString = params.toString();
  const url = webhookId
    ? `/api/webhooks/${webhookId}/logs${queryString ? `?${queryString}` : ""}`
    : null;

  const { data, error, isLoading, mutate } = useSWR<{
    deliveries: WebhookDelivery[];
    stats: DeliveryStats;
    pagination: {
      limit: number;
      offset: number;
      hasMore: boolean;
    };
  }>(url, fetcher, {
    revalidateOnFocus: false,
    refreshInterval: 10000, // Poll for updates
  });

  return {
    deliveries: data?.deliveries ?? [],
    stats: data?.stats ?? null,
    pagination: data?.pagination ?? null,
    isLoading,
    error,
    refresh: mutate,
  };
}
