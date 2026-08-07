/**
 * Dynamic OG image for shared dashboards. Renders 1200×630 at request
 * time via the Edge runtime — Next.js inlines this as
 * `og:image` automatically when sharing a /shared/[token] URL.
 *
 * Visual: the same dark + violet product palette the dashboard itself
 * uses, with the dashboard's name as the headline. Fallbacks to a
 * generic "Plexus" preview if the token is invalid or the lookup
 * fails — never throws.
 */

import { ImageResponse } from "next/og";
import { adminDashboardShareQueries } from "@/lib/db/server";

export const runtime = "nodejs";
export const contentType = "image/png";
export const size = { width: 1200, height: 630 };
export const alt = "Plexus dashboard";

export default async function OpengraphImage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let dashboardName = "Plexus dashboard";
  try {
    const shareLink = await adminDashboardShareQueries.findByToken(token);
    if (shareLink && shareLink.status === "active") {
      const dashboard =
        await adminDashboardShareQueries.getDashboardForShareLink(shareLink);
      if (dashboard) dashboardName = dashboard.name;
    }
  } catch {
    // Best-effort lookup — fall through with the generic title.
  }

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "80px",
        background:
          "radial-gradient(ellipse 80% 60% at 100% 0%, rgba(139, 92, 246, 0.28), transparent 60%), radial-gradient(ellipse 70% 50% at 0% 100%, rgba(167, 139, 250, 0.18), transparent 60%), #0a0a0a",
        color: "#fafafa",
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          fontSize: 28,
          fontWeight: 500,
          color: "rgba(250, 250, 250, 0.55)",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
        }}
      >
        <span
          style={{
            width: 14,
            height: 14,
            borderRadius: 9999,
            background: "#a78bfa",
          }}
        />
        plexus · live
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div
          style={{
            fontSize: 36,
            color: "rgba(250, 250, 250, 0.5)",
            letterSpacing: "-0.01em",
          }}
        >
          shared dashboard
        </div>
        <div
          style={{
            fontSize: 80,
            fontWeight: 600,
            letterSpacing: "-0.025em",
            lineHeight: 1.05,
            maxWidth: 1040,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {dashboardName}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          color: "rgba(250, 250, 250, 0.4)",
          fontSize: 24,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
        }}
      >
        <span>view-only · real-time</span>
        <span>plexus.company</span>
      </div>
    </div>,
    {
      ...size,
    },
  );
}
