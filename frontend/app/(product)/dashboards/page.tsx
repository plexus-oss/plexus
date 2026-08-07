"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageWrapper } from "@/components/ui/page-wrapper";
import { Card } from "@/components/ui/card";
import { CreateButton } from "@/components/ui/create-button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import { TemplateGallery } from "@/components/dashboard/template-gallery";
import { useDashboards } from "@/hooks/use-dashboards";
import { useRole } from "@/hooks/use-role";
import { ACTION_NEW_DASHBOARD } from "@/lib/shortcuts";
import { LayoutDashboard, Search } from "lucide-react";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { cn } from "@/lib/utils";

export default function DashboardsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [gallerySlug, setGallerySlug] = useState<string | undefined>(undefined);
  const { dashboards, isLoading, createDashboard, deleteDashboard } =
    useDashboards();
  const { canEdit } = useRole();

  const quickSlug = searchParams.get("quick");

  // Capture the one-shot ?quick= deep-link into state during render (guarded to
  // run once per slug) rather than in an effect, which avoids a synchronous
  // setState inside an effect. The URL cleanup remains a side effect below.
  const [handledQuick, setHandledQuick] = useState<string | null>(null);
  if (quickSlug && quickSlug !== handledQuick) {
    setHandledQuick(quickSlug);
    setGallerySlug(quickSlug);
    setGalleryOpen(true);
  }

  useEffect(() => {
    if (quickSlug) {
      router.replace(`/dashboards`, { scroll: false });
    }
  }, [quickSlug, router]);

  const filteredDashboards = useMemo(() => {
    if (!search) return dashboards;
    const searchLower = search.toLowerCase();
    return dashboards.filter(
      (d) =>
        d.name.toLowerCase().includes(searchLower) ||
        d.description?.toLowerCase().includes(searchLower),
    );
  }, [dashboards, search]);

  const { activeIndex, activeRef } = useListNavigation({
    items: filteredDashboards,
    onOpen: (d) => router.push(`/dashboards/${d.id}`),
    enabled: !isLoading && filteredDashboards.length > 0 && !galleryOpen,
  });

  const openGallery = useCallback(() => {
    setGallerySlug(undefined);
    setGalleryOpen(true);
  }, []);

  const handleCreateDashboard = useCallback(async () => {
    const dashboard = await createDashboard({
      name: "Untitled Dashboard",
    });
    if (dashboard) {
      router.push(`/dashboards/${dashboard.id}`);
    }
  }, [createDashboard, router]);

  const handleDeleteDashboard = useCallback(
    async (id: string) => {
      try {
        await deleteDashboard(id);
      } catch (err) {
        console.error("Failed to delete dashboard:", err);
      }
    },
    [deleteDashboard],
  );

  return (
    <PageWrapper title="Dashboards" description="Live views of your telemetry">
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search dashboards..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-8 text-xs"
            />
          </div>
          {canEdit && (
            <CreateButton
              label="New Dashboard"
              shortcut={ACTION_NEW_DASHBOARD}
              onClick={openGallery}
            />
          )}
        </div>
      </Card>

      {isLoading && dashboards.length === 0 ? (
        <div className="flex-1" />
      ) : filteredDashboards.length === 0 ? (
        <Card className="flex-1">
          <div className="flex flex-col items-center justify-center h-full">
            <EmptyState
              icon={LayoutDashboard}
              title={search ? "No dashboards found" : "No dashboards yet"}
              description={
                search
                  ? "Try adjusting your search"
                  : "Create a dashboard to see your data come alive"
              }
              action={
                !search && canEdit
                  ? {
                      label: "Create Dashboard",
                      onClick: openGallery,
                      shortcut: ACTION_NEW_DASHBOARD,
                    }
                  : undefined
              }
            />
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredDashboards.map((dashboard, index) => (
            <div
              key={dashboard.id}
              ref={
                activeIndex === index
                  ? (activeRef as React.Ref<HTMLDivElement>)
                  : undefined
              }
              className={cn(
                "rounded-lg transition-shadow",
                activeIndex === index && "ring-2 ring-primary/50 shadow-sm",
              )}
            >
              <DashboardCard
                dashboard={dashboard}
                onDelete={handleDeleteDashboard}
              />
            </div>
          ))}
        </div>
      )}

      <TemplateGallery
        open={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        initialSourceSlug={gallerySlug}
        onStartBlank={() => {
          setGalleryOpen(false);
          void handleCreateDashboard();
        }}
      />
    </PageWrapper>
  );
}
