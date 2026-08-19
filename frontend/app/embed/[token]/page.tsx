/**
 * Hosted iframe embed — /embed/<durable-token>. A customer with no React (or who
 * just wants the simplest path) drops this URL into an <iframe>. Public: authed by
 * the durable token in the URL; framing is allowed here (X-Frame-Options is not set
 * on /embed/* — see next.config.ts). Renders the shared <PlexusPanel> full-bleed.
 */

import { PlexusPanel } from "@/components/embed/plexus-panel";

export const dynamic = "force-dynamic";

export default async function EmbedFramePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const timeRange = typeof sp.timeRange === "string" ? sp.timeRange : undefined;

  return (
    <div style={{ position: "fixed", inset: 0, background: "transparent" }}>
      <PlexusPanel
        token={token}
        apiBase=""
        timeRange={timeRange}
        height="100%"
      />
    </div>
  );
}
