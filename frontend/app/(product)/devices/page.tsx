"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useSources } from "@/hooks/use-sources";
import { usePlexusRealtime } from "@/hooks/use-plexus-realtime";
import { useSourceGroups } from "@/hooks/use-source-groups";
import { SourceList } from "@/components/fleet/source-list";
import { AddDeviceModal } from "@/components/fleet/add-device-modal";
import { PageWrapper } from "@/components/ui/page-wrapper";
import { Card } from "@/components/ui/card";
import { CreateButton } from "@/components/ui/create-button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/lib/toast-utils";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useRole } from "@/hooks/use-role";
import { useAvailableMetrics } from "@/hooks/use-telemetry";
import { ACTION_ADD_DEVICE } from "@/lib/shortcuts";

export default function DevicesPage() {
  const router = useRouter();
  const { canEdit } = useRole();
  const [search, setSearch] = useState("");
  const [showAddDeviceModal, setShowAddDeviceModal] = useState(false);
  const [groupFilter, setGroupFilter] = useState<string>("all");

  const {
    devices: sourceDevices,
    connections: sourceConnections,
    isLoading: sourcesLoading,
    refresh: refreshSources,
    deleteSource,
    createSource,
  } = useSources();

  const { sources: realtimeSources } = usePlexusRealtime();
  const { groups } = useSourceGroups();
  const { metricsBySource } = useAvailableMetrics();

  useHotkeys(
    [
      {
        key: ACTION_ADD_DEVICE,
        callback: () => setShowAddDeviceModal(true),
        description: "Add device",
        category: "action",
      },
    ],
    [setShowAddDeviceModal],
  );

  // Get connection slugs to exclude from device list
  const connectionSlugs = new Set(sourceConnections.map((c) => c.slug));

  const getSlugFromSourceId = (sourceId: string) => {
    const colonIndex = sourceId.lastIndexOf(":");
    return colonIndex >= 0 ? sourceId.slice(colonIndex + 1) : sourceId;
  };

  const allDeviceSlugs = new Set([
    ...sourceDevices.map((d) => d.slug),
    ...realtimeSources
      .map((d) => getSlugFromSourceId(d.source_id))
      .filter((slug) => !connectionSlugs.has(slug)),
  ]);

  const devices = Array.from(allDeviceSlugs).map((slug) => {
    const source = sourceDevices.find((d) => d.slug === slug);
    const realtimeSource = realtimeSources.find(
      (d) => d.source_id === slug || d.source_id.endsWith(`:${slug}`),
    );
    const isOnlineNow = realtimeSource?.status === "online";

    // Count metrics from available metrics data
    const metricsForSource = metricsBySource.find((m) => m.source_id === slug);
    const realtimeMetricCount =
      realtimeSource?.sensors?.reduce(
        (sum, s) => sum + (s.metrics?.length || 0),
        0,
      ) || 0;
    const metricCount =
      metricsForSource?.metrics?.length || realtimeMetricCount || 0;

    if (source) {
      return {
        id: source.id,
        slug: source.slug,
        name: source.name,
        source_type: "device" as const,
        device_type: source.device_type,
        status: isOnlineNow
          ? ("online" as const)
          : (source.status as "online" | "offline" | "unknown"),
        last_seen_at: source.last_seen_at,
        metadata: source.metadata as Record<string, unknown>,
        location: null,
        _isRegistered: true,
        recording:
          (source.config as Record<string, unknown> | null)?.recording === true,
        metricCount,
      };
    }

    return {
      id: slug,
      slug,
      name: null,
      source_type: "device" as const,
      device_type: realtimeSource?.platform || null,
      status: isOnlineNow ? ("online" as const) : ("unknown" as const),
      last_seen_at: null,
      metadata: {},
      location: null,
      _isRegistered: false,
      metricCount,
    };
  });

  const filteredDevices = useMemo(() => {
    return devices.filter((device) => {
      if (search) {
        const searchLower = search.toLowerCase();
        const matchesSearch =
          device.slug.toLowerCase().includes(searchLower) ||
          device.name?.toLowerCase().includes(searchLower) ||
          device.device_type?.toLowerCase().includes(searchLower);
        if (!matchesSearch) return false;
      }
      return true;
    });
  }, [devices, search]);

  const handleAddSource = async (
    sourceId: string,
    platform?: string | null,
  ) => {
    try {
      await createSource({
        source_type: "device",
        slug: sourceId,
        name: sourceId,
        device_type: platform || undefined,
      });
      toast.success(`Device ${sourceId} added`);
    } catch {
      // Error handled in createSource
    }
  };

  const handleDeviceClick = (id: string) => {
    const device = devices.find((d) => d.id === id);
    if (!device) return;
    router.push(`/devices/${device.slug}`);
  };

  const handleDeleteDevice = async (id: string) => {
    await deleteSource(id);
  };

  return (
    <PageWrapper title="Devices" description="Your fleet, at a glance">
      <div className="flex flex-col h-full">
        <div className="flex-1 flex flex-col overflow-hidden p-2">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-4">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  placeholder="Search..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-7 h-8 w-48"
                />
              </div>
              {groups.length > 0 && (
                <Select value={groupFilter} onValueChange={setGroupFilter}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="All devices" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All devices</SelectItem>
                    {groups.map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        <div className="flex items-center gap-2">
                          {group.color && (
                            <span
                              className="h-2 w-2 rounded-full shrink-0"
                              style={{ backgroundColor: group.color }}
                            />
                          )}
                          {group.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            {canEdit && (
              <div className="flex items-center gap-2">
                <CreateButton
                  label="Add Device"
                  shortcut={ACTION_ADD_DEVICE}
                  onClick={() => setShowAddDeviceModal(true)}
                />
              </div>
            )}
          </div>

          <Card className="flex-1 overflow-hidden">
            <div className="h-full overflow-auto">
              <SourceList
                sources={filteredDevices}
                isLoading={sourcesLoading}
                onSourceClick={handleDeviceClick}
                onDeleteSource={handleDeleteDevice}
                onAddSource={handleAddSource}
                onOpenAddDevice={() => setShowAddDeviceModal(true)}
              />
            </div>
          </Card>
        </div>

        <AddDeviceModal
          open={showAddDeviceModal}
          onClose={() => setShowAddDeviceModal(false)}
          onSuccess={() => {
            setShowAddDeviceModal(false);
            refreshSources();
          }}
        />
      </div>
    </PageWrapper>
  );
}
