"use client";

import type { SlackIntegrationPublic, WebhookEventType } from "@/lib/db/types";
import { useIntegrationsResource } from "@/hooks/use-integrations-resource";

interface UpdateSlackInput {
  enabled?: boolean;
  events?: WebhookEventType[];
}

/**
 * Hook for managing Slack integrations. Slack is connected via OAuth
 * (`connect` returns a redirect URL) rather than a create payload, so the
 * generic `createIntegration` is intentionally not exposed.
 */
export function useSlackIntegrations() {
  const base = useIntegrationsResource<
    SlackIntegrationPublic,
    never,
    UpdateSlackInput
  >("slack");

  /** Initiate Slack OAuth flow; returns the URL to redirect the user to. */
  const connect = async (): Promise<string> => {
    const res = await fetch("/api/integrations/slack", { method: "POST" });
    if (!res.ok) {
      const error = await res
        .json()
        .catch(() => ({ error: "Failed to connect" }));
      throw new Error(error.error || "Failed to initiate connection");
    }
    const { url } = await res.json();
    return url;
  };

  return {
    integrations: base.integrations,
    isLoading: base.isLoading,
    error: base.error,
    connect,
    updateIntegration: base.updateIntegration,
    toggleIntegration: base.toggleIntegration,
    deleteIntegration: base.deleteIntegration,
    testIntegration: base.testIntegration,
    refresh: base.refresh,
  };
}
