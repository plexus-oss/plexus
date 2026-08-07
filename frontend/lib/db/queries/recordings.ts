import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "../client";
import { recordings } from "../schema";

export type RecordingStatus =
  | "requested"
  | "recording"
  | "done"
  | "error"
  | "stop_requested";

export interface Recording {
  id: string;
  org_id: string;
  source_id: string | null;
  camera_id: string;
  status: RecordingStatus;
  expires_at: string;
  started_at: string | null;
  finished_at: string | null;
  playback_url: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

// Explicit column set — excludes gateway_api_key_id (kept off the public shape).
const cols = {
  id: recordings.id,
  org_id: recordings.org_id,
  source_id: recordings.source_id,
  camera_id: recordings.camera_id,
  status: recordings.status,
  expires_at: recordings.expires_at,
  started_at: recordings.started_at,
  finished_at: recordings.finished_at,
  playback_url: recordings.playback_url,
  error_message: recordings.error_message,
  created_at: recordings.created_at,
  updated_at: recordings.updated_at,
};

export const recordingQueries = {
  insert: async (data: {
    org_id: string;
    source_id?: string | null;
    camera_id: string;
    gateway_api_key_id?: string;
    expires_at: string;
  }): Promise<Recording> => {
    const [row] = await db.insert(recordings).values(data).returning(cols);
    return row as Recording;
  },

  findById: async (orgId: string, id: string): Promise<Recording | null> => {
    const [row] = await db
      .select(cols)
      .from(recordings)
      .where(and(eq(recordings.org_id, orgId), eq(recordings.id, id)))
      .limit(1);
    return (row ?? null) as Recording | null;
  },

  findByOrg: async (orgId: string, limit = 50): Promise<Recording[]> => {
    return (await db
      .select(cols)
      .from(recordings)
      .where(eq(recordings.org_id, orgId))
      .orderBy(desc(recordings.created_at))
      .limit(limit)) as Recording[];
  },

  findBySource: async (
    orgId: string,
    sourceId: string,
    limit = 50,
  ): Promise<Recording[]> => {
    return (await db
      .select(cols)
      .from(recordings)
      .where(
        and(eq(recordings.org_id, orgId), eq(recordings.source_id, sourceId)),
      )
      .orderBy(desc(recordings.created_at))
      .limit(limit)) as Recording[];
  },

  update: async (
    id: string,
    patch: Partial<
      Pick<
        Recording,
        | "status"
        | "started_at"
        | "finished_at"
        | "playback_url"
        | "error_message"
      >
    >,
  ): Promise<void> => {
    await db.update(recordings).set(patch).where(eq(recordings.id, id));
  },

  stopRequested: async (orgId: string, id: string): Promise<boolean> => {
    await db
      .update(recordings)
      .set({ status: "stop_requested" })
      .where(
        and(
          eq(recordings.id, id),
          eq(recordings.org_id, orgId),
          inArray(recordings.status, ["requested", "recording"]),
        ),
      );
    return true;
  },
};
