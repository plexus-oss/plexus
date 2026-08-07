"use client";

import type { EmailIntegrationPublic, WebhookEventType } from "@/lib/db/types";
import { useIntegrationsResource } from "@/hooks/use-integrations-resource";

export interface CreateEmailInput {
  name: string;
  emailAddress: string;
  events?: WebhookEventType[];
}

export interface UpdateEmailInput {
  name?: string;
  emailAddress?: string;
  enabled?: boolean;
  events?: WebhookEventType[];
}

/** Hook for managing email integrations. */
export function useEmailIntegrations() {
  const base = useIntegrationsResource<
    EmailIntegrationPublic,
    CreateEmailInput,
    UpdateEmailInput
  >("email");

  /** Create several integrations in sequence (e.g. paste-a-list onboarding). */
  const createMultiple = async (
    inputs: CreateEmailInput[],
  ): Promise<EmailIntegrationPublic[]> => {
    const results: EmailIntegrationPublic[] = [];
    for (const input of inputs) {
      results.push(await base.createIntegration(input));
    }
    return results;
  };

  return { ...base, createMultiple };
}
