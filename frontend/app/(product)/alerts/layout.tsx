"use client";

import { usePathname, useRouter } from "next/navigation";
import { PageWrapper } from "@/components/ui/page-wrapper";
import { TabNav } from "@/components/ui/tab-nav";

const TABS = [
  {
    id: "/alerts",
    label: "Alerts",
  },
  {
    id: "/alerts/monitors",
    label: "Monitors",
  },
  {
    id: "/alerts/fleet",
    label: "Fleet",
  },
  {
    id: "/alerts/integrations",
    label: "Integrations",
  },
];

export default function AlertsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const activeTab =
    TABS.find((t) => t.id !== "/alerts" && pathname.startsWith(t.id))?.id ??
    "/alerts";

  return (
    <PageWrapper
      title="Alerts"
      description="Monitor, integrate and track alerts"
    >
      <div className="flex flex-col h-full">
        <TabNav
          tabs={TABS}
          activeTab={activeTab}
          onTabChange={(id) => router.push(id)}
          className="px-2 shrink-0"
        />
        <div className="flex-1 overflow-hidden">{children}</div>
      </div>
    </PageWrapper>
  );
}
