"use client";

/**
 * Hand-rolled client helpers for the Auth.js HTTP endpoints (mounted at
 * /api/authjs). We deliberately skip next-auth/react: it assumes the
 * default /api/auth basePath and a SessionProvider, neither of which we
 * use — and these four flows are just fetches.
 *
 * The OTP flow:
 *   requestEmailCode(email)        → Auth.js emails a 6-digit code
 *   verifyEmailCode(email, code)   → exchanges the code for a session
 *                                    cookie (the verification token is
 *                                    single-use, 10-min expiry)
 */

const BASE = "/api/authjs";

const ERROR_MESSAGES: Record<string, string> = {
  Verification: "That code is invalid or expired. Request a new one.",
  EmailSignin: "We couldn't send the code. Wait a moment and try again.",
  // Auth.js reports a sendVerificationRequest throw (e.g. our outstanding-
  // codes rate limit) as Configuration; phrase it for the common case.
  Configuration: "We couldn't send the code. Wait a few minutes and try again.",
  OAuthAccountNotLinked:
    "This email is already registered. Sign in with your email code instead.",
  AccessDenied: "Access denied.",
};

function parseAuthError(url: string): string {
  try {
    const error = new URL(url, window.location.origin).searchParams.get("error");
    if (!error) return "Something went wrong. Try again.";
    return ERROR_MESSAGES[error] ?? "Something went wrong. Try again.";
  } catch {
    return "Something went wrong. Try again.";
  }
}

async function getCsrfToken(): Promise<string> {
  const res = await fetch(`${BASE}/csrf`);
  if (!res.ok) throw new Error("csrf fetch failed");
  const body = (await res.json()) as { csrfToken?: string };
  if (!body.csrfToken) throw new Error("missing csrf token");
  return body.csrfToken;
}

/** POST an Auth.js action and return the redirect target as JSON. */
async function postAction(
  path: string,
  fields: Record<string, string>,
): Promise<{ url: string }> {
  const csrfToken = await getCsrfToken();
  const res = await fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // Auth.js returns { url } JSON instead of a 302 when this is set.
      "X-Auth-Return-Redirect": "1",
    },
    body: new URLSearchParams({ csrfToken, ...fields }),
  });
  if (!res.ok) throw new Error(`auth action ${path} failed: ${res.status}`);
  return (await res.json()) as { url: string };
}

/**
 * Whether an account already exists for `email`. Returns null when the check
 * is unavailable (network/server error) so callers can fail open — a glitchy
 * precheck must never tell a real user "no account found".
 */
export async function emailExists(email: string): Promise<boolean | null> {
  try {
    const res = await fetch(`${BASE}/precheck?email=${encodeURIComponent(email)}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { exists?: boolean };
    return typeof body.exists === "boolean" ? body.exists : null;
  } catch {
    return null;
  }
}

export async function requestEmailCode(
  email: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { url } = await postAction("signin/resend", { email });
    if (url.includes("error=")) return { ok: false, error: parseAuthError(url) };
    return { ok: true };
  } catch {
    return { ok: false, error: "We couldn't send the code. Try again." };
  }
}

export async function verifyEmailCode(
  email: string,
  code: string,
  callbackUrl: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const params = new URLSearchParams({
      token: code.trim(),
      email,
      callbackUrl,
    });
    // The success hop sets the session cookie, then redirects. Follow it
    // and inspect where we landed instead of letting the browser navigate
    // to Auth.js's error page.
    const res = await fetch(`${BASE}/callback/resend?${params.toString()}`, {
      redirect: "follow",
    });
    if (res.url.includes("error=")) {
      return { ok: false, error: parseAuthError(res.url) };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Something went wrong. Try again." };
  }
}

/**
 * Persist the details collected on the sign-up card once the OTP is verified
 * and the session cookie is set. Order matters: PATCH /api/me writes the name
 * to the users row first, then POST /api/orgs copies it into the new
 * membership and sets the active-org cookie (so the org-guard doesn't
 * auto-provision a fallback workspace).
 *
 * Best-effort: the verification already created the session, and the code is
 * single-use, so a failure here must not strand the user — callers proceed
 * into the app regardless (the org-guard provisions a fallback if needed).
 */
export async function completeSignup(details: {
  firstName: string;
  lastName: string;
  orgName: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const meRes = await fetch("/api/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: details.firstName,
        lastName: details.lastName,
      }),
    });
    if (!meRes.ok) return { ok: false, error: "Could not save your name." };

    const orgRes = await fetch("/api/orgs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: details.orgName }),
    });
    if (!orgRes.ok) {
      const body = (await orgRes.json().catch(() => null)) as {
        error?: string;
      } | null;
      return { ok: false, error: body?.error ?? "Could not create your workspace." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not finish setting up your account." };
  }
}

export async function authjsSignOut(redirectTo: string = "/sign-in"): Promise<void> {
  try {
    await postAction("signout", {});
  } finally {
    window.location.assign(redirectTo);
  }
}
