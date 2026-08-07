/**
 * Individual Alert API
 *
 * GET /api/alerts/[id] - Get a single alert with events
 * PATCH /api/alerts/[id] - Update an alert (acknowledge, resolve, reopen)
 * DELETE /api/alerts/[id] - Delete an alert
 */

import { NextResponse } from "next/server";
import { withDualAuth, requirePermission } from "@/lib/api/with-auth";
import { db } from "@/lib/db/client";
import { alertQueries, alertEventQueries, sourceQueries, runWithServiceRole } from "@/lib/db";
import {
  adminAlertQueries,
  adminAlertEventQueries,
} from "@/lib/db/server";
import { emitSystemEvent } from "@/lib/events/emit";
import { triggerAlertWebhook } from "@/lib/webhooks/events";
import type {
  AlertStatus,
  AlertEventType,
  AlertVerdict,
  Alert,
} from "@/lib/db/types";

// GET /api/alerts/[id]
export const GET = withDualAuth(async (_request, { orgId, isApiKeyAuth, params }) => {
  const { id } = await params;

  // API-key callers have no session JWT, so user-scoped (RLS-filtered)
  // alertQueries.findById throws under their auth. Use admin queries
  // when isApiKeyAuth — matches the pattern documented in withDualAuth's
  // JSDoc and applied in the POST handler.
  const alert = isApiKeyAuth
    ? await adminAlertQueries.findById(orgId, id)
    : await alertQueries.findById(orgId, id);
  if (!alert) {
    return NextResponse.json({ error: "Alert not found" }, { status: 404 });
  }

  // Get the event timeline
  const events = isApiKeyAuth
    ? await adminAlertEventQueries.findByAlert(orgId, id)
    : await alertEventQueries.findByAlert(orgId, id);

  // Live (recency-windowed) verdict history for this alert's rule/limit on its
  // source — powers the "this rule has been noise N of M times here" nudge.
  const by = {
    ruleId: alert.rule_id,
    limitId: alert.limit_id,
    sourceId: alert.source_id,
  };
  const verdict_stats = isApiKeyAuth
    ? await adminAlertQueries.getVerdictStats(orgId, by)
    : await alertQueries.getVerdictStats(orgId, by);

  // Additive identity enrichment (same contract as the list route): slug +
  // name travel with the uuid.
  let enriched = alert as Alert & { source_slug?: string; source_name?: string };
  if (alert.source_id) {
    const lookup = () => sourceQueries.findByIds(orgId, [alert.source_id!]);
    const src = isApiKeyAuth ? await runWithServiceRole(lookup) : await lookup();
    if (src[0]) {
      enriched = {
        ...enriched,
        source_slug: src[0].slug,
        source_name: src[0].name || src[0].slug,
      };
    }
  }

  return NextResponse.json({ alert: enriched, events, verdict_stats });
});

// PATCH /api/alerts/[id]
export const PATCH = withDualAuth(async (request, { orgId, userId, orgRole, isApiKeyAuth, params }) => {
  const { id } = await params;
  // Acknowledge/resolve/reopen are one manifest capability (default: everyone).
  if (!isApiKeyAuth) {
    await requirePermission({ orgId, orgRole, userId }, "action-acknowledge-alert");
  }
  const body = await request.json();
  const { action, resolution_notes, message } = body;

  // Check alert exists. Same pattern as GET — branch on isApiKeyAuth.
  const existingAlert = isApiKeyAuth
    ? await adminAlertQueries.findById(orgId, id)
    : await alertQueries.findById(orgId, id);
  if (!existingAlert) {
    return NextResponse.json({ error: "Alert not found" }, { status: 404 });
  }

  let alert: Alert = existingAlert;
  let eventType: AlertEventType | null = null;
  let eventMessage = message;
  let eventMetadata: Record<string, unknown> | undefined;

  // Validation — before any writes, so 400s don't need to abort a transaction.
  if (action === "acknowledge" && existingAlert.status !== "open") {
    return NextResponse.json(
      { error: "Can only acknowledge open alerts" },
      { status: 400 }
    );
  }
  if (action === "resolve" && existingAlert.status === "resolved") {
    return NextResponse.json(
      { error: "Alert is already resolved" },
      { status: 400 }
    );
  }
  if (action === "reopen" && existingAlert.status !== "resolved") {
    return NextResponse.json(
      { error: "Can only reopen resolved alerts" },
      { status: 400 }
    );
  }
  if (action === "comment" && !message) {
    return NextResponse.json(
      { error: "Message is required for comments" },
      { status: 400 }
    );
  }
  if (action === "verdict") {
    const { verdict } = body as { verdict?: string };
    if (verdict !== "helpful" && verdict !== "noise") {
      return NextResponse.json(
        { error: "verdict must be 'helpful' or 'noise'" },
        { status: 400 }
      );
    }
  }

  // Compute update fields + event info (no writes yet).
  let updateFields: Record<string, unknown> | null = null;

  switch (action) {
    case "acknowledge": {
      updateFields = {
        status: "acknowledged" as AlertStatus,
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: userId || "system",
      };
      eventType = "acknowledged";
      eventMessage = eventMessage || "Alert acknowledged";
      break;
    }

    case "resolve": {
      updateFields = {
        status: "resolved",
        resolved_at: new Date().toISOString(),
        resolved_by: userId || "system",
      };
      if (resolution_notes) updateFields.resolution_notes = resolution_notes;
      eventType = "resolved";
      eventMessage = eventMessage || `Alert resolved${resolution_notes ? `: ${resolution_notes}` : ""}`;
      break;
    }

    case "reopen": {
      updateFields = {
        status: "open" as AlertStatus,
        resolved_at: null,
        resolved_by: null,
        resolution_notes: null,
      };
      eventType = "reopened";
      eventMessage = eventMessage || "Alert reopened";
      break;
    }

    case "comment": {
      eventType = "comment";
      eventMessage = message;
      break;
    }

    case "verdict": {
      const { verdict } = body as { verdict?: string };
      updateFields = { current_verdict: verdict as AlertVerdict };
      eventType = "verdict";
      eventMessage =
        verdict === "helpful"
          ? "On-call verdict: ✓ helpful — this alert was worth firing."
          : "On-call verdict: ✕ noise — tune or retire this rule.";
      eventMetadata = {
        verdict,
        rule_id: existingAlert.rule_id,
        limit_id: existingAlert.limit_id,
        metric: existingAlert.metric,
      };
      break;
    }

    default: {
      const { status, recommended_actions, closed_at, triggered_at } = body;
      const data: Record<string, unknown> = {};
      if (status) data.status = status as AlertStatus;
      if (recommended_actions !== undefined) data.recommended_actions = recommended_actions;
      if (isApiKeyAuth) {
        if (closed_at !== undefined) data.closed_at = closed_at;
        if (triggered_at !== undefined) data.triggered_at = triggered_at;
      }
      if (Object.keys(data).length > 0) updateFields = data;
    }
  }

  // Execute update + event creation atomically (session path in a transaction;
  // API-key path without — admin queries don't support tx yet).
  if (updateFields || (eventType && eventMessage)) {
    if (isApiKeyAuth) {
      if (updateFields) {
        alert = (await adminAlertQueries.update(orgId, id, updateFields))!;
      }
      if (eventType && eventMessage) {
        await adminAlertEventQueries.create(orgId, id, eventType, {
          actorId: userId || undefined,
          message: eventMessage,
          ...(eventMetadata ? { metadata: eventMetadata } : {}),
        });
      }
    } else {
      alert = await db.transaction(async (tx) => {
        let updated = existingAlert;
        if (updateFields) {
          updated = (await alertQueries.update(orgId, id, updateFields, tx))!;
        }
        if (eventType && eventMessage) {
          await alertEventQueries.create(
            orgId,
            id,
            eventType,
            {
              actorId: userId || undefined,
              message: eventMessage,
              ...(eventMetadata ? { metadata: eventMetadata } : {}),
            },
            tx,
          );
        }
        return updated;
      });
    }
  }

  // Notify integrations (Slack/email + generic webhooks) about
  // lifecycle changes — until now only `alert.triggered` ever dispatched.
  // Service-role context: API-key callers have no session JWT, and even for
  // session callers the dispatch internals are written for that context.
  if (action === "acknowledge" || action === "resolve") {
    try {
      await runWithServiceRole(async () => {
        const sources = alert.source_id
          ? await sourceQueries.findById(orgId, alert.source_id)
          : [];
        await triggerAlertWebhook(
          orgId,
          alert,
          sources[0] || null,
          action === "acknowledge" ? "alert.acknowledged" : "alert.resolved",
        );
      });
    } catch (err) {
      console.error(`[alerts] ${action} notification dispatch failed:`, err);
    }
  }

  // Emit system events for status changes
  if (action === "acknowledge") {
    emitSystemEvent({
      orgId,
      eventType: "alert.acknowledged",
      category: "alert",
      title: `Alert on ${existingAlert.metric} acknowledged`,
      sourceId: existingAlert.source_id || undefined,
      entityId: id,
      entityType: "alert",
      actorId: userId,
    });
  } else if (action === "resolve") {
    emitSystemEvent({
      orgId,
      eventType: "alert.resolved",
      category: "alert",
      title: `Alert on ${existingAlert.metric} resolved`,
      severity: "success",
      sourceId: existingAlert.source_id || undefined,
      entityId: id,
      entityType: "alert",
      actorId: userId,
    });
  }

  // Get updated events
  const events = isApiKeyAuth
    ? await adminAlertEventQueries.findByAlert(orgId, id)
    : await alertEventQueries.findByAlert(orgId, id);

  return NextResponse.json({ alert, events });
});

// DELETE /api/alerts/[id]
export const DELETE = withDualAuth(async (_request, { orgId, userId, orgRole, isApiKeyAuth, params }) => {
  const { id } = await params;

  if (!isApiKeyAuth) {
    await requirePermission({ orgId, orgRole, userId }, "action-delete-alert");
  }

  const existingAlert = isApiKeyAuth
    ? await adminAlertQueries.findById(orgId, id)
    : await alertQueries.findById(orgId, id);
  if (!existingAlert) {
    return NextResponse.json({ error: "Alert not found" }, { status: 404 });
  }

  if (isApiKeyAuth) {
    await adminAlertQueries.delete(orgId, id);
  } else {
    await alertQueries.delete(orgId, id);
  }

  return NextResponse.json({ success: true });
});
