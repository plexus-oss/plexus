# CH row-policy backstop — staged rollout runbook

DB-enforced tenant isolation beneath the app-layer `WHERE org_id`. Fail-closed:
once policies apply, a `nextjs_reader` read with no `plexus_org_id` setting sees
zero rows. This runbook makes the flip safe — no legitimate read may blank.

Files: `2026-08-19-row-policies.sql` (this dir) · frontend `lib/db/clickhouse.ts`
(getClient/getGlobalReadClient) · `lib/db/ch-shadow.ts` (the shadow audit).

Flags (frontend, independent):
- `PLEXUS_CH_ROW_POLICY_SHADOW=1` — observe only, never alters a query. Emits
  `[ch-shadow]` log lines. Safe in prod; no DB change required.
- `PLEXUS_CH_ROW_POLICY=1` — enforce (stamps the setting). Requires the policies
  applied + `nextjs_global` provisioned first.

## Step 1 — Shadow in prod (the gate). ≥48h.

1. `fly secrets set PLEXUS_CH_ROW_POLICY_SHADOW=1 -a plexus-frontend` and deploy.
   No DB change. No policy applied. Reads are unaffected.
2. Let real traffic run ≥48h (span a full weekly cycle of cron/rollup jobs if
   possible — those exercise the cross-org read paths).
3. Grep the logs for risks:
   ```
   fly logs -a plexus-frontend | grep '\[ch-shadow\]' | grep '"risk":true'
   ```
   **PASS = zero risk lines.** Each risk line names the `table`, `reason`, and
   call `site` of a tenant read that would blank under enforcement — either a
   bare `getClient()` that should pass `orgId`, or a cross-org read that should
   use `getGlobalReadClient()`. Fix each at the source, redeploy, restart the 48h.
4. Also confirm both existing customer orgs exercised their read paths in the
   window (dashboards, live-stream, video/session reads). If a path didn't run,
   trigger it manually before trusting the clean result.

Do NOT proceed while any risk line exists. A clean shadow is the whole safety
argument for the flip.

## Step 2 — Provision the cross-org bypass user.

1. In CH, run the `nextjs_global` section of the `.sql` (substitute a generated
   password for `${CH_GLOBAL_PASSWORD}`).
2. `fly secrets set PLEXUS_CLICKHOUSE_GLOBAL_USER=nextjs_global \
      PLEXUS_CLICKHOUSE_GLOBAL_PASSWORD=... -a plexus-frontend`; deploy.
3. Re-run the shadow grep briefly — cross-org reads that previously fell back to
   `getClient()` should now route through `nextjs_global` and stop appearing as
   risks.

## Step 3 — Apply policies in STAGING, verify.

1. Run the POLICY section of the `.sql` against staging CH.
2. With `PLEXUS_CH_ROW_POLICY=1` on staging, confirm dashboards, the public read
   API, alerts, and a share link all still return data. Confirm a deliberate
   cross-org query returns zero rows (the isolation actually bites).

## Step 4 — Enforce in prod.

1. Apply the POLICY section against prod CH.
2. `fly secrets set PLEXUS_CH_ROW_POLICY=1 -a plexus-frontend`; deploy.
3. Immediately run the existing-customer regression checklist:
   org A dashboards load + live-stream; org B video panel + session metering;
   both orgs' alerts fire/close; API-key ingest; a share link opens.

## Rollback

Unset `PLEXUS_CH_ROW_POLICY` and redeploy — the app stops stamping the setting.
Because policies then blank `nextjs_reader`, a FULL rollback also drops the
policies (DROP block at the bottom of the `.sql`). The shadow flag can stay on.
