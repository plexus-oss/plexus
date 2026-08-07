/**
 * Shared dashboard route layout.
 *
 * The page itself is a client component (it owns websocket state, the
 * password gate, view-time tracking). Metadata generation has to happen
 * here in a server boundary so Slack, iMessage, X/Twitter, Discord, and
 * preview crawlers see real link unfurls instead of "Plexus" everywhere.
 *
 * Resolves the share-link metadata directly through the admin query
 * helper — no auth needed; the token IS the auth — so we can populate
 * the dashboard name in the title and OG preview without exposing
 * private dashboard config.
 *
 * Falls back gracefully if the token is invalid, expired, password-
 * gated, or just slow: a generic "Plexus dashboard" unfurl is better
 * than no unfurl at all, and saves us a 500 in metadata.
 */

import type { Metadata } from "next";
import { adminDashboardShareQueries } from "@/lib/db/server";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
}

const FALLBACK_TITLE = "Plexus dashboard";
const FALLBACK_DESCRIPTION =
  "A live view of telemetry on Plexus — real-time metrics, logs, and alerts.";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL || "https://app.plexus.company";
  const url = `${appUrl}/shared/${token}`;

  let dashboardName: string | null = null;
  try {
    const shareLink = await adminDashboardShareQueries.findByToken(token);
    if (shareLink && shareLink.status === "active") {
      const dashboard =
        await adminDashboardShareQueries.getDashboardForShareLink(shareLink);
      if (dashboard) dashboardName = dashboard.name;
    }
  } catch {
    // Metadata is best-effort — never block the page render.
  }

  const title = dashboardName ? `${dashboardName} · Plexus` : FALLBACK_TITLE;
  const description = dashboardName
    ? `${dashboardName} — a live dashboard shared from Plexus.`
    : FALLBACK_DESCRIPTION;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url,
      siteName: "Plexus",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    robots: {
      index: false,
      follow: false,
    },
  };
}

export default function SharedDashboardLayout({ children }: LayoutProps) {
  return children;
}
