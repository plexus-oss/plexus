/**
 * Source Context Item API - Get, Update, Delete
 *
 * GET /api/sources/[id]/context/[contextId] - Get single context item
 * PATCH /api/sources/[id]/context/[contextId] - Update context item
 * DELETE /api/sources/[id]/context/[contextId] - Delete context item
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth/session";
import { sourceContextQueries, sourceQueries } from "@/lib/db";
import { enforceSource, type AccessLevel } from "@/lib/access/sources";
import { isApiError, errorResponse } from "@/lib/api/errors";
import {
  CONTEXT_BUCKET,
  deleteObject,
  isStorageConfigured,
  presignGetUrl,
} from "@/lib/storage/s3";

/** Per-source grant check for the item's parent device. */
async function enforceItemSource(
  ctx: { orgId: string; userId: string | null; orgRole: string | null | undefined },
  sourceId: string,
  need: AccessLevel,
): Promise<void> {
  const sources = await sourceQueries.findById(ctx.orgId, sourceId);
  if (sources.length === 0) return; // orphaned item; org scoping already applied
  await enforceSource(
    {
      orgId: ctx.orgId,
      userId: ctx.userId ?? undefined,
      orgRole: ctx.orgRole ?? undefined,
      isApiKeyAuth: false,
    },
    sources[0],
    need,
  );
}

// GET /api/sources/[id]/context/[contextId]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; contextId: string }> }
) {
  try {
    const { orgId, userId, orgRole } = await getAuth();
    if (!orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { contextId } = await params;
    const items = await sourceContextQueries.findById(orgId, contextId);

    if (items.length === 0) {
      return NextResponse.json(
        { error: "Context item not found" },
        { status: 404 }
      );
    }

    const item = items[0];

    await enforceItemSource({ orgId, userId, orgRole }, item.source_id, "view");

    // The source-context bucket is private, so serve a short-lived signed URL.
    if (item.context_type === "file" && item.file_key && isStorageConfigured()) {
      try {
        const downloadUrl = await presignGetUrl(
          CONTEXT_BUCKET,
          item.file_key,
          3600,
        ); // 1 hour expiry
        return NextResponse.json({
          contextItem: { ...item, download_url: downloadUrl },
        });
      } catch (storageError) {
        console.error("Error generating signed URL:", storageError);
        // Return item without download URL if storage fails
      }
    }

    return NextResponse.json({ contextItem: item });
  } catch (error) {
    if (isApiError(error)) {
      return errorResponse(error);
    }
    console.error("Error fetching context item:", error);
    return NextResponse.json(
      { error: "Failed to fetch context item" },
      { status: 500 }
    );
  }
}

// PATCH /api/sources/[id]/context/[contextId]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; contextId: string }> }
) {
  try {
    const { orgId, userId, orgRole } = await getAuth();
    if (!orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { contextId } = await params;

    const existing = await sourceContextQueries.findById(orgId, contextId);
    if (existing.length === 0) {
      return NextResponse.json(
        { error: "Context item not found" },
        { status: 404 }
      );
    }
    await enforceItemSource(
      { orgId, userId, orgRole },
      existing[0].source_id,
      "edit",
    );

    const body = await request.json();

    // Only allow updating certain fields
    const allowedFields = ["name", "description", "content", "link_url"];
    const updateData: Record<string, unknown> = {};

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    const result = await sourceContextQueries.update(
      orgId,
      contextId,
      updateData
    );

    if (result.length === 0) {
      return NextResponse.json(
        { error: "Context item not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ contextItem: result[0] });
  } catch (error) {
    if (isApiError(error)) {
      return errorResponse(error);
    }
    console.error("Error updating context item:", error);
    return NextResponse.json(
      { error: "Failed to update context item" },
      { status: 500 }
    );
  }
}

// DELETE /api/sources/[id]/context/[contextId]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; contextId: string }> }
) {
  try {
    const { orgId, userId, orgRole } = await getAuth();
    if (!orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { contextId } = await params;

    // Get item first to check for storage cleanup
    const items = await sourceContextQueries.findById(orgId, contextId);
    if (items.length === 0) {
      return NextResponse.json(
        { error: "Context item not found" },
        { status: 404 }
      );
    }

    const item = items[0];

    await enforceItemSource({ orgId, userId, orgRole }, item.source_id, "edit");

    // Delete the object from Tigris if it's a file
    if (item.context_type === "file" && item.file_key && isStorageConfigured()) {
      try {
        await deleteObject(CONTEXT_BUCKET, item.file_key);
      } catch (storageError) {
        console.error("Failed to delete storage object:", storageError);
        // Continue with DB deletion even if storage fails
      }
    }

    await sourceContextQueries.delete(orgId, contextId);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (isApiError(error)) {
      return errorResponse(error);
    }
    console.error("Error deleting context item:", error);
    return NextResponse.json(
      { error: "Failed to delete context item" },
      { status: 500 }
    );
  }
}
