import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getAuth } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { feedbackQueries } from "@/lib/db";
import { emitSystemEvent } from "@/lib/events/emit";
import type { FeedbackType } from "@/lib/db/types";

/**
 * POST /api/feedback - Submit feedback
 * Requires authentication
 */
export async function POST(request: NextRequest) {
  try {
    const { userId, orgId } = await getAuth();
    if (!userId || !orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    // Validate required fields
    if (!body.title || typeof body.title !== "string" || !body.title.trim()) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    if (!body.message || typeof body.message !== "string" || !body.message.trim()) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    // Validate feedback type
    const validTypes: FeedbackType[] = ["bug", "feature", "general"];
    const feedbackType: FeedbackType = validTypes.includes(body.feedback_type)
      ? body.feedback_type
      : "general";

    // Get user email from the users mirror
    const userRows = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const userEmail = (userRows[0] as { email: string } | undefined)?.email ?? null;

    // Get user agent from request
    const userAgent = request.headers.get("user-agent");

    // Submit feedback
    const feedback = await feedbackQueries.submit(orgId, userId, {
      userEmail,
      feedbackType,
      title: body.title.trim(),
      message: body.message.trim(),
      pageUrl: body.page_url ?? null,
      userAgent,
      metadata: body.metadata ?? {},
    });

    emitSystemEvent({
      orgId,
      eventType: "feedback.submitted",
      category: "feedback",
      title: `Feedback submitted: ${body.title.trim()}`,
      severity: "info",
      entityId: feedback.id,
      entityType: "feedback",
      actorId: userId,
      metadata: { feedbackType },
    });

    return NextResponse.json({ success: true, id: feedback.id });
  } catch (error) {
    console.error("Feedback POST error:", error);
    return NextResponse.json(
      { error: "Failed to submit feedback" },
      { status: 500 }
    );
  }
}
