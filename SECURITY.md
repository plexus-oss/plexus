# Security

## Reporting a vulnerability

Email **info@plexus.company** with a description and reproduction steps.
You'll get an acknowledgment within 2 business days. Please don't open public
issues for suspected vulnerabilities.

If you need to encrypt your report, say so in a first plain email and we'll
arrange a channel.

## Scope

Everything in this repository — the platform services (gateway, api,
frontend, houston, clickhouse loader) and the self-host bundle — plus the
Apache-2.0 SDKs (plexus-python, plexus-typescript).

## Security posture (for evaluators)

- **No phone-home.** The platform makes no outbound calls except the
  integrations you explicitly configure (Anthropic, Resend, Slack, Stripe).
  License validation is fully offline (Ed25519, public key in
  `frontend/lib/licensing/token.ts`).
- **Air-gap friendly.** The self-host bundle runs entirely on your
  infrastructure; see `selfhost/README.md` for offline install notes.
- **Secrets** are generated per-install by `selfhost/install.sh` and stored
  only in your local `.env` (mode 600).
- **Advisories:** subscribe by emailing info@plexus.company with the
  subject "subscribe" — CVE notices and patch releases go to that list
  first. Enterprise license holders get a patch SLA and a signed air-gapped
  release channel (see `docs/enterprise.md`).
