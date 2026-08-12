/**
 * "Stream stopped" detector — the core scan.
 *
 * A source that stops sending data emits no event, so absence can only be found
 * by periodically checking last_seen_at. This runs as an in-process loop tick
 * (lib/scheduler/offline-loop.ts), mirroring the notification drain loop; the
 * /api/internal/detect-offline route calls the same function for manual runs.
 *
 * For each enabled `offline` alert_rule: if the source has been silent longer
 * than the rule's timeout and no offline alert is open → fire one
 * (alert.triggered + the device.offline webhook). If data resumed and an alert
 * is open → resolve it (alert.resolved + device.online). Idempotent.
 *
 * NOTE the two source_id conventions: alert_rules.source_id is the SLUG
 * (migration 00037), while alerts.source_id is the UUID — adminSourceQueries
 * .resolveRef bridges them, and the created alert uses source.id.
 */

import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { alertRules } from "@/lib/db/schema";
import { isSilenced } from "@/lib/alerts/silence";
import {
  adminSourceQueries,
  adminAlertQueries,
  adminAlertEventQueries,
} from "@/lib/db/server";
import {
  triggerAlertWebhook,
  triggerDeviceStatusWebhook,
} from "@/lib/webhooks/events";

/** "90s" / "5m" / "1h 30m" — for the alert message. */
function formatTimeout(seconds: number): string {
  if (seconds < 120) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

interface OfflineRuleRow {
  id: string;
  org_id: string;
  source_id: string;
  conditions: { timeout_seconds?: number } | null;
  severity: string;
  silenced_until: string | null;
}

export interface OfflineScanResult {
  scanned: number;
  fired: number;
  resolved: number;
}

export async function detectOfflineOnce(): Promise<OfflineScanResult> {
  // Drizzle pool (no RLS) — scans across orgs.
  const rules = (await db
    .select({
      id: alertRules.id,
      org_id: alertRules.org_id,
      source_id: alertRules.source_id,
      conditions: alertRules.conditions,
      severity: alertRules.severity,
      silenced_until: alertRules.silenced_until,
    })
    .from(alertRules)
    .where(
      and(eq(alertRules.type, "offline"), eq(alertRules.enabled, true)),
    )) as unknown as OfflineRuleRow[];
  const now = Date.now();
  let scanned = 0;
  let fired = 0;
  let resolved = 0;

  for (const rule of rules) {
    scanned++;
    try {
      // rule.source_id is the source SLUG (migration 00037 dropped the FK).
      // resolveRef bridges it to the source row; alerts.source_id is still UUID.
      const source = await adminSourceQueries.resolveRef(
        rule.org_id,
        rule.source_id,
      );
      if (!source) continue;

      const timeoutMs = (rule.conditions?.timeout_seconds ?? 300) * 1000;
      const lastSeen = source.last_seen_at
        ? Date.parse(source.last_seen_at)
        : null;
      // Never-seen sources aren't "stopped" — skip until they've sent once.
      const stale = lastSeen != null && now - lastSeen > timeoutMs;

      const open = await adminAlertQueries.findOpenByRuleAndSource(
        rule.org_id,
        rule.id,
        source.id,
      );

      const sourceLabel = source.name || source.slug;

      // Silenced rules never open a NEW alert; an already-open alert still
      // auto-closes below when the source resumes, so state can't wedge.
      if (stale && !open && !isSilenced(rule.silenced_until)) {
        const message = `No data from ${sourceLabel} for ${formatTimeout(
          timeoutMs / 1000,
        )}`;
        const alert = await adminAlertQueries.create(rule.org_id, {
          source_id: source.id,
          trigger_type: "alert_rule",
          metric: "stream",
          value: 0,
          severity: rule.severity as "info" | "warning" | "critical",
          status: "open",
          is_alert_active: true,
          rule_id: rule.id,
        });
        await adminAlertEventQueries.create(rule.org_id, alert.id, "created", {
          message,
          metadata: { timeout_seconds: timeoutMs / 1000 },
        });
        await triggerAlertWebhook(
          rule.org_id,
          alert,
          source,
          "alert.triggered",
          { message },
        );
        await triggerDeviceStatusWebhook(rule.org_id, source, "device.offline");
        fired++;
      } else if (!stale && open) {
        const iso = new Date(now).toISOString();
        const message = `Data resumed from ${sourceLabel}`;
        const updated = await adminAlertQueries.update(rule.org_id, open.id, {
          status: "resolved",
          is_alert_active: false,
          resolved_at: iso,
          closed_at: iso,
        });
        await adminAlertEventQueries.create(rule.org_id, open.id, "resolved", {
          message,
        });
        await triggerAlertWebhook(
          rule.org_id,
          updated ?? open,
          source,
          "alert.resolved",
          { message },
        );
        await triggerDeviceStatusWebhook(rule.org_id, source, "device.online");
        resolved++;
      }
    } catch (e) {
      console.error("[detect-offline] rule failed:", rule.id, e);
    }
  }

  return { scanned, fired, resolved };
}
