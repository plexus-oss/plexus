import "server-only";

import { db } from "@/lib/db/client";
import { systemEvents } from "@/lib/db/schema";
import type {
  SystemEventType,
  SystemEventCategory,
  SystemEventSeverity,
  Json,
} from "@/lib/db/types";

export interface EmitSystemEventParams {
  orgId: string;
  eventType: SystemEventType;
  category: SystemEventCategory;
  title: string;
  description?: string;
  severity?: SystemEventSeverity;
  sourceId?: string;
  sourceName?: string;
  sourceSlug?: string;
  entityId?: string;
  entityType?: string;
  actorId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Fire-and-forget system event emission.
 * Runs on the Drizzle pool (no RLS) so it can write for any org.
 * Never blocks the caller, never throws.
 */
export function emitSystemEvent(params: EmitSystemEventParams): void {
  db
    .insert(systemEvents)
    .values({
      org_id: params.orgId,
      event_type: params.eventType,
      category: params.category,
      title: params.title,
      description: params.description || null,
      severity: params.severity || "info",
      source_id: params.sourceId || null,
      source_name: params.sourceName || null,
      source_slug: params.sourceSlug || null,
      entity_id: params.entityId || null,
      entity_type: params.entityType || null,
      actor_id: params.actorId || null,
      metadata: (params.metadata || {}) as Json,
    } as typeof systemEvents.$inferInsert)
    .catch((err: unknown) => {
      console.error("Failed to emit system event:", err);
    });
}
