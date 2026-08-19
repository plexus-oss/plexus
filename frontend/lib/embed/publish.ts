import "server-only";

/**
 * Durable published-embed tokens. Unlike the short-lived JWT (minted per view by
 * the customer's backend), a durable token is created ONCE at setup, stored +
 * revocable, and pasted directly into `<PlexusPanel>` or an <iframe> — no backend
 * and no API key. It's public by design; safety comes from being read-only,
 * single-panel, revocable, and gated to VERIFIED origins by CORS.
 */

import { randomBytes } from "node:crypto";
import { adminEmbedPublishQueries } from "@/lib/db/server";

export const EMBED_TOKEN_PREFIX = "emb_";

export function generateEmbedPublishToken(): string {
  return EMBED_TOKEN_PREFIX + randomBytes(24).toString("hex");
}

/** Durable tokens carry a fixed prefix; short-lived JWTs don't. */
export function isDurableEmbedToken(token: string): boolean {
  return token.startsWith(EMBED_TOKEN_PREFIX);
}

export interface DurableTokenScope {
  orgId: string;
  dashboardId: string;
  panelId: string;
  timeRange: string | null;
}

/** Resolve a durable token to its panel scope, or null if unknown/revoked. */
export async function resolveDurableToken(
  token: string,
): Promise<DurableTokenScope | null> {
  const row = await adminEmbedPublishQueries.findActiveByToken(token);
  if (!row) return null;
  return {
    orgId: row.org_id,
    dashboardId: row.dashboard_id,
    panelId: row.panel_id,
    timeRange: row.time_range ?? null,
  };
}
