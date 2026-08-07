/**
 * Org Logo API
 *
 * POST   /api/org/logo — upload the org logo (multipart `file`). Admin only.
 * DELETE /api/org/logo — remove the org logo. Admin only.
 *
 * Logos live in the public icons bucket at `{orgId}/logo/{uuid}.{ext}`; the
 * public URL is persisted on `org_billing.logo_url` and surfaced to the client
 * via GET /api/me/orgs. Replacing or removing a logo best-effort deletes the
 * previous object.
 */

import { NextResponse } from "next/server";
import { withRoleAuth } from "@/lib/api/with-auth";
import { adminOrgBillingQueries } from "@/lib/db/server";
import {
  BUCKET_NAME,
  deriveExtension,
  isStorageConfigured,
  validateIconFile,
} from "@/lib/storage/dashboard-icons";
import { deleteObject, publicUrl, putObject } from "@/lib/storage/s3";
import { randomUUID } from "crypto";

// Storage key of an existing logo URL, or null when the URL isn't a logo
// object of this org in our public bucket (e.g. legacy Clerk URLs).
function logoKeyFromUrl(url: string | null, orgId: string): string | null {
  if (!url) return null;
  const prefix = `${orgId}/logo/`;
  try {
    const key = decodeURIComponent(new URL(url).pathname.slice(1));
    return url === publicUrl(BUCKET_NAME, key) && key.startsWith(prefix)
      ? key
      : null;
  } catch {
    return null;
  }
}

export const POST = withRoleAuth(["org:admin"], async (request, { orgId }) => {
  if (!isStorageConfigured()) {
    return NextResponse.json(
      { error: "File upload not configured" },
      { status: 503 },
    );
  }

  // Buffer the body before parsing: in prod (behind the Fly proxy + Node
  // middleware) streamed multipart bodies have arrived truncated, making
  // request.formData() throw "Failed to parse body as FormData" as a 500.
  // Buffering lets us parse what actually arrived and turn a malformed body
  // into a diagnosable 400 instead.
  const contentType = request.headers.get("content-type") ?? "";
  let bodyBytes: Buffer;
  try {
    bodyBytes = Buffer.from(await request.arrayBuffer());
  } catch (readError) {
    console.error("[org/logo] body read failed", {
      contentType,
      declaredLength: request.headers.get("content-length"),
      error: String(readError),
    });
    return NextResponse.json(
      { error: "Could not read uploaded file. Please try again." },
      { status: 400 },
    );
  }
  let formData: FormData;
  try {
    formData = await new Response(new Uint8Array(bodyBytes), {
      headers: { "content-type": contentType },
    }).formData();
  } catch (parseError) {
    // Log the multipart preamble (boundary + part headers only, no file
    // content) so we can see how the body was mangled.
    const headerEnd = bodyBytes.indexOf("\r\n\r\n");
    console.error("[org/logo] multipart parse failed", {
      contentType,
      declaredLength: request.headers.get("content-length"),
      receivedBytes: bodyBytes.byteLength,
      preamble: bodyBytes
        .subarray(0, Math.min(headerEnd === -1 ? 256 : headerEnd, 512))
        .toString("utf8"),
      error: String(parseError),
    });
    return NextResponse.json(
      { error: "Could not read uploaded file. Please try again." },
      { status: 400 },
    );
  }
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  const validationError = validateIconFile(file);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const filePath = `${orgId}/logo/${randomUUID()}.${deriveExtension(file)}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    await putObject(BUCKET_NAME, filePath, buffer, file.type);
  } catch (uploadError) {
    console.error("Org logo storage upload failed:", uploadError);
    return NextResponse.json(
      { error: "Failed to upload logo" },
      { status: 500 },
    );
  }

  const previous = await adminOrgBillingQueries.findByOrgId(orgId);
  const logoUrl = publicUrl(BUCKET_NAME, filePath);
  try {
    await adminOrgBillingQueries.patch(orgId, { logo_url: logoUrl });
  } catch (dbError) {
    console.error("Org logo DB update failed:", dbError);
    // Roll back the just-uploaded object so we don't orphan it on DB failure.
    await deleteObject(BUCKET_NAME, filePath).catch(() => {});
    return NextResponse.json({ error: "Failed to save logo" }, { status: 500 });
  }

  const previousKey = logoKeyFromUrl(previous?.logo_url ?? null, orgId);
  if (previousKey) {
    await deleteObject(BUCKET_NAME, previousKey).catch(() => {});
  }

  return NextResponse.json({ logoUrl });
});

export const DELETE = withRoleAuth(
  ["org:admin"],
  async (_request, { orgId }) => {
    const previous = await adminOrgBillingQueries.findByOrgId(orgId);
    await adminOrgBillingQueries.patch(orgId, { logo_url: null });

    const previousKey = logoKeyFromUrl(previous?.logo_url ?? null, orgId);
    if (previousKey) {
      await deleteObject(BUCKET_NAME, previousKey).catch(() => {});
    }

    return NextResponse.json({ logoUrl: null });
  },
);
