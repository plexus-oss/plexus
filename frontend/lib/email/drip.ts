/**
 * Tier_1 onboarding drip — orchestrator.
 *
 * One module decides which drip to fire for an org and stamps a marker
 * in org_billing.drip_markers so the next pass doesn't double-send.
 * Templates live in drip-templates.ts; transport lives in
 * transactional.ts. This file is the "policy" layer in between — when
 * does each drip fire, what's the dedupe key, what gates it.
 *
 * Idempotency strategy: each drip writes a marker to
 * `org_billing.drip_markers.drip_sent.<key>` (an ISO timestamp). Re-runs
 * short-circuit if the marker exists. The Resend `idempotencyKey` header
 * provides a second layer in case the metadata write succeeds but the
 * email send racey-retries.
 *
 * Welcome fires from POST /api/orgs on org creation (immediate). All
 * other drips are evaluated by the daily cron (`/api/cron/email-drip`)
 * because they require time-since-signup math.
 */

import "server-only";
import { adminOrgBillingQueries, adminOrgMemberQueries } from "@/lib/db/server";
import type { Json } from "@/lib/db/types";
import { sendTransactionalEmail } from "./transactional";
import {
  feedbackD7Email,
  firstDataEmail,
  nextStepsD3Email,
  noDataD1Email,
  cardNudgeEmail,
  welcomeEmail,
  type BaseDripProps,
  type CardNudgeProps,
} from "./drip-templates";

export type DripKey =
  | "welcome"
  | "no_data_d1"
  | "first_data"
  | "next_steps_d3"
  | "feedback_d7"
  | "card_nudge";

interface DripMetadata {
  drip_sent?: Partial<Record<DripKey, string>>;
  drip_sent_card_nudge_month?: string;
}

interface SendDripResult {
  sent: boolean;
  key: DripKey;
  reason?: string;
}

/**
 * Read the drip-marker map from org_billing.drip_markers. Returns an
 * empty record when the field is missing or shaped wrong.
 */
function readMarkers(dripMarkers: Record<string, unknown>): {
  sent: Partial<Record<DripKey, string>>;
  cardNudgeMonth: string | null;
} {
  const meta = dripMarkers as DripMetadata;
  const sent =
    meta.drip_sent && typeof meta.drip_sent === "object"
      ? (meta.drip_sent as Partial<Record<DripKey, string>>)
      : {};
  const cardNudgeMonth =
    typeof meta.drip_sent_card_nudge_month === "string"
      ? meta.drip_sent_card_nudge_month
      : null;
  return { sent, cardNudgeMonth };
}

async function stampMarker(
  orgId: string,
  key: DripKey,
  monthKey?: string,
): Promise<void> {
  const billing = await adminOrgBillingQueries.findByOrgId(orgId);
  const current = (billing?.drip_markers ?? {}) as Record<string, unknown>;
  const existing = (current as DripMetadata).drip_sent ?? {};
  const merged = {
    ...(typeof existing === "object" ? existing : {}),
    [key]: new Date().toISOString(),
  };
  // Spread the current markers first so unrelated keys (e.g. the card-nudge
  // month stamp) survive a stamp for a different drip.
  const update: Record<string, unknown> = { ...current, drip_sent: merged };
  if (key === "card_nudge" && monthKey) {
    update.drip_sent_card_nudge_month = monthKey;
  }
  await adminOrgBillingQueries.patch(orgId, {
    drip_markers: update as Json,
  });
}

/**
 * Look up admin email + first name for an org. Skipped if no admin or
 * the user has no email — the cron ignores those orgs (logged once).
 */
async function lookupRecipient(orgId: string): Promise<{
  email: string;
  firstName: string | null;
} | null> {
  try {
    const admin = await adminOrgMemberQueries.findAdminByOrg(orgId);
    if (!admin?.email) return null;
    return { email: admin.email, firstName: admin.firstName };
  } catch {
    return null;
  }
}

/**
 * Send the welcome drip immediately on org creation.
 *
 * Called from POST /api/orgs the moment the org is created, not on the
 * next cron tick. Idempotent: a retried request short-circuits on the
 * marker.
 */
export async function sendWelcomeDrip(orgId: string): Promise<SendDripResult> {
  const billing = await adminOrgBillingQueries.findByOrgId(orgId);
  const { sent } = readMarkers((billing?.drip_markers ?? {}) as Record<string, unknown>);
  if (sent.welcome) {
    return { sent: false, key: "welcome", reason: "already_sent" };
  }

  const recipient = await lookupRecipient(orgId);
  if (!recipient) {
    return { sent: false, key: "welcome", reason: "no_admin_email" };
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL || "https://app.plexus.company";
  const props: BaseDripProps = {
    orgName: billing?.org_name ?? orgId,
    recipientFirstName: recipient.firstName,
    appUrl,
  };
  const content = welcomeEmail(props);

  const result = await sendTransactionalEmail({
    to: recipient.email,
    subject: content.subject,
    html: content.html,
    idempotencyKey: `drip-welcome-${orgId}`,
  });
  if (!result.success) {
    return { sent: false, key: "welcome", reason: result.error };
  }

  await stampMarker(orgId, "welcome");
  return { sent: true, key: "welcome" };
}

interface DripContext {
  orgId: string;
  orgName: string;
  createdAtMs: number;
  dripMarkers: Record<string, unknown>;
  /** True if the org has ingested any data this month. */
  hasDataThisMonth: boolean;
  /** True if the org's earliest data point was within the last 24h. */
  firstDataInLast24h: boolean;
  /** Days since first data landed (null if no data yet). */
  daysSinceFirstData: number | null;
  /** Days since the org was created. */
  daysSinceSignup: number;
  /** True if the org has a card on file (paid/trialing/past_due). */
  isPaid: boolean;
  /** Monthly credit ($5) usage in [0, 1]+. */
  creditUsedFraction: number;
  creditsUsedUsd: number;
}

/**
 * Decide & send the next applicable drip for one org. Returns the key
 * fired (or `null` if nothing fires). Order matters — we evaluate
 * highest-priority signal first so a single org never receives two
 * drips on the same tick.
 *
 * Guards:
 *  - Skip if a drip with the same key has already been sent (markers).
 *  - Skip the welcome flow here entirely — it fires from POST /api/orgs.
 *  - Skip orgs without an admin email (best-effort logging).
 */
export async function evaluateAndSendDrip(
  ctx: DripContext,
): Promise<SendDripResult | null> {
  const { sent, cardNudgeMonth } = readMarkers(ctx.dripMarkers);
  const recipient = await lookupRecipient(ctx.orgId);
  if (!recipient) {
    return null;
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL || "https://app.plexus.company";
  const base: BaseDripProps = {
    orgName: ctx.orgName,
    recipientFirstName: recipient.firstName,
    appUrl,
  };

  // Highest priority: usage approaching team-tier ceiling. We don't
  // want to celebrate first-data while their ingest is one breach
  // away from being paused.
  const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM
  if (
    !ctx.isPaid &&
    ctx.creditUsedFraction >= 0.7 &&
    cardNudgeMonth !== monthKey
  ) {
    const props: CardNudgeProps = {
      ...base,
      creditsUsedUsd: ctx.creditsUsedUsd,
      pct: ctx.creditUsedFraction,
    };
    const content = cardNudgeEmail(props);
    const result = await sendTransactionalEmail({
      to: recipient.email,
      subject: content.subject,
      html: content.html,
      idempotencyKey: `drip-card-nudge-${ctx.orgId}-${monthKey}`,
    });
    if (!result.success) {
      return { sent: false, key: "card_nudge", reason: result.error };
    }
    await stampMarker(ctx.orgId, "card_nudge", monthKey);
    return { sent: true, key: "card_nudge" };
  }

  // Celebrate first data within the first 24h of it landing — gives
  // the celebratory tone immediacy without trampling the in-app
  // success screen.
  if (ctx.firstDataInLast24h && !sent.first_data) {
    const content = firstDataEmail(base);
    const result = await sendTransactionalEmail({
      to: recipient.email,
      subject: content.subject,
      html: content.html,
      idempotencyKey: `drip-first-data-${ctx.orgId}`,
    });
    if (!result.success) {
      return { sent: false, key: "first_data", reason: result.error };
    }
    await stampMarker(ctx.orgId, "first_data");
    return { sent: true, key: "first_data" };
  }

  // No data after a day — nudge with the founder-line. Window is 1–3d
  // so we don't pile on a lukewarm signup. Gate on "never ingested
  // anything" (daysSinceFirstData === null), NOT month-scoped usage:
  // hasDataThisMonth resets at the month boundary and ignores video, so
  // it would wrongly tell an org that already sent data it's "stuck on
  // the first metric."
  if (
    ctx.daysSinceFirstData === null &&
    ctx.daysSinceSignup >= 1 &&
    ctx.daysSinceSignup <= 3 &&
    !sent.no_data_d1
  ) {
    const content = noDataD1Email(base);
    const result = await sendTransactionalEmail({
      to: recipient.email,
      subject: content.subject,
      html: content.html,
      idempotencyKey: `drip-no-data-d1-${ctx.orgId}`,
    });
    if (!result.success) {
      return { sent: false, key: "no_data_d1", reason: result.error };
    }
    await stampMarker(ctx.orgId, "no_data_d1");
    return { sent: true, key: "no_data_d1" };
  }

  // 3 days after first data: concrete next-steps suggestions.
  if (
    ctx.daysSinceFirstData !== null &&
    ctx.daysSinceFirstData >= 3 &&
    ctx.daysSinceFirstData <= 6 &&
    !sent.next_steps_d3
  ) {
    const content = nextStepsD3Email(base);
    const result = await sendTransactionalEmail({
      to: recipient.email,
      subject: content.subject,
      html: content.html,
      idempotencyKey: `drip-next-steps-d3-${ctx.orgId}`,
    });
    if (!result.success) {
      return { sent: false, key: "next_steps_d3", reason: result.error };
    }
    await stampMarker(ctx.orgId, "next_steps_d3");
    return { sent: true, key: "next_steps_d3" };
  }

  // Week-in feedback ask. Window is 7–10d to handle weekends + cron jitter.
  if (
    ctx.daysSinceSignup >= 7 &&
    ctx.daysSinceSignup <= 10 &&
    !sent.feedback_d7
  ) {
    const content = feedbackD7Email(base);
    const result = await sendTransactionalEmail({
      to: recipient.email,
      subject: content.subject,
      html: content.html,
      idempotencyKey: `drip-feedback-d7-${ctx.orgId}`,
    });
    if (!result.success) {
      return { sent: false, key: "feedback_d7", reason: result.error };
    }
    await stampMarker(ctx.orgId, "feedback_d7");
    return { sent: true, key: "feedback_d7" };
  }

  return null;
}
