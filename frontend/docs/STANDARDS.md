# Plexus Frontend Standards

This is the opinionated playbook. Every pattern here was chosen because it already exists in this codebase and won — it is the best of what we've built, promoted to law. When you build something new, you copy the named template file. When you touch old code that violates this doc, you migrate it. No new variants.

**The rule of one:** one way to fetch, one way to mutate, one way to confirm a delete, one way to show loading, one error shape, one toast API. If you think you need a second way, you need a PR discussion, not a new file.

---

## 1. Folder & file organization

```
app/                    Routes ONLY. Pages are thin: compose components, no business logic.
  (product)/<feature>/  One dir per feature in the nav. layout.tsx owns PageWrapper + TabNav.
  api/<resource>/       REST-shaped resource routes (see §3).
components/
  ui/                   Primitives + app composites (Button, ConfirmActionDialog, EmptyState…).
                        NOTHING feature-specific. NOTHING that fetches.
  shell/                App chrome: nav, product-shell, org-switcher, user-menu, theme.
  <feature>/            One dir per feature, matching app/(product)/<feature> names.
hooks/                  Flat, kebab-case, one hook concern per file. Cross-feature data hooks.
lib/
  <domain>/             Domain modules (db, access, billing, api, validation…).
  *.ts at root          Only true one-file utilities (utils.ts, fetcher.ts, toast-utils.ts).
context/                Providers only.
```

Rules:

- **Feature dirs mirror nav routes.** `lib/features.ts` is the registry of record for routes/nav/gating; a feature's name there, its `app/(product)/` dir, and its `components/` dir must match. (Current violation to fix: six overlapping device-ish dirs — `data/`, `device/`, `fleet/`, `source/`, `connections/`, `connect/` — collapse toward `devices/` and `connections/`.)
- **No loose components at `components/` root.** Chrome goes in `components/shell/`, modals owned by a feature go in that feature's dir.
- **Naming:** files kebab-case; components PascalCase; hooks `use-<thing>.ts` exporting `useThing` — **no `-swr` suffix, no re-export shim files**. Two components must never share a name (we currently have two `DashboardPanel`s).
- **Barrels:** a `lib/<domain>/index.ts` barrel is the _only_ entry point or it doesn't exist. Dead barrels that callers bypass get deleted. (`lib/db/index.ts` is the entry; `lib/db/supabase.ts` is deprecated.)
- **`server-only`:** every module that touches a service-role key, driver, or secret imports `"server-only"` at the top — including `lib/db/queries/*`, `lib/db/index.ts`, and `lib/storage/*`. Split client-safe constants/validators into their own file rather than omitting the guard.
- **Docs/specs** live in `docs/`, never inside source dirs (`hooks/realtime/thermal-rendering.md` is the counterexample).

## 2. How to replicate a feature (the golden path)

Copy these files, in this order. The canonical example of each step is named.

1. **Register it** — add the feature to `lib/features.ts` (route, nav, gate, limit). If it has RBAC actions, add them to `lib/manifest/features.ts`.
2. **Schema + types** — edit `lib/db/schema.ts`, then `npx drizzle-kit generate` (migrations live in `lib/db/migrations/drizzle/`; hand-edit the generated SQL only for `USING` clauses/backfills drizzle can't emit). `lib/db/migrations/supabase/` is the frozen legacy history (adopted via `scripts/db/baseline.ts`) — never add to it.
3. **Queries** — new file `lib/db/queries/<resource>.ts` modeled on **`lib/db/queries/recordings.ts`**: `"server-only"`, explicit column projection (no `select("*")` on tables with secrets/fat columns), camelCase params mapped to snake_case inside, throw on error, `PGRST116 → null` for single-row lookups. Spread `createOrgQueries` for plain CRUD. No HTTP errors in this layer.
4. **API route** — model on **`app/api/webhooks/route.ts`** (simple) or **`app/api/dashboards/route.ts`** (full stack):
   - `withAuth` / `withDualAuth` / `withRoleAuth` from `lib/api/with-auth.ts`. **Never inline `await auth()`.**
   - `requirePermission` / `enforceSource` for anything org-member-but-restricted. Every mutation route states its RBAC.
   - `validateBody` + a zod schema in `lib/validation/api-schemas.ts`. No raw `request.json()` casts.
   - Errors via `apiError`/`errorResponse` (`lib/api/errors.ts`) — the `{error: CODE, message}` shape. Creates return 201.
5. **Hook** — model on **`hooks/use-integrations-resource.ts`**: a typed SWR resource hook returning `{ data, isLoading, error, mutate }` + named mutation callbacks. Shared `fetcher` from `lib/fetcher.ts` (or rely on the SWR-provider global — pick per file, but never re-implement it). Mutations: optimistic `mutate(asyncFn, {optimisticData, rollbackOnError})`, toast on error via `lib/toast-utils`, **and rethrow** so callers can react. Explicit return type interface.
6. **Page** — model on **`app/(product)/alerts/monitors/page.tsx`** + its layout: `PageWrapper` (via the feature layout), `TabNav` for sub-tabs, `ui/table` for lists, `EmptyState` with a shortcut action, `CreateButton` opening a Radix `Dialog`, `DeleteButton`/`ConfirmActionDialog` for destruction, `useHotkeys` + `useListNavigation` for keyboard-first lists.
7. **Verify** — feature gated correctly per plan, limit enforced **server-side** in the create route (not just in nav), keyboard path works, error path toasts.

## 3. API conventions

- **Auth:** shared wrappers only (§2.4). Internal service routes use `verifyInternalAuth` from `lib/internal/auth.ts` — never a local copy — and fail closed when the secret is unset.
- **RBAC parity:** if `GET /api/devices/[id]` enforces a grant, every sibling subroute (`/metrics`, `/sensors`, `/schema`, `/query`) enforces the same grant. Destructive routes always carry a role or permission gate.
- **Error shape:** `{ error: CODE, message, details? }` everywhere. `{success:true}` / `{ok:true}` / prose-in-`error` are deprecated.
- **Envelope:** list responses are keyed by resource (`{ dashboards: [...] }`). 201 on create. Resource addressed by path id, not query string.
- **Source identity:** the slug is the canonical user-facing/wire identity — `(org_id, slug)` on ingest envelopes, ClickHouse telemetry, dashboard panel refs (`slug:metric`), `alert_rules.source_id`, and the public API. The uuid (`sources.id`) is an internal FK only (`alerts`, `source_limits`, `event_monitors`, `source_permissions`, `source_context`). Routes accept either form and resolve at the boundary via `findSourceByIdOrSlug`/`findSourceByRef` (`lib/api/find-source.ts`) or `adminSourceQueries.resolveRef`; the UUID-shape predicate lives in `lib/utils/uuid.ts` — never redefine it. Payloads that carry a uuid `source_id` also carry `source_slug`. Uuid-shaped slugs are rejected at creation (they'd be unreachable through the resolvers).
- **Service-role access:** API-key auth paths use `runWithServiceRole()` (`lib/db/queries/shared.ts`) around the normal query objects. The `adminXQueries` mirror universe in `lib/db/server.ts` is deprecated; do not add to it.
- **Rate limiting:** anonymous or expensive endpoints (AI, shared-link query, contact, key verification, proxies) use `lib/rate-limiter.ts`.
- URL grammar: plural resources, static segments must not shadow `[id]` slugs, version only at `/api/v1` for device-facing ingest.

## 4. Hooks conventions

- SWR for every server read. Hand-rolled `useEffect`+`fetch` is allowed only for non-GET imperatives, and then with an `AbortController`/staleness guard.
- Return shape: `{ data..., isLoading, error, mutate }` — `error` normalized to `Error | null`, never `isError: error`.
- Polling: SWR `refreshInterval` with a named constant from `lib/constants/time.ts`, and `refreshWhenHidden: false` unless there's a stated reason.
- One generic `useResource` (generalized from `use-integrations-resource.ts`) backs all CRUD hooks; per-resource hooks are thin typed wrappers.
- Error-body parsing happens once, in `lib/fetcher.ts` (`failFrom`), not inline at call sites.
- Every exported hook has an explicit return type. `any` is banned (one variant exception: typed escape hatches documented inline).

## 5. UI & UX interactions (one way each)

| Interaction                   | The one way                                                                                 | Template                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Loading (route)               | `RouteLoading`                                                                              | `components/ui/route-loading.tsx`                                    |
| Loading (button)              | `Button loading` prop — never raw `Loader2`                                                 | `components/ui/button.tsx`                                           |
| Loading (panel/list)          | `Spinner` centered                                                                          | `components/ui/spinner.tsx`                                          |
| Empty (page)                  | `EmptyState` + action with shortcut                                                         | `components/ui/empty-state.tsx`                                      |
| Empty/error (dashboard panel) | `PanelEmptyState` typed reasons                                                             | `components/dashboard/panels/panel-empty-state.tsx`                  |
| Destructive confirm           | `DeleteButton` → `ConfirmActionDialog`. Never `window.confirm`, never ad-hoc two-step state | `components/ui/delete-button.tsx`                                    |
| Create                        | `CreateButton` + Radix `Dialog`                                                             | alerts/monitors flow                                                 |
| Detail/inspect                | Radix `Sheet`. Never hand-rolled `fixed inset-0` overlays                                   | `components/ui/sheet.tsx`                                            |
| Row actions                   | `EntityActions` (manifest + RBAC driven)                                                    | `components/ui/entity-actions.tsx`                                   |
| Toast                         | `lib/toast-utils` only — success AND failure on every mutation                              | `lib/toast-utils.ts`                                                 |
| Tables                        | `ui/table` (+ shared virtual table for telemetry)                                           | `components/ui/table.tsx`                                            |
| Forms                         | real `<form>`, per-field inline errors on blur, SaveBar for settings surfaces               | `components/webhooks/webhook-form.tsx`, `components/ui/save-bar.tsx` |
| Tabs                          | `TabNav` for page nav (URL-synced)                                                          | `components/ui/tab-nav.tsx`                                          |
| Dates                         | date-fns / `useFormattedTime` — never raw `toLocaleDateString`                              |                                                                      |

Styling:

- `cn()` for all conditional classes — no template-literal class concatenation.
- **Semantic tokens, not palette classes, for status**: severity/status colors come from one `lib/severity.ts` map + `success/warning/info` CSS variables. `text-amber-400` vs `text-yellow-500` drift is a bug.
- Chart series colors come from one exported palette; the color picker offers the same palette charts render.
- Micro type sizes are tokens (`text-2xs`, `text-3xs`), not `text-[10px]` arbitraries.
- Variants via `cva` when a component has ≥2 visual variants.

Accessibility floor: every icon-only button has `aria-label` (baked into `DeleteButton`'s icon mode); clickable rows are focusable with keyboard handlers (copy `components/fleet/source-list.tsx`); hover-only actions must also be focus-visible; anything modal is Radix (focus trap + Escape for free).

## 6. How to replicate a dashboard panel

Target shape: **`panels/radar-panel.tsx`** (~150 lines). One `usePanelData` call → memoized transform → render. Register in `panel-renderer.tsx` (lazy, `ssr:false` if WebGL), add a configurator following `add-panel-configurators/types.ts` contract, route all loading/error/empty through the shared panel data boundary, never fetch directly. Panels >300 lines decompose into sub-components.

## 7. Architecture invariants

- **Layering:** route → query → driver. Routes never touch Supabase clients; drivers stay behind `ConnectionDriver` + registry (`lib/db/drivers/`). `lib/access` is the template for any new policy domain (pure decision fns + cached IO + factory).
- **One registry per concern:** `lib/features.ts` = routes/nav/paid gates; `lib/manifest` = RBAC actions; `lib/licensing/registry.ts` = enterprise entitlements. No overlapping fields; limits are **enforced in API routes**, not just rendered in the UI.
- **Realtime:** external store + `useSyncExternalStore` with per-key selectors (`hooks/realtime/`, `telemetry-provider.tsx`). Never pipe high-frequency data through React state/context.
- **Heavy/WebGL components:** `next/dynamic` `ssr:false`, wrapped in an error boundary — one panel crashing must never take down the dashboard.
- Env vars are read in one config module per domain (the `lib/billing/server.ts` pattern), not scattered `process.env` reads.

## 8. Definition of done

- [ ] Copied the named template, didn't invent a variant
- [ ] RBAC stated and tested on every new route; limit enforced server-side
- [ ] Loading + error + empty all handled; mutations toast success and failure
- [ ] Explicit types, zero `any`, zod on every body
- [ ] Keyboard path works; icon buttons labeled
- [ ] Dead code you replaced is deleted in the same PR
