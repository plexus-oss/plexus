"use client";

/**
 * Org membership management for the members settings surface, backed by
 * /api/org/members, /api/org/invites, /api/org/members/[id].
 */

import useSWR from "swr";
import { useMyOrgs } from "@/hooks/use-my-orgs";

export interface MemberEntry {
  /** Mutation handle — the member's user id. */
  id: string;
  userId: string | null;
  name: string;
  email: string;
  imageUrl: string | null;
  role: string;
  /** null = full org access; array (incl. empty) = restricted to these source ids. */
  allowedSourceIds: string[] | null;
}

export interface InviteEntry {
  id: string;
  email: string;
  role: string;
}

export interface OrgMembershipApi {
  isLoading: boolean;
  orgName: string | null;
  members: MemberEntry[];
  invitations: InviteEntry[];
  invite: (
    email: string,
    role: string,
    scope?: {
      /** null = full access; array (incl. empty) = restricted allow-list. */
      allowedSourceIds: string[] | null;
    },
  ) => Promise<{ ok: boolean; error?: string }>;
  updateRole: (
    memberId: string,
    role: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  /** Set source scoping: null = full access, array (incl. empty) = restricted. */
  updateScope: (
    memberId: string,
    allowedSourceIds: string[] | null,
  ) => Promise<{ ok: boolean; error?: string }>;
  removeMember: (memberId: string) => Promise<{ ok: boolean; error?: string }>;
  revokeInvitation: (
    inviteId: string,
  ) => Promise<{ ok: boolean; error?: string }>;
}

const jsonFetcher = (url: string) =>
  fetch(url).then((r) => (r.ok ? r.json() : null));

async function mutate(
  url: string,
  method: string,
  body?: unknown,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    return { ok: false, error: data?.error ?? "Request failed" };
  } catch {
    return { ok: false, error: "Request failed" };
  }
}

export function useOrgMembership(): OrgMembershipApi {
  const { activeOrgId, orgs } = useMyOrgs();
  const membersSwr = useSWR<{
    members: Array<{
      userId: string;
      email: string | null;
      name: string;
      imageUrl: string | null;
      role: string;
      allowedSourceIds: string[] | null;
    }>;
  }>("/api/org/members", jsonFetcher);
  // Admin-only endpoint; non-admins get null and the UI hides the section.
  const invitesSwr = useSWR<{
    invites: Array<{ id: string; email: string; role: string }>;
  }>("/api/org/invites", jsonFetcher);

  const refresh = () => {
    membersSwr.mutate();
    invitesSwr.mutate();
  };

  return {
    isLoading: membersSwr.isLoading || invitesSwr.isLoading,
    orgName: orgs.find((o) => o.orgId === activeOrgId)?.name ?? null,
    members: (membersSwr.data?.members ?? []).map((m) => ({
      id: m.userId,
      userId: m.userId,
      name: m.name,
      email: m.email ?? "",
      imageUrl: m.imageUrl,
      role: m.role,
      allowedSourceIds: m.allowedSourceIds ?? null,
    })),
    invitations: invitesSwr.data?.invites ?? [],
    invite: async (email, role, scope) => {
      const result = await mutate("/api/org/invites", "POST", {
        email,
        role,
        allowedSourceIds: scope?.allowedSourceIds ?? null,
      });
      if (result.ok) refresh();
      return result;
    },
    updateRole: async (memberId, role) => {
      const result = await mutate(`/api/org/members/${memberId}`, "PATCH", {
        role,
      });
      if (result.ok) refresh();
      return result;
    },
    updateScope: async (memberId, allowedSourceIds) => {
      const result = await mutate(`/api/org/members/${memberId}`, "PATCH", {
        allowedSourceIds,
      });
      if (result.ok) refresh();
      return result;
    },
    removeMember: async (memberId) => {
      const result = await mutate(`/api/org/members/${memberId}`, "DELETE");
      if (result.ok) refresh();
      return result;
    },
    revokeInvitation: async (inviteId) => {
      const result = await mutate(`/api/org/invites/${inviteId}`, "DELETE");
      if (result.ok) refresh();
      return result;
    },
  };
}
