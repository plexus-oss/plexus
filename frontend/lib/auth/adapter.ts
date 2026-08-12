/**
 * Custom Auth.js adapter over the Drizzle (service-role) client.
 *
 * Custom (rather than @auth/supabase-adapter) for one load-bearing reason:
 * we own ID generation. Backfilled users keep their Clerk ids (user_...)
 * as primary keys so org_members and every actor_id/created_by column in
 * the app keeps working untouched; new users get the same shape from
 * newUserId(). Stock adapters generate UUIDs and would fork the ID space.
 *
 * Emails are lowercased on every write and lookup — magic-code sign-in
 * identifies users purely by email, so case mismatches would mint
 * duplicate accounts (users_email_lower_idx backstops this at the DB).
 */

import "server-only";

import { randomUUID } from "node:crypto";
import type {
  Adapter,
  AdapterAccount,
  AdapterSession,
  AdapterUser,
  VerificationToken,
} from "next-auth/adapters";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { isOtpLocked, recordOtpFailure, clearOtpFailures } from "@/lib/auth/otp-throttle";
import {
  users,
  authAccounts,
  authSessions,
  authVerificationTokens,
} from "@/lib/db/schema";
import type { Database } from "@/lib/db/types";

type UserRow = Database["public"]["Tables"]["users"]["Row"];
type SessionRow = Database["public"]["Tables"]["auth_sessions"]["Row"];

export function newUserId(): string {
  return `user_${randomUUID().replace(/-/g, "")}`;
}

/** AdapterUser plus the app fields the session callback exposes. */
export interface PlexusAdapterUser extends AdapterUser {
  isStaff: boolean;
}

function rowToUser(row: UserRow): PlexusAdapterUser {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.email_verified ? new Date(row.email_verified) : null,
    name:
      [row.first_name, row.last_name].filter(Boolean).join(" ") || null,
    image: row.image_url,
    isStaff: row.is_staff,
  };
}

function rowToSession(row: SessionRow): AdapterSession {
  return {
    sessionToken: row.session_token,
    userId: row.user_id,
    expires: new Date(row.expires),
  };
}

function splitName(name: string | null | undefined): {
  first_name: string | null;
  last_name: string | null;
} {
  if (!name) return { first_name: null, last_name: null };
  const [first, ...rest] = name.trim().split(/\s+/);
  return { first_name: first || null, last_name: rest.join(" ") || null };
}

export function supabaseAdapter(): Adapter {
  return {
    async createUser(user) {
      const [row] = await db
        .insert(users)
        .values({
          id: newUserId(),
          email: user.email.toLowerCase(),
          email_verified: user.emailVerified?.toISOString() ?? null,
          image_url: user.image ?? null,
          ...splitName(user.name),
        } as typeof users.$inferInsert)
        .returning();
      return rowToUser(row as UserRow);
    },

    async getUser(id) {
      const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      return row ? rowToUser(row as UserRow) : null;
    },

    async getUserByEmail(email) {
      const [row] = await db
        .select()
        .from(users)
        .where(eq(users.email, email.toLowerCase()))
        .limit(1);
      return row ? rowToUser(row as UserRow) : null;
    },

    async getUserByAccount({ provider, providerAccountId }) {
      const [account] = await db
        .select({ user_id: authAccounts.user_id })
        .from(authAccounts)
        .where(
          and(
            eq(authAccounts.provider, provider),
            eq(authAccounts.provider_account_id, providerAccountId),
          ),
        )
        .limit(1);
      if (!account) return null;
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, account.user_id))
        .limit(1);
      return user ? rowToUser(user as UserRow) : null;
    },

    async updateUser(user) {
      const update: Record<string, unknown> = {};
      if (user.email !== undefined) update.email = user.email.toLowerCase();
      if (user.emailVerified !== undefined) {
        update.email_verified = user.emailVerified?.toISOString() ?? null;
      }
      if (user.image !== undefined) update.image_url = user.image;
      if (user.name !== undefined) Object.assign(update, splitName(user.name));
      const [row] = await db
        .update(users)
        .set(update as Partial<typeof users.$inferInsert>)
        .where(eq(users.id, user.id))
        .returning();
      return rowToUser(row as UserRow);
    },

    async deleteUser(userId) {
      await db.delete(users).where(eq(users.id, userId));
    },

    async linkAccount(account: AdapterAccount) {
      await db.insert(authAccounts).values({
        provider: account.provider,
        provider_account_id: account.providerAccountId,
        user_id: account.userId,
        type: account.type,
        access_token: account.access_token ?? null,
        refresh_token: account.refresh_token ?? null,
        expires_at: account.expires_at ?? null,
        token_type: account.token_type ?? null,
        scope: account.scope ?? null,
        id_token: account.id_token ?? null,
        session_state: (account.session_state as string | undefined) ?? null,
      } as typeof authAccounts.$inferInsert);
    },

    async unlinkAccount({ provider, providerAccountId }) {
      await db
        .delete(authAccounts)
        .where(
          and(
            eq(authAccounts.provider, provider),
            eq(authAccounts.provider_account_id, providerAccountId),
          ),
        );
    },

    async createSession(session) {
      await db.insert(authSessions).values({
        session_token: session.sessionToken,
        user_id: session.userId,
        expires: session.expires.toISOString(),
      } as typeof authSessions.$inferInsert);
      return session;
    },

    async getSessionAndUser(sessionToken) {
      const [session] = await db
        .select()
        .from(authSessions)
        .where(eq(authSessions.session_token, sessionToken))
        .limit(1);
      if (!session) return null;
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, (session as SessionRow).user_id))
        .limit(1);
      if (!user) return null;
      return {
        session: rowToSession(session as SessionRow),
        user: rowToUser(user as UserRow),
      };
    },

    async updateSession(session) {
      const update: Record<string, unknown> = {};
      if (session.expires) update.expires = session.expires.toISOString();
      if (session.userId) update.user_id = session.userId;
      const [row] = await db
        .update(authSessions)
        .set(update as Partial<typeof authSessions.$inferInsert>)
        .where(eq(authSessions.session_token, session.sessionToken))
        .returning();
      return row ? rowToSession(row as SessionRow) : null;
    },

    async deleteSession(sessionToken) {
      await db
        .delete(authSessions)
        .where(eq(authSessions.session_token, sessionToken));
    },

    async createVerificationToken(token: VerificationToken) {
      await db.insert(authVerificationTokens).values({
        identifier: token.identifier.toLowerCase(),
        token: token.token,
        expires: token.expires.toISOString(),
      } as typeof authVerificationTokens.$inferInsert);
      return token;
    },

    async useVerificationToken({ identifier, token }) {
      const id = identifier.toLowerCase();

      // Brute-force guard: too many wrong guesses for this email → refuse and
      // burn every outstanding code so the attacker can't keep trying and the
      // real user must request a fresh one.
      if (isOtpLocked(id)) {
        await db
          .delete(authVerificationTokens)
          .where(eq(authVerificationTokens.identifier, id));
        return null;
      }

      // Single-use: delete-returning. A second attempt with the same code
      // finds nothing and fails verification.
      const [row] = await db
        .delete(authVerificationTokens)
        .where(
          and(
            eq(authVerificationTokens.identifier, id),
            eq(authVerificationTokens.token, token),
          ),
        )
        .returning();
      if (!row) {
        // Wrong (or already-used) code. Count it; on lockout, invalidate all
        // outstanding codes for this identifier.
        const { locked } = recordOtpFailure(id);
        if (locked) {
          await db
            .delete(authVerificationTokens)
            .where(eq(authVerificationTokens.identifier, id));
        }
        return null;
      }
      clearOtpFailures(id);
      return {
        identifier: row.identifier,
        token: row.token,
        expires: new Date(row.expires),
      };
    },
  };
}
