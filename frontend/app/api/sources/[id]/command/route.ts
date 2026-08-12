/**
 * POST /api/sources/[id]/command — send a typed command to a device.
 *
 * The session-authed counterpart of the data-api's plx_-key command relay:
 * resolves the source, enforces edit access, and forwards to the gateway's
 * internal relay. The gateway's /internal/command applies NO allowlist of its
 * own (it trusts internal callers), so this route enforces the same command
 * set the gateway accepts from browsers — nothing broader can be minted here.
 *
 * Body: { command, params?, alertId? }. When alertId is given, the send is
 * recorded on that alert's timeline — the action lands on the same audit
 * trail as the incident it answers.
 *
 * Response: { queued: boolean } — queued:false means the device has no live
 * session (or its command buffer is full); HTTP 200 either way, matching the
 * data-api relay's semantics.
 */

import { NextResponse } from "next/server";
import { withDualAuth } from "@/lib/api/with-auth";
import { findSourceByRef } from "@/lib/api/find-source";
import { enforceSource } from "@/lib/access/sources";
import { emitSystemEvent } from "@/lib/events/emit";
import { adminAlertEventQueries } from "@/lib/db/server";

const GATEWAY_URL =
  process.env.PLEXUS_GATEWAY_URL || "https://gateway.plexus.company";

/** Mirror of gateway/browser.go deviceCommandTypes — keep in sync. */
const ALLOWED_COMMANDS = new Set([
  "start_stream",
  "stop_stream",
  "start_camera",
  "stop_camera",
  "start_can",
  "stop_can",
  "start_mavlink",
  "stop_mavlink",
  "mavlink_command",
  "configure",
  "configure_camera",
]);

export const POST = withDualAuth(
  async (request, { userId, orgId, orgRole, isApiKeyAuth, params }) => {
    const { id } = await params;

    const body = (await request.json().catch(() => ({}))) as {
      command?: string;
      params?: Record<string, unknown>;
      alertId?: string;
    };
    const command = String(body.command ?? "");
    if (!ALLOWED_COMMANDS.has(command)) {
      return NextResponse.json(
        { error: `command must be one of: ${[...ALLOWED_COMMANDS].join(", ")}` },
        { status: 400 },
      );
    }

    const source = await findSourceByRef(orgId, id, isApiKeyAuth);
    if (!source) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }
    await enforceSource(
      { orgId, userId, orgRole, isApiKeyAuth },
      source,
      "edit",
    );

    // pushToService discards response bodies; we need the gateway's {queued},
    // so call the relay directly with the same header + timeout discipline.
    let queued = false;
    try {
      const res = await fetch(`${GATEWAY_URL}/internal/command`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": process.env.PLEXUS_INTERNAL_SECRET ?? "",
        },
        body: JSON.stringify({
          org_id: orgId,
          source_id: source.slug,
          command,
          params: body.params ?? {},
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          queued?: boolean;
        };
        queued = data.queued === true;
      }
    } catch {
      // Gateway unreachable — report undelivered rather than erroring the UI.
    }

    emitSystemEvent({
      orgId,
      eventType: "device.command_sent",
      category: "device",
      title: `Command ${command} ${queued ? "sent to" : "not delivered to"} ${source.name || source.slug}`,
      severity: queued ? "info" : "warning",
      sourceId: source.id,
      sourceName: source.name || undefined,
      sourceSlug: source.slug,
      entityId: source.id,
      entityType: "source",
      actorId: userId || undefined,
      metadata: { command, queued },
    });

    if (body.alertId) {
      await adminAlertEventQueries
        .create(orgId, body.alertId, "comment", {
          actorId: userId || undefined,
          message: queued
            ? `Sent \`${command}\` to ${source.name || source.slug}`
            : `Tried to send \`${command}\` to ${source.name || source.slug} — device not connected`,
        })
        .catch(() => {
          // Timeline write is best-effort; the command result stands alone.
        });
    }

    return NextResponse.json({ queued });
  },
);
