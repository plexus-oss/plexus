# lib/licensing — entitlements

One module owns all license logic. Everything else calls `entitled()` /
`accessLevel()` and never inspects keys, tiers, or expiry itself.

```ts
import { entitled, FEATURE_RBAC } from "@/lib/licensing";

if (!entitled(FEATURE_RBAC)) {
  return NextResponse.json(
    { error: "… requires an enterprise license", code: "license_required" },
    { status: 403 },
  );
}
```

## Contract

- **Offline, always.** Ed25519-signed token (`PLXL1.<payload>.<sig>`), verified
  against the public key embedded in `token.ts`. No network call, ever —
  buyers run air-gapped/ITAR networks. Do not add a phone-home.
- **No key → free tier, silently.** No nags. The only UI surface is one line
  in settings (`components/settings/license-line.tsx` ← `GET /api/license`).
- **Expired key → read-only grace.** `accessLevel()` returns `"readonly"`;
  gate *writes* with `entitled()` and leave reads/deletes open. Never crash,
  never delete data, never lock a user out of their own telemetry.
- **Gate at the org boundary, never the team boundary.** A single team must
  never hit a paywall.

## Adding a gated feature

1. Add one entry in `registry.ts`.
2. Add one `entitled(FEATURE_X)` check at the feature's write seam.
Done — token format, grace, and settings display need no changes.

## Seams (current state)

| Feature | Status | Seam |
| --- | --- | --- |
| `rbac` | **wired** | `app/api/access/custom-roles/route.ts` (create), `app/api/access/groups/[groupId]/grants/route.ts` (grant) |
| `sso` | stub — feature not built | wire in the auth config route when SSO/SAML lands |
| `audit_logs` | stub — feature not built | wire in the audit-log export/retention routes |
| `multi_tenancy` | stub — feature not built | wire at tenant-creation; use `licenseLimit("tenants")` |
| `airgap_releases` | no runtime seam | enforced by release tooling, not app code |
| `support` | no runtime seam | commercial entitlement only |

## Keys

- Keypair generation (one-time): `node scripts/licensing/keygen.mjs` →
  `~/.plexus/license-signing/` (private key never in any repo).
- Issue a license: `node scripts/licensing/sign-license.mjs --org "Acme"
  --features sso,rbac --expires 2027-01-01 [--limits tenants=25]`.
- Install: set `PLEXUS_LICENSE` (token) or `PLEXUS_LICENSE_FILE` (path) in the
  deployment env. The hosted SaaS deployment carries its own key
  (`~/.plexus/license-signing/plexus-cloud.token` → Fly secret) — set it
  BEFORE deploying the RBAC gate or custom-role creation stops on prod.
