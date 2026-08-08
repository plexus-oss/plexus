# Enterprise licenses

*How to get a key, what it unlocks, and how renewal works. For what's free
(most of the platform), see [licensing.md](./licensing.md).*

## What a key unlocks

SSO / SAML / SCIM · RBAC and fine-grained permissions · audit logs ·
multi-tenancy · the air-gapped signed release channel with CVE patch SLA ·
support entitlements. All of that code is in this repo — the key switches it
on. Everything else is free forever, uncapped, for any single team.

## Buying

Email **info@plexus.company**. Enterprise is sales-led and invoiced — tell
us org name, rough fleet size, and which features you need. On payment you
receive a license key (a signed `PLXL1.…` token) issued to your org with an
expiry matching your term.

## Installing a key

Set it in the environment of your frontend deployment:

```
PLEXUS_LICENSE=PLXL1.eyJ…        # the token itself, or
PLEXUS_LICENSE_FILE=/etc/plexus/license   # a file containing it
```

Self-host: put it in `selfhost/.env` and re-run
`./selfhost/install.sh upgrade`. Validation is **fully offline** — no
network call, ever. Your license status appears as one line in
Settings → Organization.

## Expiry and renewal

Keys carry an expiry date. When one lapses, enterprise features degrade to
**read-only** with a renewal notice in settings — nothing crashes, nothing is
deleted, and your telemetry is never held hostage. Renewal is a new invoice
and a fresh key with a later expiry.

## Verifying a key (air-gapped procurement teams)

The token format and verification code are public:
`frontend/lib/licensing/token.ts`. You can confirm exactly what a key
grants — org, features, expiry — by base64url-decoding its middle segment;
the Ed25519 signature proves it came from us.

## Signed releases (enterprise)

Every release's images and air-gap bundle are signed with the Plexus cosign
key. The free tier gets the artifacts; an enterprise license gets the
**verification public key** (delivered with your license key) plus the CVE
patch SLA, so your supply-chain review can prove that what you deploy is
what we shipped:

```
# container images
cosign verify --key cosign.pub ghcr.io/plexus-oss/plexus/gateway:v0.2.0

# the air-gap bundle
cosign verify-blob --key cosign.pub \
  --bundle plexus-airgap-v0.2.0.tar.zst.cosign.bundle --new-bundle-format \
  plexus-airgap-v0.2.0.tar.zst
```

A `sha256` checksum also ships next to every bundle for basic integrity
(no license needed).
