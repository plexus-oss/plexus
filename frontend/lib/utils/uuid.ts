/**
 * The single UUID-shape predicate. Source identity is (org_id, slug); UUIDs
 * are internal FKs. Kept dependency-free so validation schemas (client-safe)
 * and server resolvers can share it. Resolution logic itself lives in
 * lib/api/find-source.ts / adminSourceQueries.resolveRef — never re-roll it.
 */
export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}
