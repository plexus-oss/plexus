/**
 * GET /api/internal/alerts/rules/all
 *
 * Bootstrap endpoint for the alert-service's in-memory RuleStore.
 *
 * The alert-service calls this once at startup to hydrate all alert rules
 * for all orgs. Runtime updates happen via push (POST /internal/rules/{orgID}
 * on the alert-service side, called by `pushOrgRulesToAlertService`).
 *
 * Auth: server-to-server only. Shared secret in the `x-internal-secret`
 * header, matching `PLEXUS_INTERNAL_SECRET` in the environment. No user
 * session — the alert-service has no user.
 *
 * Security: this endpoint reads across tenant boundaries (all orgs), so it
 * MUST use the service-role Supabase client via `adminAlertRuleQueries`.
 *
 * Response shape matches the alert-service's `FetchAllRulesFromAPI` parser:
 * {
 *   "orgs": {
 *     "<orgId>": {
 *       "rules": [AlertRuleWire, ...]
 *     }
 *   }
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAlertRuleQueries } from "@/lib/db/server";
import { serializeAlertRuleForWire } from "@/lib/alerts/serialize-alert-rule";
import type { AlertRuleWire } from "@/lib/db/types";

interface BootstrapResponse {
  orgs: Record<string, { rules: AlertRuleWire[] }>;
}

export async function GET(request: NextRequest) {
  const secret = request.headers.get("x-internal-secret");
  const expected = process.env.PLEXUS_INTERNAL_SECRET;

  if (!expected) {
    console.error(
      "[alerts/rules/all] PLEXUS_INTERNAL_SECRET is not set — refusing request",
    );
    return NextResponse.json(
      { error: "Server not configured" },
      { status: 500 },
    );
  }

  if (!secret || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rows = await adminAlertRuleQueries.findAllEnabledWithSlug();

    const orgs: Record<string, { rules: AlertRuleWire[] }> = {};
    for (const row of rows) {
      if (!orgs[row.org_id]) {
        orgs[row.org_id] = { rules: [] };
      }
      orgs[row.org_id].rules.push(serializeAlertRuleForWire(row));
    }

    const response: BootstrapResponse = { orgs };
    return NextResponse.json(response);
  } catch (error) {
    console.error("[alerts/rules/all] bootstrap query failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
