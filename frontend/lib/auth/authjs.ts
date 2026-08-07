/**
 * Auth.js v5 configuration.
 *
 * Mounted at /api/authjs to stay clear of the app's own /api/auth/* routes.
 *
 * Sign-in methods:
 *   - Email OTP: 6-digit typed code, 10-minute expiry, single-use.
 *     Chosen over clickable magic links because corporate mail scanners
 *     pre-fetch links (burning one-time tokens) and links strand the
 *     session on whichever device opened the email.
 *   (Google OAuth was removed — email OTP is the only sign-in method.)
 *
 * Sessions are database rows (auth_sessions) — sign-out and admin
 * revocation are row deletes, effective immediately.
 *
 * Required env: AUTH_SECRET (hashes OTP codes + signs the session cookie),
 * RESEND_API_KEY + RESEND_FROM_ADDRESS for the code email.
 */

import "server-only";

import { randomInt } from "node:crypto";
import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import { supabaseAdapter } from "./adapter";
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { authVerificationTokens } from "@/lib/db/schema";
import { sendTransactionalEmail } from "@/lib/email/transactional";
import { renderEmail } from "@/lib/email/layout";

const OTP_MAX_AGE_SECONDS = 10 * 60;
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30-day rolling sessions

function otpEmailHtml(code: string): string {
  // Shares the branded shell (logo, card, footer) with the rest of the
  // transactional emails; only the code block is bespoke.
  const body = `
    <p style="text-align:center;color:#52525b;margin:0 0 16px;">Your Plexus sign-in code</p>
    <div style="background:#f4f4f5;border:1px solid #e4e4e7;border-radius:10px;padding:16px;text-align:center;margin:0 0 20px;">
      <span style="font-size:32px;font-weight:700;letter-spacing:8px;font-family:'SF Mono',Menlo,Consolas,monospace;color:#18181b;-webkit-user-select:all;user-select:all;">${code}</span>
    </div>
    <p style="font-size:13px;color:#71717a;text-align:center;line-height:1.5;margin:0;">Click the code to select it, then copy. This code expires in 10 minutes &mdash; if you didn't request it, you can ignore this email.</p>
  `;
  return renderEmail({ bodyHtml: body, preheader: `${code} — your Plexus sign-in code` });
}

const emailOtp = Resend({
  // sendVerificationRequest below routes through lib/email/transactional
  // (Resend HTTP API), so the provider's own apiKey transport is unused.
  apiKey: process.env.RESEND_API_KEY,
  from: process.env.RESEND_FROM_ADDRESS || "Plexus <billing@plexus.company>",
  maxAge: OTP_MAX_AGE_SECONDS,
  async generateVerificationToken() {
    // 100000-999999: fixed six digits, no leading-zero ambiguity. Auth.js
    // stores only the secret-keyed hash, so a DB read can't reveal live codes.
    return randomInt(100000, 1000000).toString();
  },
  async sendVerificationRequest({ identifier, token }) {
    const email = identifier.toLowerCase();

    // Rate limit: at most 3 outstanding codes per email. Tokens live in
    // auth_verification_tokens (10-min expiry, single-use), so counting
    // active rows is a durable limiter that survives serverless instances.
    // Per-IP limiting belongs at the proxy in front of the deployment.
    await db
      .delete(authVerificationTokens)
      .where(
        and(
          eq(authVerificationTokens.identifier, email),
          lt(authVerificationTokens.expires, new Date().toISOString()),
        ),
      );
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(authVerificationTokens)
      .where(eq(authVerificationTokens.identifier, email));
    if (count > 3) {
      throw new Error(`OTP rate limit hit for ${email}`);
    }

    const result = await sendTransactionalEmail({
      to: email,
      subject: `${token} is your Plexus sign-in code`,
      html: otpEmailHtml(token),
    });
    if (!result.success) {
      // No email provider configured (self-host without Resend) or dev: print
      // the code to the server log so sign-in works without email delivery.
      // When a key IS configured, production still fails loudly — a broken
      // provider shouldn't silently downgrade to log-scraping.
      if (!process.env.RESEND_API_KEY || process.env.NODE_ENV !== "production") {
        console.warn(
          `[auth] OTP email send failed (${result.error}).\n` +
            `       Fallback — sign-in code for ${email}: ${token}\n` +
            `       (set RESEND_API_KEY to deliver codes by email)`,
        );
        return;
      }
      throw new Error(`OTP email failed: ${result.error}`);
    }
  },
});

const providers = [emailOtp];

export const {
  handlers,
  auth: authjsSession,
  signIn: authjsSignIn,
  signOut: authjsSignOut,
} = NextAuth({
  adapter: supabaseAdapter(),
  providers,
  basePath: "/api/authjs",
  session: {
    strategy: "database",
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
  // The temp server / on-prem hosts aren't behind Vercel's host inference.
  trustHost: true,
  // Non-JS / direct-navigation flows land on our card instead of the
  // Auth.js default pages; errors arrive as ?error= and the card maps them.
  pages: {
    signIn: "/sign-in",
    error: "/sign-in",
  },
  callbacks: {
    session({ session, user }) {
      // user is PlexusAdapterUser from our adapter; expose the two fields
      // the getSession() contract reads beyond email.
      session.user.id = user.id;
      (session.user as { isStaff?: boolean }).isStaff =
        (user as { isStaff?: boolean }).isStaff ?? false;
      // Under database strategy the raw session object carries the DB
      // session token. The cookie is httpOnly but /api/authjs/session
      // JSON is not — never hand the token to page JavaScript.
      delete (session as { sessionToken?: string }).sessionToken;
      return session;
    },
  },
});
