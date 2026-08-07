/**
 * Default OG image for the app, rendered 1200×630 via next/og.
 * Next.js inlines this as `og:image` (and `twitter:image`) for every
 * route that doesn't define its own — the per-dashboard card at
 * shared/[token]/opengraph-image.tsx takes over for shared links.
 * Matches the docs + marketing dark + violet card so links across all
 * three properties read as one family.
 */

import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const contentType = "image/png";
export const size = { width: 1200, height: 630 };
export const alt = "Plexus";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "80px",
          backgroundColor: "#0a0a0a",
          backgroundImage:
            "radial-gradient(ellipse 80% 60% at 100% 0%, rgba(124, 77, 255, 0.30), transparent 60%), radial-gradient(ellipse 70% 50% at 0% 100%, rgba(167, 139, 250, 0.16), transparent 60%)",
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
              background: "#7c4dff",
            }}
          />
          plexus · app
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            style={{
              fontSize: 80,
              fontWeight: 600,
              letterSpacing: "-0.025em",
              lineHeight: 1.05,
            }}
          >
            Plexus
          </div>
          <div
            style={{
              fontSize: 36,
              color: "rgba(250, 250, 250, 0.5)",
              letterSpacing: "-0.01em",
              maxWidth: 1000,
            }}
          >
            Real-time telemetry, dashboards, and AI-powered anomaly detection
            for hardware fleets.
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
          <span>dashboards · alerts · RCA</span>
          <span>app.plexus.company</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
