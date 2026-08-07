import { sourceQueries } from "@/lib/db";
import { adminSourceQueries } from "@/lib/db/server";
import { UUID_REGEX, isUuid } from "@/lib/utils/uuid";

// Any API route that accepts a source reference must resolve it here (or via
// adminSourceQueries.resolveRef for admin-only paths) instead of re-rolling
// the UUID regex — that drift is what hid offline monitors from the UI.
export { UUID_REGEX, isUuid };

/** Session-client resolution (RLS-scoped). Accepts UUID or slug. */
export async function findSourceByIdOrSlug(orgId: string, idOrSlug: string) {
  if (isUuid(idOrSlug)) {
    const sources = await sourceQueries.findById(orgId, idOrSlug);
    if (sources.length > 0) return sources[0];
  }
  const sources = await sourceQueries.findBySlug(orgId, idOrSlug);
  return sources.length > 0 ? sources[0] : null;
}

/**
 * Boundary resolver for dual-auth routes. Dispatches to the session client for
 * user sessions or the admin client for API-key auth (API keys are org-scoped,
 * not RLS-scoped). Returns the source row or null.
 */
export async function findSourceByRef(
  orgId: string,
  ref: string,
  isApiKeyAuth: boolean,
) {
  if (!isApiKeyAuth) return findSourceByIdOrSlug(orgId, ref);
  if (isUuid(ref)) {
    const source = await adminSourceQueries.findById(ref);
    if (source && source.org_id === orgId) return source;
  }
  const rows = await adminSourceQueries.findBySlug(orgId, ref);
  return rows[0] ?? null;
}
