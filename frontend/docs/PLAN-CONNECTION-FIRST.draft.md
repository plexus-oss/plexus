<!-- Mirror for version control — canonical copy lives at the workspace root; keep in sync. -->
# Plexus — the connection-first plan · ⚠️ DRAFT RECONSTRUCTION, NOT CANONICAL

> **Status: DRAFT for Ann's review.** The canonical `PLAN-CONNECTION-FIRST.md` has now been
> lost **twice** (see `graph/INCONSISTENCIES.md#plan-draft-missing-from-disk`). Reconstructed
> **2026-07-27** from the knowledge graph (`KNOWLEDGE-GRAPH.md` + `graph/`), the surviving
> execution companion (`tasks/connection-migration.draft.md`), session memory of the
> 2026-06-26 decision session, `BILLING.md`, and the public articulation
> (`marketing/public/llms.txt`). Where memory and code disagreed, **code won** — deltas are
> flagged inline. Ann must review, correct, and drop the `.draft` before this is canonical.
> An identical mirror is committed at `frontend/docs/PLAN-CONNECTION-FIRST.draft.md` so it
> cannot vanish a third time — keep the two in sync.

Committed 2026-06-26. Supersedes the infrastructure/data-plane positioning, "default is
silence", transparent-triage, and the observability-category plan (`PLAN.md`/`MANIFESTO.md`,
removed). Execution tracker: `tasks/connection-migration.draft.md`.

## 1. What Plexus is

**Plexus is the operations frontend for deep-tech fleets.** Connect the data store the
customer already runs — or a device, or a service — and get a beautiful auto-built operator
UI: dashboards, asset views, alerts, and an in-app AI (Terminal).

- **We are NOT a database company.** We sit on top of the customer's existing store.
- **Everything is a connection.** Our own ingest pipeline (gateway → Redis → ClickHouse) is
  just one de-emphasized connector among many (MySQL, Influx, SSH, …). The canonical noun is
  `source` (`source_type ∈ {device, connection, recording, import}`); "connection" is the
  strategic primitive.
- Public articulation matches (llms.txt): "the operations frontend for the systems a team
  already runs… no data migration, no rip-and-replace."

Why this shape: it is Ann's true founder-market fit — design, mission-ops operator UX
(Quindar), signal-over-noise — and the honest realization of "we don't want to be a
database." Competitors (Sift, Nominal, Memfault) have data/infra DNA; the frontend + AI
layer on a BYO store is the part they can't out-build her on.

## 2. The goal

**$1M ARR at ~20 hours/week** ≈ **10–15 deep-tech logos at ~$70–100K each**, gov-adjacent
first (newspace/defense-adjacent — where self-host/air-gap flips from liability to asset).
Mostly profit, mostly hers — a craft/cash business, not a venture raise. Every scope
decision below serves the 20-hour constraint: maintainable surface, no operated
infrastructure as the product, no autonomy promises to keep.

## 3. Two motions, one product

Same product for everyone; only pricing/sales differ. **No paid feature gates** — every org
gets every feature (`lib/features.ts` has no paid flag; verified in graph).

- **Self-serve (`tier_1`)** — Stripe metered, card required, usage-priced from the first
  data point (no free allotment; a $5/mo automatic credit is the on-ramp).
- **Enterprise (`tier_2`)** — sales-led, invoiced, Stripe bypassed
  (`platform_fee_usd` + contract). Managed deployment: a Plexus engineer lands it.

**Delta (memory vs code):** the 2026-06-26 decision said "metered on **active
connections**." What shipped is **volume metering** — 4 Stripe meters: `plexus_metrics`
$0.10/M rows, `plexus_logs` $0.10/M rows, `plexus_video_hours` $0.25/hr, and (new,
2026-07-20) `plexus_ai_tokens` $12/M blended AI tokens. Reconciling per-connection vs
per-volume pricing is an **open decision** (tracked in the execution draft). Note volume
meters only bill the owned pipeline; a true connection-first customer on their own store
generates near-zero metered volume — the per-connection model was meant to price *them*.

## 4. Product doctrine

- **Device dies as a backend primitive, lives as a UI lens.** A "device" is just
  `{connection + filter}` rendered as a dashboard. **Dashboards are THE one primary UI** —
  no separate device page. Detail pages are auto-dashboards (shipped 2026-07-20).
  - *Delta:* memory cited `lib/access/satellite-scope.ts` as the lens implementation; that
    file is deleted. The pattern now lives in `lib/access/scope.ts` +
    `lib/access/entity-scope.ts` + `source_associations` (entity sources row-filter their
    parent connection).
- **Auto-dashboard stays sacred** — the generated starter dashboard after first ingest is
  the product's magic moment; never remove it.
- **Terminal is the sole AI surface.** Lab (paid RAG studio) was built 2026-07-19 and
  removed 2026-07-20 (OOM incident + off-strategy; preserved on branch `lab-rag-studio`).
  Do not rebuild.
- **Onboarding is agent-first (2026-07-20 direction):** static dashboard templates are out;
  **paste-a-prompt** is in — a coding agent instruments the customer's repo, claims a
  write-only API key via the device-code flow (`device_auth_requests`), owner approves in
  one click, quick-start dashboard hands back. Spec: `tasks/agent-onboarding-spec.md`.
  Marketing's `instrument` prompt (`marketing/lib/content.ts`) is the single channel —
  upgrade it, never parallel it. No MCP product.

## 5. Connect, never operate

Retire "run-by-us" infrastructure as the business:

- The owned pipeline (gateway / Redis / ClickHouse / loader) becomes either a **free
  self-host capture+store bundle** (on-prem/air-gap — the gov story) or a **brokered
  managed store** (ClickHouse Cloud / Tinybird). We sell the frontend on top, not the pipe.
- **Status:** still operated today. **Scout is already connection-based in production**
  (external store, invoiced — proof the architecture works). **The data center is the last
  customer on the owned gateway** — migrate its read/UI/billing top-down (ingest
  untouched), then decommission the owned-pipeline Fly apps. Migration does not need
  poll-alerting (its store stays fed).
- **Phase 5 (read-path collapse):** `CONNECTION_READPATH_ORG_IDS` flag exists but is OFF
  (`frontend/lib/db/connection-read-path.ts`). Enabling it makes owned ClickHouse "just
  another connection" and ends the frontend/FastAPI dual rollup-selection drift.

## 6. SDK surface

- **Python SDK: thin on-ramp client** (PyPI v0.8.x). Not a platform.
- **TypeScript SDK** (npm v0.1.x) — server proxy + browser beacon pattern; kept, dogfooded.
- **plexus-c: RETIRED — confirmed by Ann 2026-07-27.** Proper retirement: deprecation
  notice shipping in the repo, marketing claims removed. (Resolves the
  `sdk-c-retired-vs-active` drift — the repo had kept shipping v0.9.x for a month after the
  pivot said retired; its WS transport was broken as shipped anyway.)

## 7. RBAC

**Intent (2026-06-26): connection-level access.** A connection credential sees the whole
store; per-device restriction is only honest as fail-closed query rewriting.

**Reality (as of 2026-07-27, code wins):** access = **3 built-in ranked roles**
(viewer < editor < admin) + **custom roles** (base role + per-action exceptions,
`lib/access/resolver.ts`) + **per-member scope allow-lists of sources**
(`org_members.allowed_source_ids`, NULL = unrestricted, admins never scoped —
`lib/access/scope.ts`). Picking an entity source row-filters its parent connection — which
*is* the connection-level model, expressed as member scope. **Teams were removed
2026-07-27** (the Groups/teams model memory describes is gone). One centralized Settings
console; no per-resource share buttons.

## 8. The one real build: poll-based alerting — ✅ SHIPPED

The single genuinely new subsystem the pivot required — alerting that works on a store we
don't ingest from. **Shipped 2026-07-05:** 30s poll loop → detect-poll → shared
`fireEventAlert`/`fireLimitAlert`; event + threshold monitors on connections AND event
monitors on devices via owned CH; DB-rendered watermarks (µs-safe); init never alerts.
Three engines total now: houston (device thresholds off the stream), frontend poll-loop,
frontend offline-loop.

## 9. Messaging rules

- Lead with **operator UI + the deep-tech wedge**. BYO-store/auto-dashboard are proof
  points, not the headline.
- Software-capable, **hardware-led**. Never say "Grafana competitor."
- Operate-phase positioning: "Sift and Nominal help you test your hardware before you ship
  it; Plexus runs your fleet after it's deployed."
- Never pitch autonomy as shipped; never pitch MCP/agent-integration as a product.
- Plain-English founder posture in sales — no SRE/data-center jargon Ann wouldn't say.

## 10. What changed since the June decision (delta log, 2026-07-27)

| Area | June plan said | Now |
| --- | --- | --- |
| Poll alerting | the one real build | **Shipped 2026-07-05** |
| Billing | metered on active connections | 4 volume meters live (incl. AI tokens); connection-based pricing = open decision |
| RBAC | connection-level | 3 built-in + custom roles + member source-scope; **teams removed 2026-07-27** |
| plexus-c | retired (on paper) | **Properly retired 2026-07-27** — deprecation notice + marketing purge |
| AI surface | agent = Terminal | Lab built + removed (2026-07-19/20); Terminal sole surface; AI tokens metered |
| Onboarding | (unspecified) | Agent-first paste-a-prompt + device-code claim flow (spec: `tasks/agent-onboarding-spec.md`) |
| Free tier | — | Free allotment removed 2026-07-20; card required, $5/mo credit |

## 11. Open decisions (mirror of the execution draft)

1. **Billing reconciliation** — per-connection vs volume metering (see §3 delta).
2. **Self-host / brokered-store packaging** for the owned pipeline (§5).
3. **Phase 5 rollout** — turn on `CONNECTION_READPATH_ORG_IDS` progressively.
4. **Data-center customer migration** off the owned gateway (last one).

## Appendix: Someday, if we go big (explicitly OUT of scope)

Autonomy, transparent triage, RCA, anomaly detection, the learned-baseline moat-flywheel,
and the trust/oversight-layer north star are **not the current plan**. They are honest
roadmap ("we say so"), revisited only if the $1M craft business is won and Ann chooses to
go bigger. Retired framings that must not leak back into copy or plans: "the default is
silence," transparent-triage, "Plexus is infrastructure / the data plane," and the
observability-category land-grab.
