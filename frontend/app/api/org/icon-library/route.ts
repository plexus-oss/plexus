/**
 * Org Icon Library API
 *
 * GET  /api/org/icon-library — list the org's uploaded icon images
 * POST /api/org/icon-library — upload an image into the org library
 *
 * Uploads land in the public `dashboard-icons` bucket at
 * `{orgId}/library/{uuid}.{ext}` and are tracked in `dashboard_icon_assets`
 * so they can be reused across dashboards. Assigning an image to a dashboard
 * is a separate PUT /api/dashboards/[id] with `icon_url`.
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/with-auth";
import { dashboardIconAssetQueries } from "@/lib/db";
import {
  BUCKET_NAME,
  deriveExtension,
  isStorageConfigured,
  validateIconFile,
} from "@/lib/storage/dashboard-icons";
import { deleteObject, publicUrl, putObject } from "@/lib/storage/s3";
import { randomUUID } from "crypto";

export const GET = withAuth(async (_request, { orgId }) => {
  const icons = await dashboardIconAssetQueries.findAllOrdered(orgId);
  return NextResponse.json({ icons });
});

export const POST = withAuth(async (request, { userId, orgId }) => {
  if (!isStorageConfigured()) {
    return NextResponse.json(
      { error: "File upload not configured" },
      { status: 503 },
    );
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  const validationError = validateIconFile(file);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const filePath = `${orgId}/library/${randomUUID()}.${deriveExtension(file)}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    await putObject(BUCKET_NAME, filePath, buffer, file.type);
  } catch (uploadError) {
    console.error("Icon library storage upload failed:", uploadError);
    return NextResponse.json(
      {
        error: "Failed to upload icon",
        detail:
          uploadError instanceof Error
            ? uploadError.message
            : String(uploadError),
      },
      { status: 500 },
    );
  }

  let asset;
  try {
    asset = (
      await dashboardIconAssetQueries.insert(orgId, {
        url: publicUrl(BUCKET_NAME, filePath),
        storage_path: filePath,
        file_name: file.name || null,
        content_type: file.type || null,
        size_bytes: file.size,
        created_by: userId,
      })
    )[0];
  } catch (dbError) {
    console.error("Icon library DB insert failed:", dbError);
    // Roll back the just-uploaded object so we don't orphan it on DB failure.
    await deleteObject(BUCKET_NAME, filePath).catch(() => {});
    return NextResponse.json(
      {
        error: "Failed to save icon",
        detail: dbError instanceof Error ? dbError.message : String(dbError),
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ icon: asset }, { status: 201 });
});
