# Shipping — how code moves from an edit to users

Two audiences consume this repo: **Plexus Cloud** (our Fly deployment,
continuous) and **self-hosters** (versioned releases). They deliberately move
at different speeds.

## Daily development

Everything platform-shaped is edited here and only here. The repo is public —
every push is visible immediately, so no secrets, no prospect material, no
half-written incident notes in commits.

```
# work
cd <service>/          # gateway/ api/ houston/ clickhouse/ frontend/
<edit, run the service's own tests>

# frontend has the deepest gates
cd frontend && npx tsc --noEmit && npx vitest run

# commit with sign-off (DCO applies to everyone, us included)
git commit -s
git push
```

## Deploying Plexus Cloud (our Fly apps)

Each service deploys independently from its subdirectory — Fly ships the
directory you run it from and doesn't care about git:

```
cd frontend && fly deploy    # migrations run automatically (release_command)
cd gateway  && fly deploy
cd houston  && fly deploy
cd api      && fly deploy
cd clickhouse/server && ./deploy.sh deploy   # see its README
```

Deploy whenever a change is ready — Cloud is continuous. (The old
push-to-main auto-deploy died with the archived per-service repos; deploys
are manual until the `ci` + `fly-deploy` workflows are ported to this repo's
root `.github/workflows/` with path filters and a `FLY_API_TOKEN` secret.)

## Releasing to self-hosters

Self-hosters consume **tags**, not `main`:

```
git tag v0.2.0
git push origin v0.2.0
```

That triggers `release-images` CI, which builds and publishes all five images
to `ghcr.io/plexus-oss/plexus/*` tagged `0.2.0`, `v0.2.0`, and `latest`.
Self-hosters pick it up with `./selfhost/install.sh upgrade`. Optionally add
release notes: `gh release create v0.2.0 --generate-notes`.

Rules of thumb:

- Tag when a coherent set of changes is worth a self-hoster's restart — not
  on every Cloud deploy.
- Never tag anything you haven't run on Cloud first. Cloud is the canary.
- A migration that runs on Cloud runs identically for self-hosters (the
  bundle's `migrate` one-shot uses the same image and migrator).
- Breaking env/config changes need a note in the release notes AND a default
  in `selfhost/docker-compose.yml` that keeps old `.env` files working.

## Enterprise license changes

Adding a gated feature = one entry in `frontend/lib/licensing/registry.ts` +
one `entitled()` check at the write seam (`frontend/lib/licensing/README.md`).
Issuing keys never touches this repo — the private signing key lives outside
every repo and keys are minted offline with
`frontend/scripts/licensing/sign-license.mjs`.

## Everything that is NOT this repo

| Surface | Repo | How it ships |
| --- | --- | --- |
| plexus.company | `plexus-private/marketing` | push to main → Vercel |
| docs.plexus.company | `plexus-private/docs` | push to main → pipeline |
| Python/TS SDKs | `plexus-oss/plexus-python` / `-typescript` | version tag → OIDC publish to PyPI/npm |
| Internal cron (chores) | `plexus-private/ins-and-outs` | `fly deploy` |
| Video recorder | `plexus-private/video-recorder` | `fly deploy` |

The five archived `plexus-private` repos (gateway, clickhouse, api, houston,
frontend) are history only — never commit there.

## Outside contributions

PRs require DCO sign-off (CONTRIBUTING.md). Install the
[DCO GitHub App](https://github.com/apps/dco) on the org before merging the
first external PR. Remember ELv2 means contributors license their work to the
project; the tier split (what's free vs keyed) stays a maintainer decision.
