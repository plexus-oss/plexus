/**
 * Push alert rules to the plexus alert-service.
 *
 * The alert-service holds a per-org in-memory RuleStore used for threshold,
 * outlier, and compound rule evaluation against the telemetry stream.
 * Supabase is the source of truth; this helper is the hot-path update
 * mechanism called from every route that mutates alert_rules.
 *
 * The wire field `source_id` carries the source SLUG (not UUID) — the same
 * identifier that appears on telemetry stream envelopes. `alert_rules.source_id`
 * already stores the slug (migration 00037; legacy UUID-valued rows were
 * rewritten in migration 0013), so rows pass through without translation.
 *
 * Failure isolation: this helper never throws. Supabase writes are the
 * authoritative source, so a push failure does not compromise correctness —
 * the alert-service self-heals by re-reading all rules from Next.js on
 * every restart via the bootstrap endpoint.
 */

import "server-only";

import { adminAlertRuleQueries } from "@/lib/db/server";
import { serializeAlertRuleForWire } from "./serialize-alert-rule";

let warnedOnMissingConfig = false;

/**
 * Read the current snapshot of enabled alert rules for an org from Supabase
 * (with slugs resolved) and POST it to the alert-service as a full replacement.
 *
 * Call this after any mutation to alert_rules. The body carries every enabled
 * rule for the org — the alert-service does a wholesale swap, no deltas.
 */
export async function pushOrgRulesToAlertService(orgId: string): Promise<void> {
  const alertServiceUrl = process.env.PLEXUS_ALERT_SERVICE_URL;
  const secret = process.env.PLEXUS_INTERNAL_SECRET;

  if (!alertServiceUrl || !secret) {
    if (!warnedOnMissingConfig) {
      warnedOnMissingConfig = true;
      console.warn(
        "[push-rules-to-alert-service] PLEXUS_ALERT_SERVICE_URL or PLEXUS_INTERNAL_SECRET not set — rule pushes are disabled. This is expected in local dev without an alert-service.",
      );
    }
    return;
  }

  try {
    const rows = await adminAlertRuleQueries.findEnabledByOrgWithSlug(orgId);

    const rules = rows.map(serializeAlertRuleForWire);

    const response = await fetch(`${alertServiceUrl}/internal/rules/${orgId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": secret,
      },
      body: JSON.stringify({ rules }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.error(
        `[push-rules-to-alert-service] alert-service responded ${response.status} for org ${orgId}`,
      );
      return;
    }
  } catch (error) {
    // Log-and-continue. Never throw — Supabase is the source of truth.
    console.error(
      `[push-rules-to-alert-service] failed to push rules for org ${orgId}:`,
      error,
    );
  }
}
