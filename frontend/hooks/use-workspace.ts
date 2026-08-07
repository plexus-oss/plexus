"use client";

/**
 * Handle on the active workspace for the settings page.
 */

import { useMyOrgs } from "@/hooks/use-my-orgs";

export interface WorkspaceHandle {
  id: string;
  name: string;
  imageUrl: string | null;
  /** Whether logo upload is available (admin-gated server-side). */
  supportsLogo: boolean;
  update: (args: { name: string }) => Promise<unknown>;
  setLogo: (args: { file: File | null }) => Promise<unknown>;
}

export function useWorkspace(): WorkspaceHandle | null {
  const { activeOrgId, orgs, refresh } = useMyOrgs();
  if (!activeOrgId) return null;
  const activeOrg = orgs.find((o) => o.orgId === activeOrgId);
  return {
    id: activeOrgId,
    name: activeOrg?.name ?? activeOrgId,
    imageUrl: activeOrg?.imageUrl ?? null,
    supportsLogo: true,
    update: async ({ name }) => {
      const res = await fetch("/api/org", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("Could not rename workspace");
      await refresh();
    },
    setLogo: async ({ file }) => {
      let res: Response;
      if (file) {
        const formData = new FormData();
        formData.append("file", file);
        res = await fetch("/api/org/logo", { method: "POST", body: formData });
      } else {
        res = await fetch("/api/org/logo", { method: "DELETE" });
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error || "Could not update logo");
      }
      await refresh();
    },
  };
}
