"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Database, Activity, Cable, Search } from "lucide-react";
import { useSources } from "@/hooks/use-sources";
import { Cpu } from "lucide-react";
import { getLinkedDevicesForConnection } from "@/hooks/use-linked-devices";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { AddSourceDialog } from "@/components/data/add-source-dialog";
import { PageWrapper } from "@/components/ui/page-wrapper";
import { Card } from "@/components/ui/card";
import { CreateButton } from "@/components/ui/create-button";
import { Input } from "@/components/ui/input";

import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRole } from "@/hooks/use-role";
import { ACTION_ADD_CONNECTION } from "@/lib/shortcuts";
import type { ConnectionType } from "@/lib/db/types";

function getConnectionTypeLabel(connectionType: ConnectionType | null) {
  switch (connectionType) {
    case "postgres":
      return "PostgreSQL";
    case "mysql":
      return "MySQL";
    case "clickhouse":
      return "ClickHouse";
    case "influxdb":
      return "InfluxDB v2";
    case "timescaledb":
      return "TimescaleDB";
    case "prometheus":
      return "Prometheus";
    default:
      return "Database";
  }
}

function getConnectionCategory(
  connectionType: ConnectionType | null | undefined,
) {
  switch (connectionType) {
    case "clickhouse":
    case "influxdb":
    case "timescaledb":
    case "prometheus":
      return "timeseries";
    default:
      return "relational";
  }
}

function ConnectionIcon({
  connectionType,
  className,
}: {
  connectionType?: ConnectionType | null;
  className?: string;
}) {
  const category = getConnectionCategory(connectionType);
  if (category === "timeseries") {
    return <Activity className={cn("text-blue-500", className)} />;
  }
  return <Database className={cn("text-green-500", className)} />;
}

export default function ConnectionsPage() {
  return <ConnectionsPageContent />;
}

function ConnectionsPageContent() {
  const router = useRouter();
  const { canEdit } = useRole();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [search, setSearch] = useState("");
  const { connections, devices, isLoading } = useSources();

  // Keyboard shortcuts
  useHotkeys(
    [
      {
        key: ACTION_ADD_CONNECTION,
        callback: () => setShowAddDialog(true),
        description: "Add connection",
        category: "action",
      },
    ],
    [setShowAddDialog],
  );

  const filteredConnections = connections.filter((source) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      source.name?.toLowerCase().includes(searchLower) ||
      source.slug.toLowerCase().includes(searchLower) ||
      getConnectionTypeLabel(source.connection_type as ConnectionType)
        .toLowerCase()
        .includes(searchLower)
    );
  });

  return (
    <PageWrapper title="Connections" description="Bring your own database">
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
            </div>
            {canEdit && (
              <div className="flex items-center gap-2">
                <CreateButton
                  label="Add Connection"
                  shortcut={ACTION_ADD_CONNECTION}
                  onClick={() => setShowAddDialog(true)}
                />
              </div>
            )}
          </div>

          <Card className="flex-1 overflow-hidden">
            <div className="h-full overflow-auto">
              {isLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Spinner />
                </div>
              ) : filteredConnections.length === 0 ? (
                <EmptyState
                  icon={Cable}
                  title="No connections"
                  description="Store telemetry in your own Postgres, ClickHouse, or S3"
                  className="h-full"
                  action={{
                    label: "Add Connection",
                    onClick: () => setShowAddDialog(true),
                    shortcut: ACTION_ADD_CONNECTION,
                  }}
                />
              ) : (
                <Table className="w-full">
                  <TableHeader className="bg-muted/50 sticky top-0">
                    <TableRow>
                      <TableHead className="text-left text-[10px] font-medium text-muted-foreground px-3 py-2">
                        Status
                      </TableHead>
                      <TableHead className="text-left text-[10px] font-medium text-muted-foreground px-3 py-2">
                        Connection
                      </TableHead>
                      <TableHead className="text-left text-[10px] font-medium text-muted-foreground px-3 py-2">
                        Type
                      </TableHead>
                      <TableHead className="text-left text-[10px] font-medium text-muted-foreground px-3 py-2">
                        Tables
                      </TableHead>
                      <TableHead className="text-left text-[10px] font-medium text-muted-foreground px-3 py-2">
                        Linked Devices
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredConnections.map((source) => {
                      const metadata = source.metadata as Record<
                        string,
                        unknown
                      > | null;

                      return (
                        <TableRow
                          key={source.id}
                          onClick={() =>
                            router.push(`/connections/${source.slug}`)
                          }
                          className="border-b border-border/50 hover:bg-muted/50 cursor-pointer transition-colors"
                        >
                          <TableCell className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div
                                className={cn(
                                  "h-2 w-2 rounded-full",
                                  source.status === "online"
                                    ? "bg-green-500"
                                    : source.status === "error"
                                      ? "bg-red-500"
                                      : "bg-zinc-400",
                                )}
                              />
                              <span
                                className={cn(
                                  "text-[10px] capitalize",
                                  source.status === "online"
                                    ? "text-green-500"
                                    : source.status === "error"
                                      ? "text-red-500"
                                      : "text-muted-foreground",
                                )}
                              >
                                {source.status}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <ConnectionIcon
                                connectionType={
                                  source.connection_type as ConnectionType
                                }
                                className="h-3.5 w-3.5"
                              />
                              <div className="min-w-0">
                                <div className="text-xs font-medium truncate max-w-[200px]">
                                  {source.name || source.slug}
                                </div>
                                {source.name && (
                                  <div className="text-[10px] text-muted-foreground font-mono truncate max-w-[200px]">
                                    {source.slug}
                                  </div>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="px-3 py-2">
                            <span className="text-xs text-muted-foreground">
                              {getConnectionTypeLabel(
                                source.connection_type as ConnectionType,
                              )}
                            </span>
                          </TableCell>
                          <TableCell className="px-3 py-2">
                            <span className="text-xs text-muted-foreground">
                              {metadata?.tables != null
                                ? `${metadata.tables} table${
                                    Number(metadata.tables) !== 1 ? "s" : ""
                                  }`
                                : "\u2014"}
                            </span>
                          </TableCell>
                          <TableCell className="px-3 py-2">
                            {(() => {
                              const linked = getLinkedDevicesForConnection(
                                devices,
                                source.id,
                              );
                              if (linked.length === 0)
                                return (
                                  <span className="text-[10px] text-muted-foreground">
                                    {"\u2014"}
                                  </span>
                                );
                              return (
                                <div className="flex items-center gap-1">
                                  <Cpu className="h-3 w-3 text-muted-foreground shrink-0" />
                                  <span className="text-xs text-muted-foreground truncate max-w-[150px]">
                                    {linked
                                      .map(
                                        (l) => l.device.name || l.device.slug,
                                      )
                                      .join(", ")}
                                  </span>
                                </div>
                              );
                            })()}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          </Card>
        </div>

        <AddSourceDialog open={showAddDialog} onOpenChange={setShowAddDialog} />
      </div>
    </PageWrapper>
  );
}
