/**
 * Identity-value → source-slug mapping. Deterministic so re-discovery is
 * idempotent. Raw values are preserved verbatim on the association
 * (filter_value) and as the source name; the slug is only the address.
 *
 * Kind-aware: satellites follow the app-wide `sat-<id>` convention (TLE
 * refresh, orbital panels, and existing ingest-registered satellites all key
 * on it), so discovery CONVERGES on those sources instead of minting bare-id
 * duplicates.
 */
import { createHash } from "node:crypto";
import { isUuid } from "@/lib/utils/uuid";

const MAX_SLUG_LEN = 63;

/** Kinds with an app-wide slug prefix convention. */
const KIND_PREFIX: Record<string, string> = {
  satellite: "sat-",
};

export function slugForIdentity(value: string, kind?: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/-+$/, "")
    .slice(0, MAX_SLUG_LEN);
  // Unsluggable or uuid-shaped (unreachable through the app's resolvers):
  // fall back to a stable content hash.
  if (!slug || isUuid(slug)) {
    const hash = createHash("sha256").update(value).digest("hex").slice(0, 8);
    return `d-${hash}`;
  }
  const prefix = kind ? KIND_PREFIX[kind] : undefined;
  if (prefix && !slug.startsWith(prefix)) {
    return `${prefix}${slug}`.slice(0, MAX_SLUG_LEN);
  }
  return slug;
}
