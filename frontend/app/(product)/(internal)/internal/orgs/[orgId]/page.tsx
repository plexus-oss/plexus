"use client";

/**
 * Staff-only org detail: overview stats, member list with remove, an
 * Impersonate action, and the delete-org danger zone. Inherits the internal
 * layout's staff gate + "Plexus Admin" chrome.
 */

import { use, useState } from "react";
import Link from "next/link";
import {
  Building2,
  Calendar,
  ChevronRight,
  Copy,
  CreditCard,
} from "lucide-react";
import { useInternalOrg } from "@/hooks/use-internal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { Spinner } from "@/components/ui/spinner";
import { OrgDangerZone } from "@/components/internal/org-danger-zone";
import { toast } from "@/lib/toast-utils";
import type { InternalOrgMember } from "@/hooks/use-internal";

function PropertyRow({
  icon,
  label,
  children,
}: {
  icon?: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start py-1.5">
      <span className="w-32 text-sm text-muted-foreground flex items-center gap-2 shrink-0">
        {icon}
        {label}
      </span>
      <span className="text-sm min-w-0">{children}</span>
    </div>
  );
}

export default function InternalOrgDetailPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = use(params);
  const { detail, isLoading, notFound, mutate } = useInternalOrg(orgId);

  const [impersonating, setImpersonating] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<InternalOrgMember | null>(
    null,
  );
  const [removing, setRemoving] = useState(false);

  const handleImpersonate = async () => {
    setImpersonating(true);
    try {
      const res = await fetch("/api/internal/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      if (res.ok) {
        // Full navigation so every SWR cache rebuilds under the new org.
        window.location.assign("/");
        return;
      }
      toast.error("Could not start impersonation");
    } catch {
      toast.error("Could not start impersonation");
    }
    setImpersonating(false);
  };

  const handleRemoveMember = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      const res = await fetch(
        `/api/internal/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(removeTarget.userId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error();
      toast.success(`Removed ${removeTarget.email ?? removeTarget.userId}`);
      setRemoveTarget(null);
      mutate();
    } catch {
      toast.error("Could not remove member");
    } finally {
      setRemoving(false);
    }
  };

  if (isLoading && !detail) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner />
      </div>
    );
  }

  if (notFound || !detail) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <EmptyState
          icon={Building2}
          title="Organization not found"
          description="It may have been deleted."
        />
        <div className="mt-4 text-center">
          <Link href="/internal" className="text-sm text-muted-foreground hover:text-foreground">
            Back to organizations
          </Link>
        </div>
      </div>
    );
  }

  const { org, counts, usage, members } = detail;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-6">
        <Link href="/internal" className="hover:text-foreground">
          Organizations
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground">{org.name}</span>
      </div>

      <div className="flex items-start justify-between mb-8">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold truncate">{org.name}</h1>
            <Badge variant="outline" className="text-[10px] shrink-0">
              {org.plan}
            </Badge>
          </div>
          <div className="flex items-center gap-1 mt-1">
            <span className="text-xs text-muted-foreground font-mono">
              {org.id}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => {
                navigator.clipboard.writeText(org.id);
                toast.success("Copied");
              }}
            >
              <Copy className="h-3 w-3" />
            </Button>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={handleImpersonate}
          loading={impersonating}
        >
          Impersonate
        </Button>
      </div>

      <div className="space-y-8">
        <div>
          <SectionHeader className="mb-2">Overview</SectionHeader>
          <div className="space-y-0.5">
            <PropertyRow icon={<CreditCard className="h-3.5 w-3.5" />} label="Plan">
              {org.plan}
              {org.stripeSubscriptionStatus && (
                <span className="text-muted-foreground">
                  {" "}
                  · {org.stripeSubscriptionStatus}
                </span>
              )}
            </PropertyRow>
            <PropertyRow icon={<Calendar className="h-3.5 w-3.5" />} label="Created">
              {org.createdAt
                ? new Date(org.createdAt).toLocaleDateString()
                : "—"}
            </PropertyRow>
            <PropertyRow label="Stripe customer">
              {org.stripeCustomerId ? (
                <span className="font-mono text-xs">{org.stripeCustomerId}</span>
              ) : (
                "—"
              )}
            </PropertyRow>
            <PropertyRow label="Devices">{counts.devices}</PropertyRow>
            <PropertyRow label="Connections">{counts.connections}</PropertyRow>
            <PropertyRow label="Dashboards">{counts.dashboards}</PropertyRow>
            <PropertyRow label="Monitors">{counts.monitors}</PropertyRow>
            <PropertyRow label="Alert rules">{counts.alertRules}</PropertyRow>
            <PropertyRow label="Alerts">{counts.alerts}</PropertyRow>
            <PropertyRow label="API keys">{counts.apiKeys}</PropertyRow>
            <PropertyRow label="Usage (month)">
              {usage
                ? `${usage.dataPointsIngested.toLocaleString()} points · ${(usage.bytesIngested / 1024 / 1024).toFixed(1)} MB · ${usage.devicesActive} active device${usage.devicesActive !== 1 ? "s" : ""}`
                : "—"}
            </PropertyRow>
          </div>
        </div>

        <div>
          <SectionHeader className="mb-2">
            Members ({counts.members})
          </SectionHeader>
          <Card className="divide-y divide-border">
            {members.map((member) => (
              <div
                key={member.userId}
                className="flex items-center justify-between px-4 py-3 gap-4"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-8 w-8 rounded-full border border-border bg-muted/50 flex items-center justify-center overflow-hidden shrink-0">
                    {member.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- dynamic remote avatar URL not in next.config images.domains
                      <img
                        src={member.imageUrl}
                        alt={member.name ?? member.email ?? ""}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-[10px] font-semibold text-muted-foreground">
                        {(member.name ?? member.email ?? "?")
                          .charAt(0)
                          .toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm truncate">
                      {member.name ?? member.email ?? member.userId}
                    </p>
                    {member.name && member.email && (
                      <p className="text-xs text-muted-foreground truncate">
                        {member.email}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className="text-[10px]">
                    {member.role.replace("org:", "")}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-destructive hover:text-destructive"
                    onClick={() => setRemoveTarget(member)}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
            {members.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No members.
              </div>
            )}
          </Card>
        </div>

        <OrgDangerZone detail={detail} />
      </div>

      <ConfirmActionDialog
        open={removeTarget !== null}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title="Remove member?"
        description={`Remove ${removeTarget?.email ?? removeTarget?.userId ?? ""} from ${org.name}. They lose access immediately; their account is not deleted.`}
        confirmLabel="Remove"
        confirmDisabled={removing}
        onConfirm={handleRemoveMember}
      />
    </div>
  );
}
