/**
 * Feature registry — the only place to add a feature.
 *
 * One row per feature. Fill in only the fields it needs:
 *   - top-level page          → `href`, `label`, `icon`, `section`
 *   - in-page capability only → leave `href` off (no nav row)
 *
 * There are no paid features — every org gets everything that's implemented,
 * so this registry no longer carries a `paid` flag or a tier gate. Nav reads
 * from this file. (`/internal` is staff-only, enforced by the internal layout
 * + the `is_staff` check in every /api/internal route — not a paywall.)
 */
import {
  Server,
  Cable,
  Database,
  AlertTriangle,
  Activity,
  Settings,
  KeyRound,
  Terminal,
  FlaskConical,
  Brain,
  type LucideIcon,
} from "lucide-react";

export type FeatureKey =
  // Pages
  | "home"
  | "data"
  | "apiKeys"
  | "settings"
  | "profile"
  | "devices"
  | "connections"
  | "runs"
  | "dashboards"
  | "terminal"
  | "alerts"
  | "events"
  | "intelligence"
  | "internal";

export type SectionId = "data" | "observe" | "configure";

export interface Feature {
  /** Display label (nav, settings). */
  label?: string;
  /** Icon (nav). */
  icon?: LucideIcon;
  /** First URL segment this feature owns. Omit for sub-features. */
  href?: string;
  /** Nav section. Omit to keep a page out of the sidebar (e.g. /profile). */
  section?: SectionId;
}

/** Section order + headers as they appear in the sidebar. */
export const SECTIONS: { id: SectionId; header: string }[] = [
  { id: "data", header: "Data" },
  { id: "observe", header: "Observe" },
  { id: "configure", header: "Configure" },
];

export const FEATURES: Record<FeatureKey, Feature> = {
  // ── Pages: always available ────────────────────────────────────────────
  home: { href: "/" },
  data: { label: "Data", icon: Database, href: "/data", section: "data" },
  apiKeys: {
    label: "API Keys",
    icon: KeyRound,
    href: "/api",
    section: "configure",
  },
  settings: {
    label: "Settings",
    icon: Settings,
    href: "/settings",
    section: "configure",
  },
  profile: { href: "/profile" },
  devices: {
    label: "Devices",
    icon: Server,
    href: "/devices",
    section: "data",
  },
  dashboards: {
    href: "/dashboards",
  },

  connections: {
    label: "Connections",
    icon: Cable,
    href: "/connections",
    section: "data",
  },
  runs: {
    label: "Runs",
    icon: FlaskConical,
    href: "/runs",
    section: "data",
  },
  terminal: {
    label: "Terminal",
    icon: Terminal,
    href: "/terminal",
    section: "observe",
  },
  alerts: {
    label: "Alerts",
    icon: AlertTriangle,
    href: "/alerts",
    section: "observe",
  },
  events: {
    label: "Events",
    icon: Activity,
    href: "/events",
    section: "observe",
  },
  intelligence: {
    label: "Intelligence",
    icon: Brain,
    href: "/intelligence",
    section: "observe",
  },

  // Staff-only admin console. Not a paywall — gated by the internal layout's
  // staff check and the is_staff assertion in every /api/internal route.
  internal: { href: "/internal" },
};

export interface TierContext {
  isPaid: boolean;
}

/**
 * Every feature is available to every org — there are no paid tiers. Kept as a
 * function (not inlined to `true`) so callers like `useFeatures()` don't need
 * to change and a future gate has one place to live.
 */
export function isEnabled(_feature: Feature, _ctx: TierContext): boolean {
  return true;
}

/**
 * Find the feature that owns a pathname, matched by first URL segment.
 * `/devices/drone-001` → the `devices` feature. Returns undefined for
 * paths no feature claims (e.g. `/auth/cli`).
 */
export function featureForPath(pathname: string): Feature | undefined {
  const segment = "/" + (pathname.split("/")[1] ?? "");
  return Object.values(FEATURES).find((f) => f.href === segment);
}
