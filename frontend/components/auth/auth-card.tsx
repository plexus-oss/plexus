"use client";

/**
 * Sign-in / sign-up card.
 *
 * Centered max-w-md on black, zinc-900 card, white primary CTA,
 * zinc-800 Google button.
 *
 * Two steps in one card:
 *   email — Google button (when the provider is configured) + email field
 *   code  — 6-digit OTP entry with resend cooldown
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Spinner } from "@/components/ui/spinner";
import {
  completeSignup,
  emailExists,
  requestEmailCode,
  verifyEmailCode,
} from "@/lib/auth/authjs-client";

const RESEND_COOLDOWN_SECONDS = 30;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ERROR_FROM_QUERY: Record<string, string> = {
  Verification: "That sign-in code is invalid or expired.",
  AccessDenied: "Access denied.",
  Configuration: "We couldn't send the code. Wait a few minutes and try again.",
  OAuthAccountNotLinked:
    "This email is already registered. Sign in with your email code instead.",
};

export function AuthCard({ mode }: { mode: "sign-in" | "sign-up" }) {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("redirect_url") || "/";

  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  // Sign-up only: collected on the email step, persisted after the code is
  // verified. Org name auto-suggests from first name until the user edits it.
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [orgNameInput, setOrgNameInput] = useState("");
  const [orgNameTouched, setOrgNameTouched] = useState(false);
  // Org name auto-suggests from the first name until the user edits it directly.
  const orgName = orgNameTouched
    ? orgNameInput
    : mode === "sign-up" && firstName.trim()
      ? `${firstName.trim()}'s Workspace`
      : "";
  const [error, setError] = useState<string | null>(() => {
    const queryError = searchParams.get("error");
    return queryError
      ? (ERROR_FROM_QUERY[queryError] ?? "Something went wrong. Try again.")
      : null;
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const codeInputRef = useRef<HTMLInputElement>(null);

  // Google is shown only when the deployment actually configured it.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (step === "code") codeInputRef.current?.focus();
  }, [step]);

  const sendCode = useCallback(async () => {
    const trimmed = email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(trimmed)) {
      setError("Enter a valid email address.");
      return;
    }
    if (mode === "sign-up") {
      if (!firstName.trim()) {
        setError("Enter your first name.");
        return;
      }
      if (!orgName.trim()) {
        setError("Enter an organization name.");
        return;
      }
    }
    setIsSubmitting(true);
    setError(null);

    // Enforce sign-up vs sign-in intent before sending a code. emailExists
    // returns null when the check is unavailable — skip the gate then rather
    // than block a legitimate user on a transient error.
    const exists = await emailExists(trimmed);
    if (exists === true && mode === "sign-up") {
      setIsSubmitting(false);
      setError("You already have an account. Sign in instead.");
      return;
    }
    if (exists === false && mode === "sign-in") {
      setIsSubmitting(false);
      setError("No account found for that email. Create one to get started.");
      return;
    }

    const result = await requestEmailCode(trimmed);
    setIsSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setStep("code");
    setCode("");
    setCooldown(RESEND_COOLDOWN_SECONDS);
  }, [email, mode, firstName, orgName]);

  const submitCode = useCallback(async () => {
    if (code.trim().length !== 6) {
      setError("Enter the 6-digit code.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    const result = await verifyEmailCode(
      email.trim().toLowerCase(),
      code,
      callbackUrl,
    );
    if (!result.ok) {
      setIsSubmitting(false);
      setError(result.error);
      setCode("");
      codeInputRef.current?.focus();
      return;
    }
    // Session cookie is set. For sign-up, persist the name + org collected on
    // the first step before leaving. Best-effort: the code is single-use and
    // the user is already authenticated, so we proceed even if this fails —
    // the org-guard provisions a fallback workspace.
    if (mode === "sign-up") {
      await completeSignup({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        orgName: orgName.trim(),
      });
    }
    // Full navigation so server components see the new session cookie.
    window.location.assign(callbackUrl);
  }, [code, email, callbackUrl, mode, firstName, lastName, orgName]);

  const heading = mode === "sign-in" ? "Sign in to Plexus" : "Create your account";
  const subcopy =
    step === "code"
      ? `We emailed a 6-digit code to ${email.trim()}`
      : mode === "sign-in"
        ? "Welcome back. Enter your email to continue."
        : "A few details to set up your workspace.";

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 shadow-xl">
        <div className="space-y-1.5 mb-6">
          <h1 className="text-lg font-semibold text-white">{heading}</h1>
          <p className="text-sm text-zinc-400">{subcopy}</p>
        </div>

        {step === "email" && (
          <div className="space-y-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void sendCode();
              }}
              className="space-y-4"
            >
              {mode === "sign-up" && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label
                        htmlFor="auth-first-name"
                        className="text-xs font-medium text-zinc-300"
                      >
                        First name
                      </label>
                      <input
                        id="auth-first-name"
                        type="text"
                        autoComplete="given-name"
                        autoFocus
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        className="w-full h-9 px-3 rounded-md bg-zinc-800 text-sm text-white placeholder:text-zinc-500 border border-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-500"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label
                        htmlFor="auth-last-name"
                        className="text-xs font-medium text-zinc-300"
                      >
                        Last name{" "}
                        <span className="text-zinc-500 font-normal">
                          (optional)
                        </span>
                      </label>
                      <input
                        id="auth-last-name"
                        type="text"
                        autoComplete="family-name"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        className="w-full h-9 px-3 rounded-md bg-zinc-800 text-sm text-white placeholder:text-zinc-500 border border-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-500"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label
                      htmlFor="auth-org-name"
                      className="text-xs font-medium text-zinc-300"
                    >
                      Organization name
                    </label>
                    <input
                      id="auth-org-name"
                      type="text"
                      autoComplete="organization"
                      value={orgName}
                      onChange={(e) => {
                        setOrgNameTouched(true);
                        setOrgNameInput(e.target.value);
                      }}
                      className="w-full h-9 px-3 rounded-md bg-zinc-800 text-sm text-white placeholder:text-zinc-500 border border-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-500"
                    />
                  </div>
                </>
              )}

              <div className="space-y-1.5">
                <label
                  htmlFor="auth-email"
                  className="text-xs font-medium text-zinc-300"
                >
                  Email address
                </label>
                <input
                  id="auth-email"
                  type="email"
                  autoComplete="email"
                  autoFocus={mode === "sign-in"}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-9 px-3 rounded-md bg-zinc-800 text-sm text-white placeholder:text-zinc-500 border border-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-500"
                />
              </div>
              {error && <p className="text-xs text-red-400">{error}</p>}
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full h-9 rounded-md bg-white text-sm font-medium text-zinc-900 hover:bg-zinc-50 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {isSubmitting ? <Spinner className="w-4 h-4" /> : "Continue"}
              </button>
            </form>
          </div>
        )}

        {step === "code" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitCode();
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <label
                htmlFor="auth-code"
                className="text-xs font-medium text-zinc-300"
              >
                Sign-in code
              </label>
              <input
                id="auth-code"
                ref={codeInputRef}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                className="w-full h-11 px-3 rounded-md bg-zinc-800 text-center text-lg tracking-[0.5em] font-mono text-white border border-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-500"
              />
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={isSubmitting || code.length !== 6}
              className="w-full h-9 rounded-md bg-white text-sm font-medium text-zinc-900 hover:bg-zinc-50 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {isSubmitting ? <Spinner className="w-4 h-4" /> : "Verify"}
            </button>
            <div className="flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={() => {
                  setStep("email");
                  setError(null);
                  setCode("");
                }}
                className="text-zinc-400 hover:text-zinc-300"
              >
                Use a different email
              </button>
              <button
                type="button"
                disabled={cooldown > 0 || isSubmitting}
                onClick={() => void sendCode()}
                className="text-zinc-400 hover:text-zinc-300 disabled:opacity-50"
              >
                {cooldown > 0 ? `Resend code (${cooldown}s)` : "Resend code"}
              </button>
            </div>
          </form>
        )}

        <p className="mt-6 text-center text-xs text-zinc-400">
          {mode === "sign-in" ? (
            <>
              Don&apos;t have an account?{" "}
              <Link href="/sign-up" className="text-zinc-300 hover:text-white">
                Sign up
              </Link>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <Link href="/sign-in" className="text-zinc-300 hover:text-white">
                Sign in
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
