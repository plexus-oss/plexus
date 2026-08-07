"use client";

/**
 * Staff-only danger zone on the internal org detail page: permanently delete
 * the org and all its data via DELETE /api/internal/orgs/[orgId]. Mirrors the
 * profile delete-account section (type-to-confirm + consequence list).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { SectionHeader } from "@/components/ui/section-header";
import { toast } from "@/lib/toast-utils";
import type { InternalOrgDetail } from "@/hooks/use-internal";

export function OrgDangerZone({ detail }: { detail: InternalOrgDetail }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deleteUsers, setDeleteUsers] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { org, counts } = detail;

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/internal/orgs/${encodeURIComponent(org.id)}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: org.name, deleteUsers }),
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          message?: string;
          error?: string;
        } | null;
        throw new Error(
          data?.message ?? data?.error ?? "Could not delete organization",
        );
      }
      toast.success(`Deleted ${org.name}`);
      router.replace("/internal");
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Could not delete organization",
      );
      setDeleting(false);
    }
  };

  return (
    <div className="mt-12 pt-8 border-t border-border">
      <SectionHeader className="mb-4">Danger zone</SectionHeader>
      <Card className="p-4 border-destructive/50 space-y-3">
        <div>
          <p className="text-sm font-medium">Delete organization</p>
          <p className="text-xs text-muted-foreground">
            Permanently delete this organization and all its data — devices,
            dashboards, alerts, API keys, and billing. Stored telemetry is
            retained but unreachable once the org is gone. This cannot be
            undone.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <Checkbox
            checked={deleteUsers}
            onCheckedChange={(v) => setDeleteUsers(v === true)}
          />
          Also delete member accounts that belong only to this org
        </label>
        <Button
          size="sm"
          variant="destructive"
          className="text-xs"
          onClick={() => setOpen(true)}
          loading={deleting}
        >
          Delete organization
        </Button>
      </Card>

      <ConfirmActionDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete ${org.name}?`}
        description="This permanently deletes the organization and cancels its Stripe subscription. Stored telemetry is retained but becomes unreachable."
        confirmLabel="Delete organization"
        confirmText={org.name}
        onConfirm={handleDelete}
      >
        <ul className="space-y-1 text-xs text-destructive">
          <li>
            {counts.members} member{counts.members !== 1 ? "s" : ""} removed
            {deleteUsers ? " (sole-membership accounts deleted)" : ""}
          </li>
          <li>
            {counts.devices + counts.connections} source
            {counts.devices + counts.connections !== 1 ? "s" : ""} deleted
          </li>
          <li>
            {counts.dashboards} dashboard{counts.dashboards !== 1 ? "s" : ""},{" "}
            {counts.monitors} monitor{counts.monitors !== 1 ? "s" : ""},{" "}
            {counts.apiKeys} API key{counts.apiKeys !== 1 ? "s" : ""} deleted
          </li>
          <li>Stripe subscription canceled and customer deleted</li>
        </ul>
      </ConfirmActionDialog>
    </div>
  );
}
