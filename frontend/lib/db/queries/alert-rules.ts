import { and, desc, eq } from "drizzle-orm";
import { db } from "../client";
import { alertRules } from "../schema";
import { oneOrNull } from "./shared";
import type { AlertRule, NewAlertRule, UpdateAlertRule } from "../types";

export const alertRuleQueries = {
  findAll: async (orgId: string): Promise<AlertRule[]> =>
    (await db
      .select()
      .from(alertRules)
      .where(eq(alertRules.org_id, orgId))
      .orderBy(desc(alertRules.created_at))) as AlertRule[],

  findById: async (orgId: string, id: string): Promise<AlertRule | null> => {
    const rows = await db
      .select()
      .from(alertRules)
      .where(and(eq(alertRules.org_id, orgId), eq(alertRules.id, id)))
      .limit(1);
    return oneOrNull(rows) as AlertRule | null;
  },

  findBySource: async (
    orgId: string,
    sourceId: string,
  ): Promise<AlertRule[]> =>
    (await db
      .select()
      .from(alertRules)
      .where(
        and(eq(alertRules.org_id, orgId), eq(alertRules.source_id, sourceId)),
      )
      .orderBy(desc(alertRules.created_at))) as AlertRule[],

  create: async (
    orgId: string,
    data: Omit<NewAlertRule, "org_id" | "id" | "created_at" | "updated_at">,
  ): Promise<AlertRule> => {
    const [result] = await db
      .insert(alertRules)
      .values({ org_id: orgId, ...data } as typeof alertRules.$inferInsert)
      .returning();
    return result as AlertRule;
  },

  update: async (
    orgId: string,
    id: string,
    data: Omit<UpdateAlertRule, "id" | "org_id" | "created_at">,
  ): Promise<AlertRule | null> => {
    const [result] = await db
      .update(alertRules)
      .set(data as Partial<typeof alertRules.$inferInsert>)
      .where(and(eq(alertRules.org_id, orgId), eq(alertRules.id, id)))
      .returning();
    return (result ?? null) as AlertRule | null;
  },

  delete: async (orgId: string, id: string): Promise<boolean> => {
    await db
      .delete(alertRules)
      .where(and(eq(alertRules.org_id, orgId), eq(alertRules.id, id)));
    return true;
  },
};
