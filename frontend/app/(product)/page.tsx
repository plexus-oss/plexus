"use client";

import Link from "next/link";
import { LayoutDashboard } from "lucide-react";
import { motion } from "framer-motion";
import { usePlexusSession } from "@/hooks/use-plexus-session";
import { formatDateInZone } from "@/lib/timezone";
import { useDashboards } from "@/hooks/use-dashboards";
import { useSources } from "@/hooks/use-sources";
import { useUsage } from "@/hooks/use-usage";
import { PageWrapper } from "@/components/ui/page-wrapper";
import { SectionHeader } from "@/components/ui/section-header";
import { FleetStatusGrid } from "@/components/home/fleet-status-grid";
import { ActivityFeed } from "@/components/home/activity-feed";
import { GetStartedPanel } from "@/components/home/get-started-panel";
import { PathShortcuts } from "@/components/home/path-shortcuts";
import { TeamTierBanner } from "@/components/billing/team-tier-banner";

function FadeUp({
  children,
  delay = 0,
}: {
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
    >
      {children}
    </motion.div>
  );
}

export default function HomePage() {
  const { firstName: userFirstName } = usePlexusSession();
  const { dashboards } = useDashboards();
  const { sources, isLoading: sourcesLoading } = useSources();
  const { usage, refresh: refreshUsage } = useUsage();

  const billing = usage?.billing;
  const needsCard = billing?.tier === "tier_1" && billing.isPaid === false;

  let sectionIndex = 0;

  const firstName = userFirstName || "";
  const isEmptyOrg = !sourcesLoading && sources.length === 0;

  return (
    <PageWrapper
      title={firstName ? `Welcome back, ${firstName}` : "Home"}
      description="Telemetry for hardware fleets and software services."
    >
      <div className="p-3 space-y-6">
        {needsCard && (
          <FadeUp delay={sectionIndex++ * 0.08}>
            <TeamTierBanner onCardAdded={() => refreshUsage()} />
          </FadeUp>
        )}

        {sourcesLoading ? null : isEmptyOrg ? (
          <FadeUp delay={sectionIndex++ * 0.08}>
            <GetStartedPanel />
          </FadeUp>
        ) : (
          <>
            <FadeUp delay={sectionIndex++ * 0.08}>
              <FleetStatusGrid />
            </FadeUp>

            <FadeUp delay={sectionIndex++ * 0.08}>
              <PathShortcuts />
            </FadeUp>

            <FadeUp delay={sectionIndex++ * 0.08}>
              <div className="space-y-2">
                <SectionHeader
                  action={
                    <Link
                      href="/events"
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      View all
                    </Link>
                  }
                >
                  Recent Activity
                </SectionHeader>
                <ActivityFeed />
              </div>
            </FadeUp>

            {dashboards.length > 0 && (
              <FadeUp delay={sectionIndex++ * 0.08}>
                <div className="space-y-2">
                  <SectionHeader
                    action={
                      dashboards.length > 6 ? (
                        <Link
                          href="/dashboards"
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          View all
                        </Link>
                      ) : undefined
                    }
                  >
                    Recent Dashboards
                  </SectionHeader>
                  <div className="rounded-lg border divide-y">
                    {dashboards.slice(0, 6).map((d) => (
                      <Link
                        key={d.id}
                        href={`/dashboards/${d.id}`}
                        className="flex items-center justify-between p-3 hover:bg-accent/50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">{d.name}</span>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>{d.panel_count} panels</span>
                          <span>{getTimeAgo(new Date(d.updated_at))}</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              </FadeUp>
            )}
          </>
        )}
      </div>
    </PageWrapper>
  );
}

function getTimeAgo(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return formatDateInZone(date, "UTC", "short");
}
