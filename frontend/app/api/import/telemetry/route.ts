/**
 * CSV Historical Import API
 *
 * POST /api/import/telemetry — forward a batch of historical points to the
 * gateway's normal /ingest path with their ORIGINAL timestamps.
 *
 * Session-only (the UI import sheet is the sole caller). The route mints a
 * short-lived org API key — same precedent as POST /api/recordings — hands it
 * to the gateway for the duration of the forward, and deletes it in a finally.
 * The raw key is never stored or returned.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, requirePermission } from "@/lib/api/with-auth";
import { apiError, errorResponse } from "@/lib/api/errors";
import { validateBody } from "@/lib/api/validate";
import { loadAllowedSourceIds } from "@/lib/access/sources";
import { findSourceByIdOrSlug } from "@/lib/api/find-source";
import { generateApiKey } from "@/lib/api-keys";
import { adminApiKeyQueries } from "@/lib/db/server";

const GATEWAY_URL =
  process.env.PLEXUS_GATEWAY_URL || "https://gateway.plexus.company";

/** Key lives just long enough to forward one request's batches. */
const KEY_TTL_MS = 15 * 60 * 1000;

/** Gateway-side sub-batch size (payload-size safety, not a contract limit). */
const GATEWAY_BATCH_SIZE = 1000;

const ImportPointSchema = z.object({
  metric: z.string().min(1, "metric is required"),
  value: z.number().finite(),
  // Epoch milliseconds. Missing/zero timestamps are rejected outright —
  // unstamped points default to 0 downstream and land at epoch 1970,
  // invisible to /latest and /query (known bug class).
  timestamp: z
    .number()
    .int()
    .positive("timestamp must be a positive epoch-ms value"),
});

const ImportTelemetryBodySchema = z.object({
  // Slug or UUID; resolved at the boundary like every other source ref.
  source_id: z.string().min(1, "source_id is required"),
  points: z
    .array(ImportPointSchema)
    .min(1, "'points' array is required")
    // Mirrors IngestBodySchema's per-request cap.
    .max(10_000, "Maximum 10,000 points per request"),
});

export const POST = withAuth(async (req, { orgId, userId, orgRole, roleId }) => {
  let keyRecordId: string | undefined;

  try {
    // Importing writes telemetry into the org's store — same trust level as
    // connecting a data source (no dedicated import action exists).
    await requirePermission(
      { orgId, orgRole, userId, roleId },
      "action-connect-data",
    );

    const body = await validateBody(req, ImportTelemetryBodySchema);

    const source = await findSourceByIdOrSlug(orgId, body.source_id);
    if (!source) throw apiError("NOT_FOUND", "Device not found");

    // Scoped members can only import into allow-listed sources.
    const allowed = await loadAllowedSourceIds(orgId, userId);
    if (allowed && !allowed.has(source.id)) {
      throw apiError("NOT_FOUND", "Device not found");
    }

    // Mint a short-lived ingest key (recordings precedent). The gateway's
    // /ingest handler requires the "write" scope — "ingest" is not a real
    // scope in this system (verify-key defaults keys to ["write"]).
    const { key, prefix, hash } = generateApiKey();
    const [keyRecord] = await adminApiKeyQueries.insert(orgId, {
      name: "csv-import",
      key_prefix: prefix,
      key_hash: hash,
      scopes: ["write"],
      expires_at: new Date(Date.now() + KEY_TTL_MS).toISOString(),
    });
    if (!keyRecord) {
      throw apiError("INTERNAL_ERROR", "Failed to provision import API key");
    }
    keyRecordId = keyRecord.id;

    // Forward through the normal gateway ingest path in sub-batches, with
    // the slug identity the gateway expects on ingest envelopes.
    let imported = 0;
    for (let i = 0; i < body.points.length; i += GATEWAY_BATCH_SIZE) {
      const batch = body.points.slice(i, i + GATEWAY_BATCH_SIZE);
      const res = await fetch(`${GATEWAY_URL}/ingest`, {
        method: "POST",
        headers: { "x-api-key": key, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          source_id: source.slug,
          points: batch.map((p) => ({
            class: "metric",
            metric: p.metric,
            value: p.value,
            timestamp: p.timestamp,
          })),
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw apiError(
          res.status >= 400 && res.status < 500
            ? "VALIDATION_ERROR"
            : "INTERNAL_ERROR",
          `Gateway rejected batch (${res.status})${text ? `: ${text.slice(0, 200)}` : ""}`,
        );
      }
      imported += batch.length;
    }

    return NextResponse.json({ imported });
  } catch (err) {
    return errorResponse(err);
  } finally {
    // The key exists only for this request — always clean it up.
    if (keyRecordId) {
      await adminApiKeyQueries.deleteById(keyRecordId).catch(() => {});
    }
  }
});
