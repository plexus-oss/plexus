import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/with-auth";
import { terminalConversationQueries } from "@/lib/db";

export const runtime = "nodejs";

/**
 * GET /api/assistant/conversations/[id] — full message history for one of the
 * user's threads (own-thread only; 404 otherwise).
 */
export const GET = withAuth(async (_req, { orgId, userId, params }) => {
  const { id } = await params;
  const conversation = await terminalConversationQueries.get(orgId, userId, id);
  if (!conversation) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({
    id: conversation.id,
    title: conversation.title,
    messages: conversation.messages,
    updated_at: conversation.updated_at,
  });
});

/**
 * DELETE /api/assistant/conversations/[id] — remove one of the user's threads.
 */
export const DELETE = withAuth(async (_req, { orgId, userId, params }) => {
  const { id } = await params;
  await terminalConversationQueries.remove(orgId, userId, id);
  return NextResponse.json({ ok: true });
});
