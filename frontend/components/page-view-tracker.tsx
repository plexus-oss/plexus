"use client";

/**
 * App-wide page-view beacons — the product dogfooding its own ingest.
 * Fires one `page_view` per route change to /api/plexus (which holds the
 * key and forwards to the gateway; nothing sensitive ships to the
 * browser). Dynamic segments are normalized against the feature registry
 * so tag cardinality stays flat: /devices/drone-001 → /devices/:id,
 * /dashboards/<uuid>/settings → /dashboards/:id/settings.
 */
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { FEATURES } from "@/lib/features";

/** sendBeacon survives page unload; keepalive fetch is the fallback. */
function beacon(metric: string, value: number, tags: Record<string, string>) {
  const body = JSON.stringify({ metric, value, tags });
  if (
    typeof navigator.sendBeacon === "function" &&
    navigator.sendBeacon(
      "/api/plexus",
      new Blob([body], { type: "application/json" }),
    )
  ) {
    return;
  }
  fetch("/api/plexus", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
}

const FEATURE_ROOTS = new Set(
  Object.values(FEATURES)
    .map((f) => f.href?.slice(1))
    .filter((s): s is string => !!s),
);

/** Keep the feature root + static segments; collapse everything dynamic. */
export function normalizePath(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return "/";
  const root = segments[0]!;
  if (!FEATURE_ROOTS.has(root)) return `/${root}`;
  const rest = segments.slice(1).map((s) =>
    // Static tab/sub-page names are short lowercase words; ids and slugs
    // (uuids, drone-001, sat-25544) carry digits or dashes.
    /^[a-z]+$/.test(s) && s.length <= 20 ? s : ":id",
  );
  return ["", root, ...rest].join("/") || "/";
}

export function PageViewTracker() {
  const pathname = usePathname();
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname) return;
    const page = normalizePath(pathname);
    if (page === last.current) return;
    last.current = page;
    beacon("page_view", 1, { page });
  }, [pathname]);

  return null;
}
