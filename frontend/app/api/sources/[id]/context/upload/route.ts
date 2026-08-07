/**
 * Source Context Upload API
 *
 * POST /api/sources/[id]/context/upload - Upload a file to Tigris object storage
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth/session";
import { findSourceByIdOrSlug } from "@/lib/api/find-source";
import { sourceContextQueries } from "@/lib/db";
import { enforceSource } from "@/lib/access/sources";
import { isApiError, errorResponse } from "@/lib/api/errors";
import {
  CONTEXT_BUCKET,
  isStorageConfigured,
  publicUrl,
  putObject,
} from "@/lib/storage/s3";
import { randomUUID } from "crypto";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

// POST /api/sources/[id]/context/upload
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { orgId, userId, orgRole } = await getAuth();
    if (!orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check storage configuration
    if (!isStorageConfigured()) {
      return NextResponse.json(
        { error: "File upload not configured" },
        { status: 503 }
      );
    }

    const { id } = await params;
    const source = await findSourceByIdOrSlug(orgId, id);
    if (!source) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }

    await enforceSource(
      {
        orgId,
        userId: userId ?? undefined,
        orgRole: orgRole ?? undefined,
        isApiKeyAuth: false,
      },
      source,
      "edit",
    );

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const customName = formData.get("name") as string | null;
    const description = formData.get("description") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large (max 50MB)" },
        { status: 400 }
      );
    }

    // Generate storage path: {org_id}/{source_id}/{uuid}.{ext}
    const fileExtension = file.name.split(".").pop() || "";
    const fileId = randomUUID();
    const filePath = `${orgId}/${source.id}/${fileId}.${fileExtension}`;

    // Upload to Tigris (private bucket; downloads are served via signed URLs).
    const buffer = Buffer.from(await file.arrayBuffer());

    try {
      await putObject(
        CONTEXT_BUCKET,
        filePath,
        buffer,
        file.type || "application/octet-stream",
      );
    } catch (uploadError) {
      console.error("Tigris storage upload error:", uploadError);
      return NextResponse.json(
        { error: "Failed to upload file" },
        { status: 500 }
      );
    }

    // Canonical object URL stored for reference; the GET route serves a
    // short-lived signed URL since the bucket is private.
    const fileUrl = publicUrl(CONTEXT_BUCKET, filePath);

    // Create database record
    const result = await sourceContextQueries.insert(orgId, {
      source_id: source.id,
      context_type: "file",
      name: customName || file.name,
      description: description || null,
      file_url: fileUrl,
      file_key: filePath, // Store path for deletion
      file_size: file.size,
      mime_type: file.type || "application/octet-stream",
      created_by: userId || null,
    });

    return NextResponse.json({ contextItem: result[0] }, { status: 201 });
  } catch (error) {
    if (isApiError(error)) {
      return errorResponse(error);
    }
    console.error("Error uploading file:", error);
    return NextResponse.json(
      { error: "Failed to upload file" },
      { status: 500 }
    );
  }
}
