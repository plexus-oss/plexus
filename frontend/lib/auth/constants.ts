/**
 * Auth constants safe to import anywhere — including middleware (edge
 * bundle). Keep this module dependency-free; importing lib/auth/session
 * from middleware would drag the entire Auth.js + node:crypto graph into
 * the edge build.
 */

export const ACTIVE_ORG_COOKIE = "plexus-active-org";
export const IMPERSONATE_ORG_COOKIE = "plexus-impersonate-org";
