# Plan — be the front end

**2026-08-12.** Supersedes the previous four-phase version, which was too complicated.

## The thesis

**Plexus is the front end for hardware fleets. Everything else serves that.**

We are not going to win on ingestion, storage, analytics, or "intelligence." The people we are up
against have data-infrastructure DNA and more money. What they do not have is a front end anyone enjoys
using — theirs are dense, multi-panel, engineer-IDE surfaces that take real effort to learn.

Evidence this is the right axis, not just a preference:

- The open-source robotics world rallies around **viewers**, not consoles. Rerun has ~11.3k stars and
  MCAP ~1k, while every open-source *fleet console* built in the last 18 months sits near 100 stars with
  no replies. People adopt the thing they look at.
- The loudest recurring complaint about the incumbent stack is not missing capability, it is **setup and
  upkeep** — *"death by config file"*, *"basically a full time job"*, *"there aren't many good,
  maintained open-source dashboards."*
- Where competitors demo, they demo a workspace you must learn. Nobody is competing on clarity.

**So the product goal is: the fastest, clearest, best-looking way to see and operate a fleet.**

## What this changes

It makes **simplification a feature, not a cleanup task.** Every screen, setting, and concept has to
earn its place. If a thing is not part of seeing or operating a fleet, it is a candidate for removal.

Concretely, we stop treating breadth as progress. Fewer panels that look excellent beat more panels.
One obvious path in beats three equal ones. A short settings page beats a complete one.

---

## Now

### 1. Make the first ten minutes excellent
- [ ] One way in, not three. Pick the best (SDK, installer, or connection) as *the* path; demote the
      others to a "other ways to connect" link.
- [ ] After first data lands, land the user on a dashboard automatically. Never leave them on an empty
      state wondering.
- [ ] Every empty state says what this is and the one next action, in a sentence.

### 2. Make the app smaller
- [ ] Inventory every route and setting; mark each **keep / merge / cut**. Ship the cuts.
- [ ] Panel catalogue: cut or hide anything that is not excellent. ~30 types is a maintenance surface,
      not a selling point.
- [ ] One page that explains the model — source, fleet, connection, monitor, alert, verdict. If it
      cannot be explained on one page, the model is too complicated.

### 3. Make it look like the best tool in the category
- [ ] Pick the three screens that matter — fleet view, device view, alert view — and make them genuinely
      excellent before touching anything else.
- [ ] Density, type, spacing and empty states reviewed as one system, not per-screen.

## Next

### 4. Take the migration path seriously
- [ ] Wire the existing Grafana importer to a UI. It is already written, tested against real dashboards,
      and reachable only by API. This is the cheapest "switch to us" lever we have.

### 5. MCP as a surface, not a feature
- [x] MCP server committed (`api/app/mcp/`, 14 tools, 18 tests)
- [x] OAuth 2.1 authorization server — works as a claude.ai custom connector
- [ ] Document it, and publish a packaged agent skill
- [ ] Rule: deterministic engine decides, model narrates. No tool returns a judgement the engine did not
      produce.

## Not doing

- Logs, traces, profiles, APM — not an observability suite
- A general-purpose dashboard builder
- Test-campaign analysis, HIL rigs, test sequencing
- Chasing panel-type or integration counts
- A hosted public sandbox — self-host and open source is the try-it path

---

## Open-source state

**Done**
- [x] Repo is public, ELv2, DCO, secret-scanned clean
- [x] Self-host ships the full stack; `BILLING_ENABLED=false`; `curl | bash` installer works
- [x] Internal planning material removed from the repo and from history
- [x] MCP server committed and pushed

**To do**
- [ ] Decide the free/paid line and write it in `LICENSING.md`. Recommendation: everything needed to see
      and operate a fleet is free forever; charge for organisational scale (SSO, custom RBAC, audit
      export, multi-org) and the hosted service. Rule: **nothing free today ever becomes paid.**
- [ ] Delete the dead capability-paywall scaffolding (`resolveCapabilities` returns all-true, no callers)
- [ ] `PLEXUS_IMAGE_REPO` variable — `selfhost/` hard-codes `ghcr.io/plexus-oss/plexus` in five places,
      so the repo can never be renamed or moved without breaking every self-host install
