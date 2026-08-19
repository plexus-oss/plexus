# Licensing

_Plain-language guide for engineers evaluating Plexus. Not legal advice; the
[LICENSE](../LICENSE) file is the actual license._

## The short version

Plexus server code is **source-available under the Elastic License 2.0 (ELv2)**.
All of the code is in the open — free features and enterprise features alike.
Enterprise features are switched on by a license key; nothing is hidden in a
separate private repo.

The SDKs that run on your hardware ([plexus-python](https://github.com/plexus-oss/plexus-python) are
**Apache-2.0** — permissive, no strings, because code you flash onto your own
devices should never have strings.

## What's free (no key, no caps, forever)

Everything a single team needs to run Plexus in production:

- Telemetry ingest (WebSocket/HTTP), storage, and query
- Dashboards and instruments
- Alerts and monitors
- Single-team auth
- Grafana dashboard import
- Self-hosting the whole platform (see the self-host bundle)

There are no usage caps on the free tier and the software **never phones home**
— license validation is fully offline (our customers run air-gapped networks;
so can you).

## What needs an enterprise key

- Role-based access control and fine-grained permissions
- Air-gapped signed release channel with CVE patch SLA
- Support entitlements

The gate sits at the **organization** boundary, never the team boundary — a
single team never hits a paywall.

**Not yet available:** SSO / SAML / SCIM and per-tenant audit logs (retention,
tamper-evidence, auditor-format export) are not implemented today and are not
part of an enterprise key. Contact us for current status before relying on
them. Plexus is already multi-tenant at the organization boundary for every
tier — that is not a paid feature.

If no key is installed, Plexus runs as the free tier, silently. If a key
expires, enterprise features degrade to read-only with a clear message — the
platform never crashes, never deletes data, and never locks you out of your own
telemetry.

## What ELv2 means for you

You can: use Plexus in production, self-host it, read and modify the code, and
redistribute it.

You cannot: (1) offer Plexus itself to third parties as a hosted or managed
service, (2) circumvent the license-key functionality, or (3) remove licensing
notices. That's the whole list — see [LICENSE](../LICENSE) for the exact terms.

## Telemetry

Product telemetry is **opt-in only and off by default**. Nothing is collected
unless you explicitly enable it, and license validation never makes a network
call.
