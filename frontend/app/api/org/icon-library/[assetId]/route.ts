/**
 * Org Icon Library API — single asset
 *
 * DELETE /api/org/icon-library/[assetId] — remove an image from the library.
 *
 * Deleting removes the storage object and nulls `icon_url` on every dashboard
 * that references it, so they fall back to their lucide/emoji icon.
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/with-auth";
import { apiError } from "@/lib/api/errors";
import { dashboardIconAssetQueries, dashboardQueries } from "@/lib/db";
import { BUCKET_NAME, isStorageConfigured } from "@/lib/storage/dashboard-icons";
import { deleteObject } from "@/lib/storage/s3";

export const DELETE = withAuth(
  async (_request, { orgId, userId, orgRole, params }) => {
  const { assetId } = await params;

  const asset = (await dashboardIconAssetQueries.findById(orgId, assetId))[0];
  if (!asset) {
    return NextResponse.json({ error: "Icon not found" }, { status: 404 });
  }

  // Shared org asset: only admins or the uploader may delete it (deletion
  // also clears the icon from every dashboard that references it).
  if (orgRole !== "org:admin" && asset.created_by !== userId) {
    throw apiError(
      "FORBIDDEN",
      "Only org admins or the uploader can delete this icon",
    );
  }

  if (isStorageConfigured()) {
    try {
      await deleteObject(BUCKET_NAME, asset.storage_path);
    } catch (removeError) {
      console.error("Failed to remove icon library object:", removeError);
    }
  }

  await dashboardQueries.clearIconUrlReferences(orgId, asset.url);
  await dashboardIconAssetQueries.delete(orgId, assetId);

  return NextResponse.json({ success: true });
});
