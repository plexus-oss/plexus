/**
 * Enterprise feature registry — the only place to add a license-gated feature.
 *
 * Adding a gated feature = one entry here + one `entitled()` / `accessLevel()`
 * check at the seam. Everything else (token parsing, tiers, grace behavior)
 * is owned by lib/licensing and never needs touching.
 *
 * This is deliberately separate from lib/features.ts (nav registry): that file
 * answers "what appears in the product", this one answers "what a license key
 * unlocks". Gating happens at the ORG boundary, never the team boundary.
 */

export const ENTERPRISE_FEATURES = {
  sso: { label: "SSO / SAML / SCIM" },
  rbac: { label: "RBAC + fine-grained permissions" },
  audit_logs: { label: "Audit logs" },
  multi_tenancy: { label: "Multi-tenancy + per-tenant views" },
  airgap_releases: { label: "Air-gapped signed release channel" },
  support: { label: "Support entitlements" },
} as const;

export type EnterpriseFeature = keyof typeof ENTERPRISE_FEATURES;

export const FEATURE_SSO = "sso" satisfies EnterpriseFeature;
export const FEATURE_RBAC = "rbac" satisfies EnterpriseFeature;
export const FEATURE_AUDIT_LOGS = "audit_logs" satisfies EnterpriseFeature;
export const FEATURE_MULTI_TENANCY = "multi_tenancy" satisfies EnterpriseFeature;
export const FEATURE_AIRGAP_RELEASES = "airgap_releases" satisfies EnterpriseFeature;
export const FEATURE_SUPPORT = "support" satisfies EnterpriseFeature;

export function isEnterpriseFeature(value: string): value is EnterpriseFeature {
  return value in ENTERPRISE_FEATURES;
}
