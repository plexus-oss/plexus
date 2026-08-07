import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db } from "../client";
import { runs } from "../schema";

export type RunStatus = "active" | "completed" | "aborted";

export interface PassCriterion {
  metric: string;
  operator: ">" | ">=" | "<" | "<=" | "=" | "!=";
  value: number;
  label?: string;
}

export interface Run {
  id: string;
  org_id: string;
  name: string;
  source_id: string | null;
  status: RunStatus;
  started_at: string;
  ended_at: string | null;
  tags: unknown;
  metadata: unknown;
  pass_criteria: PassCriterion[];
  test_result: unknown;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const cols = {
  id: runs.id,
  org_id: runs.org_id,
  name: runs.name,
  source_id: runs.source_id,
  status: runs.status,
  started_at: runs.started_at,
  ended_at: runs.ended_at,
  tags: runs.tags,
  metadata: runs.metadata,
  pass_criteria: runs.pass_criteria,
  test_result: runs.test_result,
  created_by: runs.created_by,
  created_at: runs.created_at,
  updated_at: runs.updated_at,
};

export const runQueries = {
  insert: async (data: {
    org_id: string;
    name: string;
    source_id?: string | null;
    status?: RunStatus;
    started_at?: string;
    ended_at?: string | null;
    tags?: unknown;
    metadata?: unknown;
    pass_criteria?: PassCriterion[];
    created_by?: string | null;
  }): Promise<Run> => {
    const [row] = await db.insert(runs).values(data).returning(cols);
    return row as Run;
  },

  findById: async (orgId: string, id: string): Promise<Run | null> => {
    const [row] = await db
      .select(cols)
      .from(runs)
      .where(and(eq(runs.org_id, orgId), eq(runs.id, id)))
      .limit(1);
    return (row ?? null) as Run | null;
  },

  findByOrg: async (
    orgId: string,
    opts: { status?: RunStatus; sourceId?: string; limit?: number } = {},
  ): Promise<Run[]> => {
    const conditions = [eq(runs.org_id, orgId)];
    if (opts.status) conditions.push(eq(runs.status, opts.status));
    if (opts.sourceId) conditions.push(eq(runs.source_id, opts.sourceId));
    return (await db
      .select(cols)
      .from(runs)
      .where(and(...conditions))
      .orderBy(desc(runs.started_at))
      .limit(opts.limit ?? 100)) as Run[];
  },

  update: async (
    orgId: string,
    id: string,
    patch: Partial<
      Pick<
        Run,
        | "name"
        | "status"
        | "started_at"
        | "ended_at"
        | "tags"
        | "metadata"
        | "pass_criteria"
        | "test_result"
      >
    >,
  ): Promise<Run | null> => {
    const [row] = await db
      .update(runs)
      .set(patch)
      .where(and(eq(runs.org_id, orgId), eq(runs.id, id)))
      .returning(cols);
    return (row ?? null) as Run | null;
  },

  delete: async (orgId: string, id: string): Promise<boolean> => {
    const deleted = await db
      .delete(runs)
      .where(and(eq(runs.org_id, orgId), eq(runs.id, id)))
      .returning({ id: runs.id });
    return deleted.length > 0;
  },
};
