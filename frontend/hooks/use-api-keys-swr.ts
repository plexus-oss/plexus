import useSWR from "swr";
import { usePlexusSession } from "@/hooks/use-plexus-session";
import { useCallback } from "react";
import { toast } from "@/lib/toast-utils";

export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
  // Computed: key is active if it hasn't expired
  active: boolean;
}

export interface CreateApiKeyResponse {
  key: ApiKey & { secret: string };
  message: string;
}

export function useApiKeysSwr() {
  const { orgId } = usePlexusSession();

  const { data, error, mutate } = useSWR(
    orgId ? "/api/api-keys" : null,
    async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch API keys");
      const result = await response.json();
      // Add computed 'active' field - key is active if not expired
      const keys = result.keys.map((key: Omit<ApiKey, "active">) => ({
        ...key,
        active: !key.expiresAt || new Date(key.expiresAt) > new Date(),
      }));
      return { keys };
    },
  );

  const createKey = useCallback(
    async (
      name: string,
      scopes?: string[],
      expiresAt?: string,
    ): Promise<CreateApiKeyResponse> => {
      try {
        const response = await fetch("/api/api-keys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, scopes, expires_at: expiresAt }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to create API key");
        }

        const result = await response.json();
        await mutate();
        return result;
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to create API key",
        );
        throw error;
      }
    },
    [mutate],
  );

  const revokeKey = useCallback(
    async (id: string): Promise<void> => {
      try {
        await mutate(
          async (current) => {
            const response = await fetch(`/api/api-keys/${id}`, {
              method: "DELETE",
            });

            if (!response.ok) {
              const error = await response.json();
              throw new Error(error.error || "Failed to revoke API key");
            }

            return {
              keys: current?.keys?.filter((k: ApiKey) => k.id !== id) || [],
            };
          },
          {
            optimisticData: (current) => ({
              keys: current?.keys?.filter((k: ApiKey) => k.id !== id) || [],
            }),
            rollbackOnError: true,
            revalidate: false,
          },
        );
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to revoke API key",
        );
        throw error;
      }
    },
    [mutate],
  );

  return {
    keys: (data?.keys || []) as ApiKey[],
    isLoading: orgId ? !error && !data : false,
    isError: error,
    createKey,
    revokeKey,
    mutate,
  };
}
