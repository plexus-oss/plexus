/**
 * Terminal conversation persistence — per-USER scoped chat history for the
 * Plexus Terminal. Every method takes (orgId, userId) and filters by both, so
 * a user only ever touches their own threads (RLS isolates the org; userId
 * isolates the person within it).
 *
 * The full rendered Msg[] is stored in `messages` (JSONB) so the UI re-hydrates
 * exactly on load.
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "../client";
import { terminalConversations } from "../schema";
import { oneOrNull } from "./shared";
import type { Json, TerminalConversation } from "../types";

/** Lightweight row for the history list (no message bodies). */
export interface ConversationSummary {
  id: string;
  title: string;
  updated_at: string;
}

export const terminalConversationQueries = {
  /** The user's threads, newest first — summaries only (no message bodies). */
  list: async (
    orgId: string,
    userId: string,
    limit = 50,
  ): Promise<ConversationSummary[]> => {
    return (await db
      .select({
        id: terminalConversations.id,
        title: terminalConversations.title,
        updated_at: terminalConversations.updated_at,
      })
      .from(terminalConversations)
      .where(
        and(
          eq(terminalConversations.org_id, orgId),
          eq(terminalConversations.user_id, userId),
        ),
      )
      .orderBy(desc(terminalConversations.updated_at))
      .limit(limit)) as ConversationSummary[];
  },

  /** A single thread with its full message history (own-thread only). */
  get: async (
    orgId: string,
    userId: string,
    id: string,
  ): Promise<TerminalConversation | null> => {
    const rows = await db
      .select()
      .from(terminalConversations)
      .where(
        and(
          eq(terminalConversations.org_id, orgId),
          eq(terminalConversations.user_id, userId),
          eq(terminalConversations.id, id),
        ),
      )
      .limit(1);
    return oneOrNull(rows) as TerminalConversation | null;
  },

  /** Insert a new thread, returning its id. */
  create: async (
    orgId: string,
    userId: string,
    title: string,
    messages: Json,
  ): Promise<TerminalConversation> => {
    const [result] = await db
      .insert(terminalConversations)
      .values({
        org_id: orgId,
        user_id: userId,
        title,
        messages,
      } as typeof terminalConversations.$inferInsert)
      .returning();
    return result as TerminalConversation;
  },

  /** Overwrite an existing thread's messages/title and bump updated_at. Scoped
   * to the owner — returns null if the id isn't theirs. */
  update: async (
    orgId: string,
    userId: string,
    id: string,
    title: string,
    messages: Json,
  ): Promise<TerminalConversation | null> => {
    const [result] = await db
      .update(terminalConversations)
      .set({
        title,
        messages,
        updated_at: new Date().toISOString(),
      } as Partial<typeof terminalConversations.$inferInsert>)
      .where(
        and(
          eq(terminalConversations.org_id, orgId),
          eq(terminalConversations.user_id, userId),
          eq(terminalConversations.id, id),
        ),
      )
      .returning();
    return (result ?? null) as TerminalConversation | null;
  },

  /** Delete a thread (own-thread only). */
  remove: async (orgId: string, userId: string, id: string): Promise<void> => {
    await db
      .delete(terminalConversations)
      .where(
        and(
          eq(terminalConversations.org_id, orgId),
          eq(terminalConversations.user_id, userId),
          eq(terminalConversations.id, id),
        ),
      );
  },
};
