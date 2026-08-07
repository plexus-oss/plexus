/**
 * Org member invitations.
 *
 * GET  /api/org/invites — pending invites for the active org (admin)
 * POST /api/org/invites — create + email an invite (admin)
 *
 * Tokens: 32 random bytes hex, emailed as a link; only the sha256 hash
 * is stored. 7-day expiry, single-use via accepted_at.
 */

import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { withRoleAuth } from "@/lib/api/with-auth";
import { adminOrgRoleQueries } from "@/lib/db/server";
import { hashInviteToken } from "@/lib/auth/invites";
import { db } from "@/lib/db/client";
import { orgBilling, orgInvites, orgMembers } from "@/lib/db/schema";
import { sendTransactionalEmail } from "@/lib/email/transactional";
import { emailButton, renderEmail } from "@/lib/email/layout";
import { emitSystemEvent } from "@/lib/events/emit";
import { getAppUrl } from "@/lib/stripe";

const INVITE_TTL_DAYS = 7;
const VALID_ROLES = new Set(["org:admin", "org:editor", "org:viewer"]);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function inviteEmailHtml(args: { orgName: string; url: string }): string {
  const body = `
    <p style="font-size:18px;font-weight:600;color:#18181b;margin:0 0 14px;">You've been invited to ${args.orgName}</p>
    <p>You've been invited to join <strong>${args.orgName}</strong> on Plexus — telemetry and observability for hardware fleets.</p>
    <p style="margin:18px 0 22px;">${emailButton(args.url, "Accept the invitation →")}</p>
    <p style="font-size:14px;color:#71717a;">This link expires in ${INVITE_TTL_DAYS} days. If you weren't expecting it, you can ignore this email.</p>
    <p style="color:#a1a1aa;">— Plexus</p>
  `;
  return renderEmail({
    bodyHtml: body,
    preheader: `Join ${args.orgName} on Plexus`,
  });
}

export const GET = withRoleAuth(["org:admin"], async (_req, { orgId }) => {
  const data = await db
    .select({
      id: orgInvites.id,
      email: orgInvites.email,
      role: orgInvites.role,
      created_at: orgInvites.created_at,
      expires_at: orgInvites.expires_at,
    })
    .from(orgInvites)
    .where(
      and(
        eq(orgInvites.org_id, orgId),
        isNull(orgInvites.accepted_at),
        gt(orgInvites.expires_at, new Date().toISOString()),
      ),
    )
    .orderBy(desc(orgInvites.created_at));
  return NextResponse.json({ invites: data });
});

export const POST = withRoleAuth(
  ["org:admin"],
  async (request, { orgId, userId }) => {
    const body = (await request.json().catch(() => ({}))) as {
      email?: string;
      role?: string;
      // Scope applied to the member on accept: null/omitted = full access;
      // array (incl. empty) = restricted allow-list of sources.
      allowedSourceIds?: string[] | null;
    };
    const email = body.email?.trim().toLowerCase();
    const role = body.role ?? "org:viewer";
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    }
    // Built-in, or an existing custom role id.
    if (!VALID_ROLES.has(role)) {
      const custom =
        UUID_RE.test(role) && (await adminOrgRoleQueries.findById(orgId, role));
      if (!custom) {
        return NextResponse.json({ error: "Invalid role" }, { status: 400 });
      }
    }

    const allowedSourceIds = Array.isArray(body.allowedSourceIds)
      ? [...new Set(body.allowedSourceIds.filter((id) => UUID_RE.test(id)))]
      : null;
    // Admins are never scoped — refuse the confusing no-op.
    if (allowedSourceIds && role === "org:admin") {
      return NextResponse.json(
        { error: "Admins have unrestricted access; pick a lower role to scope." },
        { status: 409 },
      );
    }

    const existingMemberRows = await db
      .select({ user_id: orgMembers.user_id })
      .from(orgMembers)
      .where(and(eq(orgMembers.org_id, orgId), eq(orgMembers.email, email)))
      .limit(1);
    const existingMember = existingMemberRows[0] ?? null;
    if (existingMember) {
      return NextResponse.json({ error: "Already a member" }, { status: 409 });
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(
      Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    const [invite] = await db
      .insert(orgInvites)
      .values({
        org_id: orgId,
        email,
        role,
        allowed_source_ids: allowedSourceIds,
        token_hash: hashInviteToken(token),
        invited_by: userId,
        expires_at: expiresAt,
      } as typeof orgInvites.$inferInsert)
      .returning({
        id: orgInvites.id,
        email: orgInvites.email,
        role: orgInvites.role,
        created_at: orgInvites.created_at,
        expires_at: orgInvites.expires_at,
      });

    const orgRows = await db
      .select({ org_name: orgBilling.org_name })
      .from(orgBilling)
      .where(eq(orgBilling.org_id, orgId))
      .limit(1);
    const orgName = orgRows[0]?.org_name ?? "a workspace";

    const sendResult = await sendTransactionalEmail({
      to: email,
      subject: `You've been invited to ${orgName} on Plexus`,
      html: inviteEmailHtml({ orgName, url: `${getAppUrl()}/invite/${token}` }),
      idempotencyKey: `org-invite-${invite.id}`,
    });
    if (!sendResult.success) {
      await db.delete(orgInvites).where(eq(orgInvites.id, invite.id));
      return NextResponse.json(
        { error: "Could not send the invite email" },
        { status: 502 },
      );
    }

    emitSystemEvent({
      orgId,
      eventType: "member.invited",
      category: "member",
      title: `Invited ${email}`,
      actorId: userId,
      metadata: { email, role },
    });

    return NextResponse.json({ invite });
  },
);
