/**
 * Embed entitlement — is an org allowed to mint embed tokens?
 *
 * The embed capability is a paid, flat-annual SKU (one line item per embedding
 * company). Chunk 1 gates on a simple allowlist env so we can enable a specific
 * org in staging today:
 *   PLEXUS_EMBED_ORG_ALLOWLIST=org_abc,org_def
 *
 * The pricing chunk swaps the body of this function for a Stripe-backed
 * entitlement flag (or the lib/licensing seam) WITHOUT touching any caller —
 * every mint path already funnels through here.
 */

import "server-only";

export function isEmbedEntitled(orgId: string): boolean {
  if (!orgId) return false;
  const raw = process.env.PLEXUS_EMBED_ORG_ALLOWLIST;
  if (!raw) return false;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(orgId);
}
