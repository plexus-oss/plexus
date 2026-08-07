"use client";

/**
 * Tier_1 home banner — combines a usage readout, a team-tier progress
 * bar, and the right CTA for the current state. The component is
 * deliberately self-contained: it owns the SWR fetch, owns the card
 * modal, and renders four distinct states (loading / fresh /
 * approaching / over / paid) so callers can drop it on any tier_1 page.
 *
 * UX states:
 *   fresh       <60% used    — calm, "team tier" badge, billing link
 *   approaching 60–90% used  — amber, "Add card to keep flowing"
 *   over        ≥90% used    — coral, "Add card to resume" (ingest paused)
 *   paid        any %        — projected charge, billing link
 *
 * Following house style: violet accent, mono numerals, generous radii,
 * no frame on the progress bar — just a soft track.
 */

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ArrowUpRight, Zap, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetcher } from "@/lib/fetcher";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AddCardModal } from "@/components/billing/add-card-modal";
import { useUsage } from "@/hooks/use-usage";
import type { UsageProgress } from "@/app/api/billing/usage-progress/route";

const fmt = new Intl.NumberFormat("en-US");
const fmtUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

interface Props {
  /** Optional supplemental link rendered next to the primary CTA. */
  upgradeLink?: React.ReactNode;
  /** Called after a card is successfully added so callers can refresh. */
  onCardAdded?: () => void;
  /** Estimated monthly charge in USD — only used for the paid state. */
  estimatedChargeUsd?: number;
  /** Total data points this period — used in the paid readout. */
  dataPointsThisPeriod?: number;
}

export function TeamTierBanner({
  upgradeLink,
  onCardAdded,
  estimatedChargeUsd = 0,
  dataPointsThisPeriod = 0,
}: Props) {
  const { data, mutate } = useSWR<UsageProgress>(
    "/api/billing/usage-progress",
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30_000 },
  );
  // If this org has a negotiated platform fee, adding a card is NOT optional —
  // it triggers the fee immediately — so the fresh-state CTA must say so.
  const { usage } = useUsage();
  const platformFeeUsd = usage?.billing.platformFeeUsd ?? null;
  const [addCardOpen, setAddCardOpen] = useState(false);

  if (!data) {
    return (
      <Card className="p-6 h-[152px] bg-gradient-to-br from-violet-500/[0.04] via-transparent to-transparent border-violet-500/20" />
    );
  }

  const isPaid = data.isPaid;
  const status = data.status;
  const overflow = status === "over";
  const approaching = status === "approaching";

  // Tone & accent per state. Card border + glow swap to amber/coral so
  // the surface itself signals urgency without needing a banner.
  const accent = isPaid
    ? "violet"
    : overflow
      ? "destructive"
      : approaching
        ? "amber"
        : "violet";

  return (
    <Card
      className={cn(
        "relative overflow-hidden",
        accent === "violet" &&
          "border-violet-500/20 bg-gradient-to-br from-violet-500/[0.04] via-transparent to-transparent",
        accent === "amber" &&
          "border-amber-500/30 bg-gradient-to-br from-amber-500/[0.05] via-transparent to-transparent",
        accent === "destructive" &&
          "border-destructive/35 bg-gradient-to-br from-destructive/[0.06] via-transparent to-transparent",
      )}
    >
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute -top-1/2 -right-1/4 w-1/2 h-full rounded-full blur-3xl",
          accent === "violet" && "bg-violet-500/10",
          accent === "amber" && "bg-amber-500/12",
          accent === "destructive" && "bg-destructive/12",
        )}
      />
      <div className="relative p-6 space-y-5">
        <div className="flex items-baseline justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <div className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground">
              This month
            </div>
            <div className="text-3xl font-semibold tracking-tight font-mono tabular-nums">
              {isPaid
                ? fmtUsd.format(estimatedChargeUsd)
                : fmt.format(data.metrics.used)}
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {isPaid ? (
                <>
                  {fmt.format(dataPointsThisPeriod)} data points · projected
                  charge
                </>
              ) : (
                <>
                  of {fmt.format(data.metrics.limit)} team metrics
                  {data.logs.limit > 0 && (
                    <>
                      {" "}
                      · {fmt.format(data.logs.used)} /{" "}
                      {fmt.format(data.logs.limit)} logs
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          <StatusBadge isPaid={isPaid} status={status} />
        </div>

        {!isPaid && <ProgressBar pct={data.pct} accent={accent} />}

        <div className="flex flex-wrap items-center gap-3">
          {isPaid ? (
            <Button asChild size="sm">
              <Link href="/settings?tab=billing" className="gap-1.5">
                Billing & usage
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </Button>
          ) : overflow ? (
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => setAddCardOpen(true)}
            >
              Add card to resume
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Button>
          ) : approaching ? (
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => setAddCardOpen(true)}
            >
              Add card to keep flowing
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Button>
          ) : platformFeeUsd ? (
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => setAddCardOpen(true)}
            >
              Add card — {fmtUsd.format(platformFeeUsd)}/mo + usage
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setAddCardOpen(true)}
            >
              Add a card (optional)
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Button>
          )}
          {upgradeLink}
        </div>
      </div>

      <AddCardModal
        open={addCardOpen}
        onOpenChange={setAddCardOpen}
        onSuccess={() => {
          void mutate();
          onCardAdded?.();
        }}
      />
    </Card>
  );
}

function StatusBadge({
  isPaid,
  status,
}: {
  isPaid: boolean;
  status: UsageProgress["status"];
}) {
  if (isPaid) {
    return (
      <Badge variant="default" className="text-[10px] gap-1">
        <Zap className="w-3 h-3" />
        Paid
      </Badge>
    );
  }
  if (status === "over") {
    return (
      <Badge variant="destructive" className="text-[10px] gap-1">
        <AlertTriangle className="w-3 h-3" />
        Ingest paused
      </Badge>
    );
  }
  if (status === "approaching") {
    return (
      <Badge
        variant="outline"
        className="text-[10px] border-amber-500/40 text-amber-500"
      >
        Approaching limit
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px]">
      Team tier
    </Badge>
  );
}

function ProgressBar({
  pct,
  accent,
}: {
  pct: number;
  accent: "violet" | "amber" | "destructive";
}) {
  const width = `${Math.max(2, Math.min(100, pct * 100))}%`;
  return (
    <div className="space-y-1.5">
      <div className="h-1.5 rounded-full bg-foreground/[0.06] overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-700 ease-smooth",
            accent === "violet" && "bg-violet-500/70",
            accent === "amber" && "bg-amber-500/80",
            accent === "destructive" && "bg-destructive/85",
          )}
          style={{ width }}
        />
      </div>
      <div className="flex justify-between text-[10px] font-mono text-muted-foreground tabular-nums">
        <span>{Math.round(pct * 100)}% used</span>
        <span>resets monthly</span>
      </div>
    </div>
  );
}
