"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useDashboardAncestors } from "@/hooks/use-dashboards";
import { DashboardIcon } from "@/components/dashboard/icon-picker";
import type { Dashboard } from "@/lib/types/dashboard";

interface DashboardBreadcrumbProps {
  dashboard: Dashboard;
}

interface BreadcrumbItem {
  id: string;
  name: string;
  icon: string | null;
  icon_url: string | null;
}

export function DashboardBreadcrumb({ dashboard }: DashboardBreadcrumbProps) {
  const { ancestors } = useDashboardAncestors(
    dashboard.id,
    dashboard.parent_id,
  );

  const breadcrumbItems = useMemo(() => {
    const items: BreadcrumbItem[] = [];

    // Add ancestors (from root to parent)
    if (ancestors.length > 0) {
      items.push(...ancestors);
    }

    // Add current dashboard
    items.push({
      id: dashboard.id,
      name: dashboard.name,
      icon: dashboard.icon,
      icon_url: dashboard.icon_url,
    });

    return items;
  }, [ancestors, dashboard]);

  // Don't show breadcrumb if no parent (root dashboard)
  if (!dashboard.parent_id) {
    return null;
  }

  return (
    <nav className="flex items-center gap-1 text-sm text-muted-foreground">
      {breadcrumbItems.map((item, index) => {
        const isLast = index === breadcrumbItems.length - 1;
        const hasIcon = !!(item.icon || item.icon_url);

        return (
          <span key={item.id} className="flex items-center gap-1">
            {index !== 0 ? <ChevronRight className="h-4 w-4" /> : null}
            {isLast ? (
              <span className="text-foreground font-medium flex items-center gap-1">
                {hasIcon && (
                  <DashboardIcon
                    icon={item.icon}
                    iconUrl={item.icon_url}
                    size="sm"
                  />
                )}
                {item.name}
              </span>
            ) : (
              <Link
                href={`/dashboards/${item.id}`}
                className="hover:text-foreground transition-colors flex items-center gap-1"
              >
                {hasIcon && (
                  <DashboardIcon
                    icon={item.icon}
                    iconUrl={item.icon_url}
                    size="sm"
                  />
                )}
                {item.name}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
