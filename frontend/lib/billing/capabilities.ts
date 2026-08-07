/**
 * Capabilities — kept as a typed surface, but NOT a paywall.
 *
 * There are no paid feature tiers: every org gets every capability that is
 * implemented. `resolveCapabilities()` returns all-true. Billing is purely
 * usage-metered (data volume) and never gates a feature. The resolver + the
 * `requireCapability` callers are retained so a future gate (or a real RBAC
 * capability) has a home, and so removing the paywall didn't require deleting
 * every call site — they now all resolve to allowed.
 *
 * `tier`/`isPaid` are still passed through for billing-STATUS displays
 * (spend cap UI, "add a card" nudges), not for feature gating.
 *
 * This module is import-safe from client code (no `server-only`).
 * Server helpers (billing reads, requireCapability) live in
 * `capabilities.server.ts`.
 */

import type { Tier } from "./server";

/**
 * Boolean capability flags. Keep names in `noun_or_verb_phrase` form,
 * tied to the *action* the user wants to take, not the marketing
 * label. ("alerts" not "advancedNotifications".)
 */
export interface TierCapabilities {
  // ── Generation / automation ──────────────────────────────────
  /** AI-driven dashboard generation from natural language. */
  aiDashboardGeneration: boolean;
  /** Threshold + outlier alert rules. */
  alerts: boolean;
  /** Continuous monitors that compute alert state. */
  monitors: boolean;
  /** Root-cause analysis on detected incidents. */
  rca: boolean;

  // ── Money + safety rails ─────────────────────────────────────
  /** User-set monthly spend cap (Stripe-driven; tier_2 doesn't use it). */
  spendCap: boolean;

  // ── Platform / enterprise ────────────────────────────────────
  /** Slack / email / webhook integrations gallery. */
  integrations: boolean;
  /** SSO / SAML. */
  sso: boolean;
  /** Org-wide audit log. */
  auditLog: boolean;
  /** Custom domain on shared dashboard links. */
  customShareDomain: boolean;
  /** Hide Plexus branding on shared views. */
  customBranding: boolean;
  /** Bring-your-own ClickHouse / on-prem deployment. */
  selfHostedDeploy: boolean;

  // ── Source-of-truth fields, exposed for callers that need them.
  tier: Tier;
  isPaid: boolean;
}

/**
 * Pure resolver — takes the billing inputs, returns the capability
 * map. Pure means it's trivially unit-testable and the same code runs
 * on server + client (the client hook calls this with the values it
 * already gets from /api/usage).
 *
 * The matrix below IS the policy. Read it like a table, not like code.
 */
export function resolveCapabilities(args: {
  tier: Tier;
  isPaid: boolean;
}): TierCapabilities {
  const { tier, isPaid } = args;

  // There are no paid feature tiers: every org gets every capability that is
  // implemented. Billing is purely usage-metered (data volume) — it never
  // gates a feature. `tier`/`isPaid` are still passed through for billing-status
  // displays (spend cap, "add a card" prompts), not for feature gating.
  return {
    aiDashboardGeneration: true,
    alerts: true,
    monitors: true,
    rca: true,

    spendCap: true,

    integrations: true,
    sso: true,
    auditLog: true,
    customShareDomain: true,
    customBranding: true,
    selfHostedDeploy: true,

    tier,
    isPaid,
  };
}

/** Capability keys callable from `requireCapability`. Booleans only. */
export type BooleanCapabilityKey = {
  [K in keyof TierCapabilities]: TierCapabilities[K] extends boolean
    ? K
    : never;
}[keyof TierCapabilities];
