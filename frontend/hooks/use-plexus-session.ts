"use client";

/**
 * Client session hook — SWR over GET /api/me (backed by getAuth() + the
 * users table).
 *
 * getGatewayToken: POST /api/auth/ws-token mints a short-lived signed
 * token the gateway resolves via /api/auth/verify-session.
 */

import useSWR from "swr";
import { authjsSignOut } from "@/lib/auth/authjs-client";

export interface PlexusSessionState {
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
  orgId: string | null;
  /** Base built-in role (custom roles resolve to their base). */
  orgRole: string | null;
  /** Custom role id when the member holds one. */
  roleId: string | null;
  /** Custom role display name, when held. */
  roleName: string | null;
  email: string | null;
  firstName: string | null;
  name: string | null;
  imageUrl: string | null;
  isStaff: boolean;
  /** Set while a staff user is impersonating another org. */
  impersonatingOrg: { id: string; name: string } | null;
  /** Short-lived token for the gateway WebSocket handshake. */
  getGatewayToken: () => Promise<string | null>;
  /** End the session and land on /sign-in. */
  signOut: () => Promise<void>;
}

async function fetchGatewayToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/ws-token", { method: "POST" });
    if (!res.ok) return null;
    const body = (await res.json()) as { token?: unknown };
    return typeof body.token === "string" ? body.token : null;
  } catch {
    return null;
  }
}

interface MeResponse {
  userId: string | null;
  orgId: string | null;
  orgRole: string | null;
  roleId: string | null;
  roleName: string | null;
  email: string | null;
  firstName: string | null;
  name: string | null;
  imageUrl: string | null;
  isStaff: boolean;
  impersonatingOrg: { id: string; name: string } | null;
}

export function usePlexusSession(): PlexusSessionState {
  const { data, isLoading } = useSWR<MeResponse>(
    "/api/me",
    (url: string) => fetch(url).then((r) => (r.ok ? r.json() : null)),
    { revalidateOnFocus: false, dedupingInterval: 30_000 },
  );

  return {
    isLoaded: !isLoading,
    isSignedIn: !!data?.userId,
    userId: data?.userId ?? null,
    orgId: data?.orgId ?? null,
    orgRole: data?.orgRole ?? null,
    roleId: data?.roleId ?? null,
    roleName: data?.roleName ?? null,
    email: data?.email ?? null,
    firstName: data?.firstName ?? null,
    name: data?.name ?? null,
    imageUrl: data?.imageUrl ?? null,
    isStaff: data?.isStaff === true,
    impersonatingOrg: data?.impersonatingOrg ?? null,
    getGatewayToken: fetchGatewayToken,
    signOut: () => authjsSignOut("/sign-in"),
  };
}
