/**
 * Send transactional emails (billing alerts, system notifications) via
 * Resend. Distinct from lib/integrations/email.ts, which dispatches
 * org-configured alert notifications to integration endpoints.
 */

import "server-only";
import { adminOrgMemberQueries } from "@/lib/db/server";

const RESEND_API_URL = "https://api.resend.com/emails";
const DELIVERY_TIMEOUT_MS = 30_000;

export async function findOrgAdminEmail(orgId: string): Promise<string | null> {
  try {
    const admin = await adminOrgMemberQueries.findAdminByOrg(orgId);
    return admin?.email ?? null;
  } catch (err) {
    console.warn(`[transactional] could not find admin email for ${orgId}`, err);
    return null;
  }
}

export interface SendResult {
  success: boolean;
  responseStatus?: number;
  error?: string;
}

export async function sendTransactionalEmail(args: {
  to: string;
  subject: string;
  html: string;
  /** Optional Idempotency-Key header so retries don't double-send. */
  idempotencyKey?: string;
}): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { success: false, error: "RESEND_API_KEY not configured" };
  }
  const from =
    process.env.RESEND_FROM_ADDRESS || "Plexus <billing@plexus.company>";

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (args.idempotencyKey) {
    headers["Idempotency-Key"] = args.idempotencyKey;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        from,
        to: [args.to],
        subject: args.subject,
        html: args.html,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) return { success: true, responseStatus: res.status };

    const body = await res.text().catch(() => "");
    return {
      success: false,
      responseStatus: res.status,
      error: `Resend ${res.status}: ${body}`,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const msg = err instanceof Error ? err.message : "send failed";
    return { success: false, error: msg };
  }
}
