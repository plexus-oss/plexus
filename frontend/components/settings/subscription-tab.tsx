"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionHeader } from "@/components/ui/section-header";
import { useUsage } from "@/hooks/use-usage";
import type { BillingStatus } from "@/lib/billing/server";
import { AddCardModal } from "@/components/billing/add-card-modal";
import Link from "next/link";
import { toast } from "sonner";
import { RETENTION } from "@/lib/retention";

const STATUS_LABEL: Record<BillingStatus, string> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Past due",
  canceled: "Canceled",
  bypassed: "Enterprise",
  none: "Team",
};

const STATUS_VARIANT: Record<
  BillingStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  active: "default",
  trialing: "secondary",
  past_due: "destructive",
  canceled: "destructive",
  bypassed: "secondary",
  none: "outline",
};

const fmtNumber = (n: number) =>
  new Intl.NumberFormat("en-US").format(Math.round(n));

const fmtUsd = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);

const fmtBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
};

export function SubscriptionTab() {
  const { usage, isLoading, refresh } = useUsage();
  const [addCardOpen, setAddCardOpen] = useState(false);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }
  if (!usage) {
    return <p className="text-sm text-muted-foreground">No data.</p>;
  }

  const { billing, currentPeriod, retention, plan } = usage;
  const enterprise = billing.enterpriseInfo;
  const isTier2 = billing.tier === "tier_2";
  const charge = billing.estimatedCharge;
  const rates = billing.rates;
  const platformFeeUsd = billing.platformFeeUsd;

  return (
    <>
      <SectionHeader>Plan</SectionHeader>
      <Card className="p-4 space-y-4">
        <div className="w-full justify-between gap-4">
          <div>
            <p className="text-sm font-medium">
              {isTier2 ? "Enterprise" : "Usage-based"}
            </p>
            {isTier2 ? (
              <p className="text-xs text-muted-foreground mt-1">
                Managed by your account team.
              </p>
            ) : (
              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                <p>
                  {platformFeeUsd
                    ? "Platform fee plus metered usage, billed monthly on one invoice."
                    : "Pure usage pricing, billed monthly. We never ingest without a card on file."}
                </p>
                <ul className="font-mono tabular-nums space-y-0.5 pt-1">
                  {platformFeeUsd && (
                    <RateLine
                      label="Platform fee"
                      rate={`${fmtUsd(platformFeeUsd)} / mo`}
                    />
                  )}
                  <RateLine
                    label="Metrics"
                    rate={`$${rates.pricePerMillionMetricsUsd.toFixed(2)} / M`}
                  />
                  <RateLine
                    label="Logs"
                    rate={`$${rates.pricePerMillionLogsUsd.toFixed(2)} / M`}
                  />
                  <RateLine
                    label="Video"
                    rate={`$${rates.pricePerVideoHourUsd.toFixed(2)} / hr`}
                  />
                </ul>
                {!platformFeeUsd && (
                  <p className="flex items-center gap-1.5 pt-2 text-violet-500 font-medium">
                    Usage-priced — you only pay for what you use
                  </p>
                )}
              </div>
            )}
          </div>
          <Badge variant={STATUS_VARIANT[billing.status]}>
            {STATUS_LABEL[billing.status]}
          </Badge>
        </div>

        {!isTier2 && (
          <div className="border-t pt-4 space-y-3">
            <Label className="text-xs text-muted-foreground mb-1.5 block">
              Month-to-date charge
            </Label>
            {billing.isPaid ? (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-semibold tracking-tight font-mono tabular-nums">
                    {fmtUsd(charge.total + (platformFeeUsd ?? 0))}
                  </span>
                  <span className="text-xs text-muted-foreground">so far</span>
                </div>
                <ChargeBreakdownRows
                  charge={charge}
                  platformFeeUsd={platformFeeUsd}
                />
                <EndOfMonthEstimator
                  charge={charge}
                  platformFeeUsd={platformFeeUsd}
                />
              </>
            ) : (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                <p className="text-xs">
                  <strong>No card on file.</strong> Add one to start ingesting —
                  Plexus is usage-priced from the first metric, log, or hour of
                  video.
                </p>
              </div>
            )}
          </div>
        )}

        {isTier2 && enterprise && (
          <div className="border-t pt-4 space-y-3">
            {enterprise.accountManager && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">
                  Account manager
                </Label>
                <p className="text-sm">
                  {enterprise.accountManagerEmail ? (
                    <a
                      href={`mailto:${enterprise.accountManagerEmail}`}
                      className="underline"
                    >
                      {enterprise.accountManager}
                    </a>
                  ) : (
                    enterprise.accountManager
                  )}
                </p>
              </div>
            )}
            {enterprise.contractRenewalDate && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">
                  Contract renews
                </Label>
                <p className="text-sm">
                  {new Date(
                    enterprise.contractRenewalDate,
                  ).toLocaleDateString()}
                </p>
              </div>
            )}
          </div>
        )}

        {!isTier2 && (
          <div className="border-t pt-4">
            {billing.isPaid ? (
              <Button
                asChild
                size="sm"
                variant="outline"
                className="h-8 text-xs"
              >
                <Link href="/api/billing/portal">Manage card & invoices</Link>
              </Button>
            ) : (
              <Button
                size="sm"
                className="h-8 text-xs"
                onClick={() => setAddCardOpen(true)}
              >
                Add card to start
              </Button>
            )}
          </div>
        )}
      </Card>

      <AddCardModal
        open={addCardOpen}
        onOpenChange={setAddCardOpen}
        onSuccess={() => refresh()}
      />

      {!isTier2 && (
        <>
          <SectionHeader>Spend cap</SectionHeader>
          <SpendCapCard
            current={billing.monthlySpendCapUsd}
            onSaved={() => refresh()}
          />
        </>
      )}

      <SectionHeader>Usage this month</SectionHeader>
      <Card className="p-4 space-y-4">
        <UsageRow
          label="Metrics ingested"
          value={fmtNumber(currentPeriod.metrics)}
        />
        <UsageRow
          label="Logs ingested"
          value={fmtNumber(currentPeriod.logs)}
          divider
        />
        <UsageRow
          label="Video streamed"
          value={`${currentPeriod.videoHours.toFixed(2)} hr`}
          divider
        />
        <UsageRow
          label="Active devices"
          value={fmtNumber(currentPeriod.devicesActive)}
          divider
        />
        <UsageRow
          label="Bytes ingested"
          value={fmtBytes(currentPeriod.bytesIngested)}
          divider
        />
      </Card>

      <SectionHeader>Data retention</SectionHeader>
      <Card className="p-4 space-y-4">
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">
            Retention window
          </Label>
          <p className="text-sm">
            Raw telemetry is retained for{" "}
            {Math.round(RETENTION.rawTelemetryDays / 365)} years —{" "}
            {RETENTION.rawHotDays} days on SSD, then S3 cold storage.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            1-minute rollups: {RETENTION.rollup1MinDays} days · Hourly
            rollups: {Math.round(RETENTION.rollup1HrDays / 365)} years ·
            Events: {RETENTION.eventsDays} days
          </p>
        </div>
        <UsageRow
          label="Total rows stored"
          value={fmtNumber(retention.totalRows)}
          divider
        />
        <UsageRow
          label="Oldest data"
          value={
            retention.oldestData
              ? new Date(retention.oldestData).toLocaleDateString()
              : "—"
          }
          divider
        />
        {retention.expiringIn48Hours > 0 && (
          <p className="text-xs text-amber-600 border-t pt-3">
            {fmtNumber(retention.expiringIn48Hours)} rows will expire in the
            next 48 hours.
          </p>
        )}
      </Card>
    </>
  );
}

function RateLine({ label, rate }: { label: string; rate: string }) {
  return (
    <li className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{rate}</span>
    </li>
  );
}

const MONTHLY_CREDIT_USD = 5;

function ChargeBreakdownRows({
  charge,
  platformFeeUsd,
}: {
  charge: { metrics: number; logs: number; video: number; total: number };
  platformFeeUsd: number | null;
}) {
  // Platform-fee customers are on a negotiated plan and don't get the $5
  // credit — their invoice is exactly platform fee + usage (matches subscribe).
  const credit = platformFeeUsd
    ? 0
    : Math.min(MONTHLY_CREDIT_USD, charge.total);
  return (
    <ul className="text-xs font-mono tabular-nums space-y-1 border-t pt-3">
      {platformFeeUsd ? (
        <BreakdownLine label="Platform fee" value={platformFeeUsd} />
      ) : null}
      <BreakdownLine label="Metrics" value={charge.metrics} />
      <BreakdownLine label="Logs" value={charge.logs} />
      <BreakdownLine label="Video" value={charge.video} />
      {credit > 0 && (
        <BreakdownLine label="Monthly credit" value={-credit} highlight />
      )}
    </ul>
  );
}

function BreakdownLine({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <li className="flex items-center justify-between">
      <span className={highlight ? "text-violet-500" : "text-muted-foreground"}>
        {label}
      </span>
      <span className={highlight ? "text-violet-500" : undefined}>
        {value < 0 ? `−${fmtUsd(Math.abs(value))}` : fmtUsd(value)}
      </span>
    </li>
  );
}

/**
 * End-of-month estimator. Linear extrapolation of month-to-date charge.
 * Conservative: if it's day 5 of a 30-day month and we've spent $X, we
 * assume the next 25 days look the same and project 6×$X. No seasonality
 * or weekday adjustment — we'd rather under-promise on the projection
 * than be wrong in the other direction.
 */
function EndOfMonthEstimator({
  charge,
  platformFeeUsd,
}: {
  charge: { total: number };
  platformFeeUsd: number | null;
}) {
  // The platform fee is flat, so it's added once — only usage is extrapolated.
  const fee = platformFeeUsd ?? 0;
  const now = new Date();
  const day = now.getUTCDate();
  const daysInMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  ).getUTCDate();
  // Avoid div-by-zero on day 1 with no usage yet — show "—".
  if (charge.total === 0 || day === 0) {
    if (fee > 0) {
      return (
        <p className="text-xs text-muted-foreground border-t pt-3">
          Pace projects{" "}
          <span className="font-mono tabular-nums text-foreground">
            {fmtUsd(fee)}
          </span>{" "}
          by month end (platform fee only, pending usage).
        </p>
      );
    }
    return (
      <p className="text-xs text-muted-foreground border-t pt-3">
        End-of-month estimate: pending more usage data.
      </p>
    );
  }
  const projected = (charge.total / day) * daysInMonth + fee;
  return (
    <p className="text-xs text-muted-foreground border-t pt-3">
      Pace projects{" "}
      <span className="font-mono tabular-nums text-foreground">
        {fmtUsd(projected)}
      </span>{" "}
      by month end ({day}/{daysInMonth} days in).
    </p>
  );
}

function UsageRow({
  label,
  value,
  divider,
}: {
  label: string;
  value: string;
  divider?: boolean;
}) {
  return (
    <div className={divider ? "border-t pt-4" : undefined}>
      <Label className="text-xs text-muted-foreground mb-1.5 block">
        {label}
      </Label>
      <p className="text-sm font-mono tabular-nums">{value}</p>
    </div>
  );
}

function SpendCapCard({
  current,
  onSaved,
}: {
  current: number | null;
  onSaved: () => void;
}) {
  const [value, setValue] = useState<string>(
    current === null ? "" : String(current),
  );
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const num = value.trim() === "" ? null : Number(value);
      if (num !== null && (!Number.isFinite(num) || num < 0)) {
        toast.error("Enter a non-negative number, or leave blank for no cap.");
        setSaving(false);
        return;
      }
      const res = await fetch("/api/billing/spend-cap", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthlySpendCapUsd: num }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? "Save failed");
      }
      const json = (await res.json().catch(() => ({}))) as {
        restoredKeys?: number;
      };
      const restoredMsg =
        json.restoredKeys && json.restoredKeys > 0
          ? ` Resumed ${json.restoredKeys} key${json.restoredKeys === 1 ? "" : "s"}.`
          : "";
      toast.success(
        (num === null ? "Spend cap removed" : "Spend cap saved") + restoredMsg,
      );
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-4 space-y-4">
      <div>
        <Label className="text-xs text-muted-foreground mb-1.5 block">
          Monthly cap
        </Label>
        <p className="text-xs text-muted-foreground">
          Hard stop. When your projected charge crosses this number, we pause
          ingest and email you. Stored data is unaffected; query and export
          still work. Raise or remove the cap to resume — keys re-enable
          automatically.
        </p>
      </div>
      <div className="flex items-end gap-2 border-t pt-4">
        <div className="flex-1 max-w-xs">
          <Label
            htmlFor="spend-cap"
            className="text-xs text-muted-foreground mb-1.5 block"
          >
            USD per month
          </Label>
          <Input
            id="spend-cap"
            type="number"
            min="0"
            step="1"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="No cap"
            className="h-9 text-sm"
          />
        </div>
        <Button
          size="sm"
          onClick={save}
          disabled={saving}
          className="h-9 text-xs"
        >
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </Card>
  );
}
