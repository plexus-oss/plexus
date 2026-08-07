/**
 * Recordings API
 *
 * GET  /api/recordings        — list recordings for the org
 * POST /api/recordings        — start a new recording session
 *
 * Starting a recording generates a short-lived API key scoped to this org,
 * stores the hash in api_keys, and pushes the raw key directly to the recorder
 * service. The recorder calls back via PATCH /api/internal/recorder/[id] to
 * report status transitions.
 */

import { NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/lib/api/with-auth";
import { apiError, errorResponse } from "@/lib/api/errors";
import { loadAllowedSourceIds } from "@/lib/access/sources";
import { recordingQueries } from "@/lib/db/queries/recordings";
import { adminApiKeyQueries } from "@/lib/db/server";
import { generateApiKey } from "@/lib/api-keys";
import { parseRelativeTime } from "@/lib/types/dashboard";

const MAX_DURATION_MS = 4 * 60 * 60 * 1000; // recorder caps sessions at 4h

export const GET = withAuth(async (req, { orgId, userId }) => {
  try {
    // Device-scoped views pass ?source_id= to list only that device's recordings.
    const sourceId = new URL(req.url).searchParams.get("source_id");
    let recordings = sourceId
      ? await recordingQueries.findBySource(orgId, sourceId)
      : await recordingQueries.findByOrg(orgId);
    // Scoped members only see recordings for their allow-listed sources
    // (sourceless recordings are hidden from them).
    const allowed = await loadAllowedSourceIds(orgId, userId);
    if (allowed) {
      recordings = recordings.filter(
        (r) => !!r.source_id && allowed.has(r.source_id),
      );
    }
    return NextResponse.json({ recordings });
  } catch (err) {
    return errorResponse(err);
  }
});

export const POST = withAuth(async (req, { orgId, userId, orgRole }) => {
  let keyRecordId: string | undefined;
  let recordingId: string | undefined;

  try {
    // Starting a recording kicks off a billable recorder job.
    await requirePermission({ orgId, orgRole, userId }, "action-start-recording");
    const body = await req.json();
    const { camera_id, source_id, duration, duration_hours } = body;

    if (!camera_id || typeof camera_id !== "string") {
      throw apiError("VALIDATION_ERROR", "camera_id is required");
    }

    if (source_id != null && typeof source_id !== "string") {
      throw apiError("VALIDATION_ERROR", "source_id must be a string");
    }

    // Scoped members can only record devices in their allow-list.
    const allowed = await loadAllowedSourceIds(orgId, userId);
    if (allowed && (!source_id || !allowed.has(source_id))) {
      throw apiError("NOT_FOUND", "Device not found");
    }

    // Preferred: a time-vocabulary duration string ("15m" / "1h" / "4h"),
    // matching the app's time-range chips. `duration_hours` (integer 1–4) is
    // still accepted for the in-flight recorder contract.
    let durationMs: number;
    if (typeof duration === "string") {
      durationMs = parseRelativeTime(duration);
    } else if (Number.isInteger(duration_hours)) {
      durationMs = duration_hours * 60 * 60 * 1000;
    } else {
      throw apiError("VALIDATION_ERROR", "duration must be a string like '1h', or duration_hours an integer");
    }

    if (durationMs <= 0 || durationMs > MAX_DURATION_MS) {
      throw apiError("VALIDATION_ERROR", "duration must be between 0 and 4 hours");
    }

    const expiresAt = new Date(Date.now() + durationMs);

    // Generate a temporary API key the recorder uses to auth with the gateway.
    const { key, prefix, hash } = generateApiKey();

    const [keyRecord] = await adminApiKeyQueries.insert(orgId, {
      name: `recording-session`,
      key_prefix: prefix,
      key_hash: hash,
      scopes: ["video:read"],
      expires_at: expiresAt.toISOString(),
    });

    if (!keyRecord) {
      throw apiError("INTERNAL_ERROR", "Failed to provision recording API key");
    }
    keyRecordId = keyRecord.id;

    const recording = await recordingQueries.insert({
      org_id: orgId,
      source_id: source_id ?? null,
      camera_id,
      gateway_api_key_id: keyRecord.id,
      expires_at: expiresAt.toISOString(),
    });
    recordingId = recording.id;

    // Push start signal to recorder — raw key is passed here, never stored in DB.
    const recorderUrl = process.env.RECORDER_SERVICE_URL;
    if (!recorderUrl) {
      throw apiError("INTERNAL_ERROR", "RECORDER_SERVICE_URL is not configured");
    }

    const pushRes = await fetch(`${recorderUrl}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        recording_id: recording.id,
        org_id: orgId,
        camera_id,
        gateway_api_key: key,
        expires_at: expiresAt.toISOString(),
      }),
    });

    if (!pushRes.ok) {
      throw apiError("INTERNAL_ERROR", "Recorder service unavailable");
    }

    return NextResponse.json({ recording }, { status: 201 });
  } catch (err) {
    // If we got past the recording insert, mark it error and clean up the api_keys
    // row — the recorder will never call back to handle cleanup itself.
    if (recordingId) {
      const errMsg = err instanceof Error ? err.message : "Failed to start recording";
      await recordingQueries
        .update(recordingId, { status: "error", error_message: errMsg })
        .catch(() => {});
      await adminApiKeyQueries.deleteById(keyRecordId!).catch(() => {});
    } else if (keyRecordId) {
      // Recording insert failed — orphaned api_keys row.
      await adminApiKeyQueries.deleteById(keyRecordId).catch(() => {});
    }
    return errorResponse(err);
  }
});
