"use client";

/**
 * Inline card-on-file modal — replaces the redirect to Stripe Checkout.
 *
 * Plexus is usage-priced — there's nothing to charge today, just a card
 * to file. We use a SetupIntent so 3DS/SCA still flows through Stripe.js
 * without us seeing card numbers. The actual Stripe Elements form lives
 * in `<CardCollect>`.
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Lock } from "lucide-react";
import { CardCollect } from "@/components/billing/card-collect";
import { useUsage } from "@/hooks/use-usage";

interface AddCardModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the subscription is created and webhook should follow. */
  onSuccess?: () => void;
}

export function AddCardModal({
  open,
  onOpenChange,
  onSuccess,
}: AddCardModalProps) {
  // Self-aware: if this org has a negotiated platform fee, make it explicit
  // (it's charged the moment the card is saved) wherever the modal is opened.
  const { usage } = useUsage();
  const platformFeeUsd = usage?.billing.platformFeeUsd ?? null;
  const feeLabel = platformFeeUsd ? `$${platformFeeUsd.toFixed(2)}` : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden">
        <div className="relative">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(ellipse_70%_60%_at_50%_-20%,rgba(139,92,246,0.18),transparent_70%)]"
          />
          <div className="relative p-6 space-y-5">
            <DialogHeader className="space-y-2">
              <div className="inline-flex w-fit items-center gap-1.5 rounded-full border border-foreground/10 bg-foreground/[0.03] px-2.5 py-1 text-[10px] font-medium tracking-wider uppercase text-muted-foreground">
                <Lock className="w-3 h-3 text-violet-500" />
                Secure
              </div>
              <DialogTitle className="text-2xl font-semibold tracking-tight leading-tight">
                Add a card
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                Usage is metered to the second:{" "}
                <span className="font-mono">$0.10/M metrics</span>,{" "}
                <span className="font-mono">$0.10/M logs</span>,{" "}
                <span className="font-mono">$0.25/hr of video</span>.
                {feeLabel
                  ? " Usage bills at end of month; the platform fee below is charged now."
                  : " Nothing is charged until end of month."}
              </DialogDescription>
            </DialogHeader>

            {feeLabel ? (
              <div className="rounded-lg border border-violet-500/25 bg-violet-500/[0.06] px-4 py-3 flex items-start gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {feeLabel}/mo platform fee + usage
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Your plan includes a {feeLabel} monthly platform fee, charged
                    today and then each month on the same invoice as usage.
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-violet-500/25 bg-violet-500/[0.06] px-4 py-3 flex items-start gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Pay only for what you use
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Usage-priced from the first data point — no minimums, no
                    subscription. You&apos;re charged only for the data you send.
                  </p>
                </div>
              </div>
            )}

            <CardCollect
              active={open}
              onComplete={() => {
                onOpenChange(false);
                onSuccess?.();
              }}
              onCancel={() => onOpenChange(false)}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
