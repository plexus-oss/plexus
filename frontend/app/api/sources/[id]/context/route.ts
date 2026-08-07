/**
 * Source Context API - List and Create
 *
 * GET /api/sources/[id]/context - List all context items for a source
 * POST /api/sources/[id]/context - Create a link or note (use /upload for files)
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth/session";
import { findSourceByIdOrSlug } from "@/lib/api/find-source";
import { sourceContextQueries } from "@/lib/db";
import { enforceSource } from "@/lib/access/sources";
import { isApiError, errorResponse } from "@/lib/api/errors";
import type { SourceContextType } from "@/lib/db/types";

// GET /api/sources/[id]/context
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { orgId, userId, orgRole } = await getAuth();
    if (!orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
      "view",
    );

    // Optional type filter
    const typeFilter = request.nextUrl.searchParams.get(
      "type"
    ) as SourceContextType | null;

    const context =
      typeFilter && ["file", "link", "note"].includes(typeFilter)
        ? await sourceContextQueries.findBySourceAndType(
            orgId,
            source.id,
            typeFilter
          )
        : await sourceContextQueries.findBySource(orgId, source.id);

    return NextResponse.json({ context });
  } catch (error) {
    if (isApiError(error)) {
      return errorResponse(error);
    }
    console.error("Error fetching source context:", error);
    return NextResponse.json(
      { error: "Failed to fetch context" },
      { status: 500 }
    );
  }
}

// POST /api/sources/[id]/context
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { orgId, userId, orgRole } = await getAuth();
    if (!orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

    const body = await request.json();
    const { context_type, name, description, link_url, content } = body;

    // Validate required fields
    if (!context_type || !name) {
      return NextResponse.json(
        { error: "context_type and name are required" },
        { status: 400 }
      );
    }

    // Only allow creating links and notes via this endpoint
    if (!["link", "note"].includes(context_type)) {
      return NextResponse.json(
        { error: "Use /context/upload endpoint for files" },
        { status: 400 }
      );
    }

    // Validate type-specific fields
    if (context_type === "link" && !link_url) {
      return NextResponse.json(
        { error: "link_url is required for links" },
        { status: 400 }
      );
    }

    if (context_type === "note" && !content) {
      return NextResponse.json(
        { error: "content is required for notes" },
        { status: 400 }
      );
    }

    const result = await sourceContextQueries.insert(orgId, {
      source_id: source.id,
      context_type,
      name,
      description: description || null,
      link_url: context_type === "link" ? link_url : null,
      content: context_type === "note" ? content : null,
      created_by: userId || null,
    });

    return NextResponse.json({ contextItem: result[0] }, { status: 201 });
  } catch (error) {
    if (isApiError(error)) {
      return errorResponse(error);
    }
    console.error("Error creating source context:", error);
    return NextResponse.json(
      { error: "Failed to create context" },
      { status: 500 }
    );
  }
}
