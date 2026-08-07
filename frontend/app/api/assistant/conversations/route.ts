import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/with-auth";
import { terminalConversationQueries } from "@/lib/db";
import type { Json } from "@/lib/db";

export const runtime = "nodejs";

/**
 * GET /api/assistant/conversations — the signed-in user's terminal threads
 * (summaries only, newest first). Per-user scoped.
 */
export const GET = withAuth(async (_req, { orgId, userId }) => {
  const conversations = await terminalConversationQueries.list(orgId, userId);
  return NextResponse.json({ conversations });
});

/**
 * POST /api/assistant/conversations — upsert a thread after a turn completes.
 * Body: { id?: string, title?: string, messages: Msg[] }. With an id it
 * overwrites that thread (if it's the user's); without one (or if the id is
 * gone) it creates a new thread. Returns { id } so the client can adopt it.
 */
export const POST = withAuth(async (request, { orgId, userId }) => {
  let body: { id?: unknown; title?: unknown; messages?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  if (!Array.isArray(body.messages)) {
    return NextResponse.json({ error: "messages required" }, { status: 400 });
  }
  const messages = body.messages as Json;
  const title =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim().slice(0, 200)
      : "Conversation";
  const id = typeof body.id === "string" && body.id ? body.id : null;

  if (id) {
    const updated = await terminalConversationQueries.update(
      orgId,
      userId,
      id,
      title,
      messages,
    );
    if (updated) return NextResponse.json({ id: updated.id });
    // id wasn't the user's / no longer exists — fall through to create.
  }

  const created = await terminalConversationQueries.create(
    orgId,
    userId,
    title,
    messages,
  );
  return NextResponse.json({ id: created.id }, { status: 201 });
});
