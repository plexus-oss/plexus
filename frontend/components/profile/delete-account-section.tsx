"use client";

/**
 * Danger zone on the profile page: delete the account. The dialog shows the
 * per-org consequences from GET /api/me/delete-account — sole-member orgs are
 * deleted with all their data, shared orgs are merely left, and being the
 * last admin of a shared org blocks deletion entirely.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { SectionHeader } from "@/components/ui/section-header";
import { usePlexusSession } from "@/hooks/use-plexus-session";
import { toast } from "@/lib/toast-utils";

const CONFIRM_TEXT = "delete my account";

interface PreflightOrg {
  orgId: string;
  name: string;
  role: string;
  memberCount: number;
  action: "delete_org" | "leave" | "blocked_last_admin";
}

interface Preflight {
  isStaff: boolean;
  canDelete: boolean;
  orgs: PreflightOrg[];
}

function consequenceLine(org: PreflightOrg): string {
  switch (org.action) {
    case "delete_org":
      return "You are the only member — the organization and all its data (devices, dashboards, billing) will be permanently deleted.";
    case "leave":
      return "You will leave this organization; it is otherwise unaffected.";
    case "blocked_last_admin":
      return "Blocked: you are the only admin. Promote another admin or remove the other members first.";
  }
}

export function DeleteAccountSection() {
  const { signOut } = usePlexusSession();
  const [open, setOpen] = useState(false);
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const openDialog = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/me/delete-account");
      if (!res.ok) throw new Error();
      setPreflight((await res.json()) as Preflight);
      setOpen(true);
    } catch {
      toast.error("Could not load account status");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!preflight) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/me/delete-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm: CONFIRM_TEXT,
          deleteOrgIds: preflight.orgs
            .filter((o) => o.action === "delete_org")
            .map((o) => o.orgId),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(data?.message ?? "Could not delete account");
      }
      toast.success("Account deleted");
      await signOut();
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Could not delete account",
      );
      setDeleting(false);
    }
  };

  return (
    <>
      <SectionHeader>Danger zone</SectionHeader>
      <Card className="p-4 border-destructive/50 space-y-3">
        <div>
          <p className="text-sm font-medium">Delete account</p>
          <p className="text-xs text-muted-foreground">
            Permanently delete your account. Organizations where you are the
            only member are deleted with all their data. This cannot be
            undone.
          </p>
        </div>
        <Button
          size="sm"
          variant="destructive"
          className="text-xs"
          onClick={openDialog}
          loading={loading || deleting}
        >
          Delete account
        </Button>
      </Card>

      <ConfirmActionDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete account?"
        description="This permanently deletes your account and signs you out. Review what happens to each of your organizations:"
        confirmLabel="Delete account"
        confirmText={CONFIRM_TEXT}
        confirmDisabled={!preflight || !preflight.canDelete}
        onConfirm={handleDelete}
      >
        {preflight && preflight.orgs.length > 0 && (
          <ul className="space-y-2 max-h-48 overflow-y-auto">
            {preflight.orgs.map((org) => (
              <li key={org.orgId} className="text-xs">
                <span className="font-medium">{org.name}</span>{" "}
                <span
                  className={
                    org.action === "leave"
                      ? "text-muted-foreground"
                      : "text-destructive"
                  }
                >
                  {consequenceLine(org)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </ConfirmActionDialog>
    </>
  );
}
