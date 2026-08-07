"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { DeleteButton } from "@/components/ui/delete-button";
import { DashboardIcon } from "@/components/dashboard/icon-picker";
import { Clock } from "lucide-react";
import type { DashboardListItem } from "@/lib/types/dashboard";
import { useFormattedTime } from "@/hooks/use-formatted-time";

interface DashboardCardProps {
  dashboard: DashboardListItem;
  onDelete?: (id: string) => void;
}

export function DashboardCard({ dashboard, onDelete }: DashboardCardProps) {
  const { formatDate } = useFormattedTime();
  const timeAgo = getTimeAgo(new Date(dashboard.updated_at), formatDate);

  return (
    <Link href={`/dashboards/${dashboard.id}`}>
      <Card className="hover:bg-muted transition-colors cursor-pointer group">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-md flex items-center justify-center">
              <DashboardIcon
                icon={dashboard.icon}
                iconUrl={dashboard.icon_url}
                size="md"
              />
            </div>
            <div>
              <h3 className="font-medium text-foreground">{dashboard.name}</h3>
              {dashboard.description && (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                  {dashboard.description}
                </p>
              )}
            </div>
          </div>

          <div onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
            <DeleteButton
              entityName={dashboard.name}
              onConfirm={() => onDelete?.(dashboard.id)}
              className="opacity-0 group-hover:opacity-100 transition-opacity"
            />
          </div>
        </div>

        <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
          <span>{dashboard.panel_count} panels</span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {timeAgo}
          </span>
        </div>
      </Card>
    </Link>
  );
}

function getTimeAgo(date: Date, formatDate: (d: Date) => string): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return formatDate(date);
}
