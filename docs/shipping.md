# Shipping — how code becomes a release

Two audiences consume this repo: **Plexus Cloud** (our hosted deployment, which
rides `main` continuously) and **self-hosters** (who ride versioned releases).
A Cloud deploy never changes what self-hosters run.

## Development

Each service is developed and tested from its own directory (`gateway/`,
`api/`, `houston/`, `clickhouse/`, `frontend/`) with its own toolchain; CI runs
the per-service gates path-filtered from `.github/workflows/`. The repo is
public — no secrets in code or commit messages, ever.

Commits require DCO sign-off (`git commit -s`) — see `CONTRIBUTING.md`.

## Releasing to self-hosters

Self-hosters consume **tags**, not `main`:

```
git tag v0.2.0
git push origin v0.2.0
```

That triggers `release-images` CI, which builds and publishes all five images
to `ghcr.io/plexus-oss/plexus/*` tagged `0.2.0`, `v0.2.0`, and `latest`, plus a
cosign-signed air-gapped bundle attached to the GitHub Release. Self-hosters
pick it up with `./selfhost/install.sh upgrade`.

Rules of thumb:

- Tag when a coherent set of changes is worth a self-hoster's restart — not on
  every change to `main`.
- A migration that runs on Cloud runs identically for self-hosters (the
  bundle's `migrate` one-shot uses the same image and migrator).
- Breaking env/config changes need a note in the release notes AND a default
  in `selfhost/docker-compose.yml` that keeps old `.env` files working.

## Enterprise license changes

Adding a gated feature = one entry in `frontend/lib/licensing/registry.ts` +
one `entitled()` check at the write seam (`frontend/lib/licensing/README.md`).
Key issuance never touches this repo — the private signing key lives outside
it and keys are minted offline.

## Outside contributions

PRs require DCO sign-off (`CONTRIBUTING.md`). ELv2 means contributors license
their work to the project; the tier split (what's free vs keyed) stays a
maintainer decision — see `docs/licensing.md` for the current line.
