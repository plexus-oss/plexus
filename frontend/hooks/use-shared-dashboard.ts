"use client";

/**
 * Shared Dashboard Hook
 *
 * Fetches shared dashboards (public, no auth required).
 * Handles password-protected dashboards.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { DashboardConfig } from "@/lib/types/dashboard";

export interface SharedDashboardData {
  dashboard: {
    id: string;
    name: string;
    description: string | null;
    icon: string | null;
    icon_url: string | null;
    config: DashboardConfig;
  };
  shareLink: {
    id: string;
    accessLevel: string;
    name: string | null;
    isPasswordProtected?: boolean;
    orgId?: string;
  };
  sessionId: string;
}

interface UseSharedDashboardResult {
  data: SharedDashboardData | null;
  error: string | null;
  isLoading: boolean;
  requiresPassword: boolean;
  shareLinkName: string | null;
  passwordError: string | null;
  fetchWithPassword: (password: string) => Promise<void>;
  sessionIdRef: React.RefObject<string | null>;
  startTimeRef: React.RefObject<number>;
}

export function useSharedDashboard(token: string): UseSharedDashboardResult {
  const [data, setData] = useState<SharedDashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [shareLinkName, setShareLinkName] = useState<string | null>(null);
  const [initialStartTime] = useState(() => Date.now());
  const startTimeRef = useRef<number>(initialStartTime);
  const sessionIdRef = useRef<string | null>(null);

  const fetchDashboard = useCallback(
    async (passwordAttempt?: string) => {
      try {
        setIsLoading(true);
        setPasswordError(null);

        const url = passwordAttempt
          ? `/api/shared/${token}?password=${encodeURIComponent(passwordAttempt)}`
          : `/api/shared/${token}`;

        const res = await fetch(url);
        const result = await res.json();

        if (result.requiresPassword) {
          setRequiresPassword(true);
          setShareLinkName(result.shareLink?.name || null);
          setIsLoading(false);
          return;
        }

        if (!res.ok) {
          if (res.status === 401) {
            setPasswordError("Incorrect password");
            setIsLoading(false);
            return;
          }
          setError(result.error || "Failed to load dashboard");
          setIsLoading(false);
          return;
        }

        setData(result);
        setRequiresPassword(false);
        sessionIdRef.current = result.sessionId;
        startTimeRef.current = Date.now();
      } catch {
        setError("Failed to load dashboard");
      } finally {
        setIsLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    // Wrap in an async IIFE so the setState calls inside the fetch run
    // asynchronously (after the await), not synchronously within the effect.
    void (async () => {
      await fetchDashboard();
    })();
  }, [fetchDashboard]);

  const fetchWithPassword = useCallback(
    async (password: string) => {
      await fetchDashboard(password);
    },
    [fetchDashboard],
  );

  return {
    data,
    error,
    isLoading,
    requiresPassword,
    shareLinkName,
    passwordError,
    fetchWithPassword,
    sessionIdRef,
    startTimeRef,
  };
}
