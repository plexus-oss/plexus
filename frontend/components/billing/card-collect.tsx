"use client";

/**
 * Inline Stripe card collection — SetupIntent fetch, themed Elements,
 * confirmSetup + subscribe. Shared by the modal in settings and the
 * team-tier banner.
 */

import { useEffect, useMemo, useState } from "react";
import {
  loadStripe,
  type Stripe as StripeJs,
  type StripeElementsOptions,
} from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";

let stripePromise: Promise<StripeJs | null> | null = null;
function getStripeJs(): Promise<StripeJs | null> {
  if (!stripePromise) {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!key) {
      console.error("[Billing] NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set");
      return Promise.resolve(null);
    }
    stripePromise = loadStripe(key);
  }
  return stripePromise;
}

interface CardCollectProps {
  /** Called after subscribe succeeds. */
  onComplete: () => void;
  /** Called when the user cancels / skips. */
  onCancel: () => void;
  /** Whether to mount the SetupIntent fetch. Modals pass `open`. */
  active?: boolean;
  submitLabel?: string;
  cancelLabel?: string;
  showCancel?: boolean;
}

export function CardCollect({
  onComplete,
  onCancel,
  active = true,
  submitLabel = "Start ingesting",
  cancelLabel = "Cancel",
  showCancel = true,
}: CardCollectProps) {
  const { resolvedTheme } = useTheme();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    fetch("/api/billing/setup-intent", { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.message ?? "Failed to start checkout");
        }
        return res.json() as Promise<{ clientSecret: string }>;
      })
      .then((json) => {
        if (!cancelled) setClientSecret(json.clientSecret);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to start");
        }
      });
    // Reset on cleanup (runs when `active` flips to false or on unmount), so a
    // reopened modal re-fetches a fresh SetupIntent instead of reusing a stale
    // clientSecret.
    return () => {
      cancelled = true;
      setClientSecret(null);
      setError(null);
    };
  }, [active]);

  const elementsOptions = useMemo<StripeElementsOptions | undefined>(() => {
    if (!clientSecret) return undefined;
    const isDark = resolvedTheme === "dark";
    return {
      clientSecret,
      appearance: {
        theme: isDark ? "night" : "stripe",
        variables: {
          colorPrimary: "#8b5cf6",
          colorBackground: isDark ? "#0a0a0a" : "#ffffff",
          colorText: isDark ? "#fafafa" : "#0a0a0a",
          colorDanger: "#ef4444",
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          borderRadius: "8px",
          spacingUnit: "4px",
        },
        rules: {
          ".Input": {
            border: isDark
              ? "1px solid hsl(0 0% 18%)"
              : "1px solid hsl(0 0% 90%)",
            boxShadow: "none",
          },
          ".Input:focus": {
            border: "1px solid #8b5cf6",
            boxShadow: "0 0 0 1px #8b5cf6",
          },
          ".Label": { fontSize: "12px", fontWeight: "500" },
        },
      },
    };
  }, [clientSecret, resolvedTheme]);

  if (error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/[0.06] p-4 text-sm">
        {error}
      </div>
    );
  }

  if (!clientSecret || !elementsOptions) {
    return (
      <div className="h-48 flex items-center justify-center">
        <div className="text-xs text-muted-foreground">
          Preparing secure checkout…
        </div>
      </div>
    );
  }

  return (
    <Elements stripe={getStripeJs()} options={elementsOptions}>
      <CardForm
        onCancel={onCancel}
        onComplete={onComplete}
        submitLabel={submitLabel}
        cancelLabel={cancelLabel}
        showCancel={showCancel}
      />
    </Elements>
  );
}

function CardForm({
  onCancel,
  onComplete,
  submitLabel,
  cancelLabel,
  showCancel,
}: {
  onCancel: () => void;
  onComplete: () => void;
  submitLabel: string;
  cancelLabel: string;
  showCancel: boolean;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setSubmitting(true);
    setFormError(null);

    const { error, setupIntent } = await stripe.confirmSetup({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/?checkout=success`,
      },
      redirect: "if_required",
    });

    if (error) {
      setFormError(error.message ?? "Could not save your card");
      setSubmitting(false);
      return;
    }

    if (!setupIntent || setupIntent.status !== "succeeded") {
      setFormError("Card saved, but confirmation is still pending. Hang on.");
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch("/api/billing/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupIntentId: setupIntent.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? "Subscription failed");
      }
      toast.success("You're live. Start sending data.");
      onComplete();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Subscription failed");
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement
        options={{
          layout: "tabs",
          terms: { card: "never" },
        }}
      />

      {formError && <p className="text-xs text-destructive">{formError}</p>}

      <div className="flex items-center justify-end gap-2 pt-1">
        {showCancel && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={submitting}
          >
            {cancelLabel}
          </Button>
        )}
        <Button
          type="submit"
          size="sm"
          disabled={!stripe || submitting}
          className="gap-1.5"
        >
          {submitting ? "Saving…" : submitLabel}
          {!submitting && <ArrowRight className="w-3.5 h-3.5" />}
        </Button>
      </div>
    </form>
  );
}
