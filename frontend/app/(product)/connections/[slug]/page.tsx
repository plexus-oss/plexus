"use client";

import { useState, use, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import {
  Database,
  Activity,
  Circle,
  Copy,
  Clock,
  Calendar,
  ChevronRight,
  RefreshCw,
  Table2,
  AlertCircle,
  ExternalLink,
  Cpu,
  Pencil,
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { useSource, useSources } from "@/hooks/use-sources";
import { useConnectionSchema } from "@/hooks/use-connection-schema";
import { PageWrapper } from "@/components/ui/page-wrapper";
import { TabNav } from "@/components/ui/tab-nav";
import { SectionHeader } from "@/components/ui/section-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow, format } from "date-fns";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import Link from "next/link";
import type { ConnectionType } from "@/lib/db/types";
import { useRole } from "@/hooks/use-role";
import { useLinkedDevices } from "@/hooks/use-linked-devices";
import { ContextTab } from "@/components/source/context-tab";
import { TableSelector } from "@/components/connections/table-selector";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogContent,
} from "@/components/ui/alert-dialog";
import { SaveBar } from "@/components/ui/save-bar";
import { useSaveBar } from "@/hooks/use-save-bar";
import { EditConnectionModal } from "@/components/connections/edit-connection-modal";
import {
  IdentityMapping,
  ScopeColumnsEditor,
} from "@/components/connections/identity-mapping";
import { discoveryRulesOf } from "@/lib/discovery/types";

interface PageProps {
  params: Promise<{ slug: string }>;
}

type ConnectionTabType = "overview" | "tables" | "context";

function getConnectionTypeInfo(connectionType: ConnectionType | null) {
  switch (connectionType) {
    case "postgres":
      return { label: "PostgreSQL", category: "relational" };
    case "mysql":
      return { label: "MySQL", category: "relational" };
    case "clickhouse":
      return { label: "ClickHouse", category: "timeseries" };
    case "influxdb":
      return { label: "InfluxDB", category: "timeseries" };
    case "timescaledb":
      return { label: "TimescaleDB", category: "timeseries" };
    case "prometheus":
      return { label: "Prometheus", category: "timeseries" };
    default:
      return { label: "Database", category: "relational" };
  }
}

function ConnectionIcon({
  connectionType,
  className,
}: {
  connectionType: ConnectionType | null;
  className?: string;
}) {
  const typeInfo = getConnectionTypeInfo(connectionType);
  if (typeInfo.category === "timeseries") {
    return <Activity className={cn("text-blue-500", className)} />;
  }
  return <Database className={cn("text-green-500", className)} />;
}

export default function ConnectionDetailPage({ params }: PageProps) {
  const { slug } = use(params);
  const router = useRouter();
  const { canEdit } = useRole();
  const { source, isLoading, mutate } = useSource(slug);

  const [activeTab, setActiveTab] = useState<ConnectionTabType>("overview");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState("");
  const initializedRef = useRef(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const { deleteSource, updateSource, testConnection } = useSources();
  const { linkedDevices } = useLinkedDevices(source?.id ?? null);

  // Use connection schema hook instead of manual fetch
  const { schema, mutate: mutateSchema } = useConnectionSchema(
    source?.status === "online" ? source.slug : null,
  );
  const discoveryRules = discoveryRulesOf(
    (source?.config ?? {}) as Record<string, unknown>,
  );

  // Save bar for deferred saves. Keep latest values in refs so the save/discard
  // callbacks always read current values without being re-created.
  const sourceRef = useRef(source);
  const editedNameRef = useRef(editedName);
  useEffect(() => {
    sourceRef.current = source;
    editedNameRef.current = editedName;
  });

  const { saveBarProps, leaveConfirm, markDirty } = useSaveBar({
    onSave: async () => {
      const s = sourceRef.current;
      if (!s) return;
      const updates: Record<string, unknown> = {};
      if (editedNameRef.current !== (s.name || "")) {
        updates.name = editedNameRef.current || undefined;
      }
      if (Object.keys(updates).length > 0) {
        await updateSource(s.id, updates);
        mutate();
      }
      setIsEditingName(false);
    },
    onDiscard: () => {
      const s = sourceRef.current;
      setEditedName(s?.name || "");
      setIsEditingName(false);
    },
    currentPath: `/connections/${slug}`,
    enabled: canEdit,
    successMessage: "Connection saved",
    errorMessage: "Failed to save connection",
  });

  useEffect(() => {
    if (source && !initializedRef.current) {
      initializedRef.current = true;
      setEditedName(source.name || "");
    }
  }, [source]);

  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [isEditingName]);

  const handleNameChange = useCallback(
    (value: string) => {
      setEditedName(value);
      markDirty();
    },
    [markDirty],
  );

  const handleDelete = async () => {
    if (!source) return;
    setIsDeleting(true);
    await deleteSource(source.id);
    router.push("/connections");
  };

  const handleTestConnection = async () => {
    if (!source) return;
    await testConnection(source.id);
    mutate();
  };

  const copySlug = () => {
    if (!source) return;
    navigator.clipboard.writeText(source.slug);
  };

  if (isLoading) {
    return (
      <PageWrapper title="Connections">
        <div className="flex items-center justify-center h-64">
          <Spinner />
        </div>
      </PageWrapper>
    );
  }

  if (!source) {
    return (
      <PageWrapper title="Connections">
        <div className="p-8">
          <EmptyState
            icon={Database}
            title="Connection not found"
            action={{
              label: "Back to Connections",
              onClick: () => router.push("/connections"),
            }}
          />
        </div>
      </PageWrapper>
    );
  }

  // If someone navigates to /connections/[slug] for a device, redirect them
  if (source.source_type === "device") {
    router.replace(`/devices/${source.slug}`);
    return (
      <PageWrapper title="Redirecting...">
        <div className="flex items-center justify-center h-64">
          <Spinner />
        </div>
      </PageWrapper>
    );
  }

  const metadata = source.metadata as Record<string, unknown> | null;
  const typeInfo = getConnectionTypeInfo(
    source.connection_type as ConnectionType,
  );

  const tabs = [
    { id: "overview", label: "Overview" },
    ...(source.status === "online" ? [{ id: "tables", label: "Tables" }] : []),
    { id: "context", label: "Context" },
  ];

  return (
    <PageWrapper
      title={
        <div className="flex items-center gap-1">
          <Link
            href="/connections"
            className="text-muted-foreground text-sm hover:text-foreground transition-colors flex items-center gap-1"
          >
            Connections
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-sm font-medium">
            {source.name || source.slug}
          </span>
        </div>
      }
    >
      <div className="flex flex-col h-full">
        <TabNav
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={(id) => setActiveTab(id as ConnectionTabType)}
        />

        <div className="flex-1 overflow-auto">
          {activeTab === "overview" && (
            <div className="p-6 max-w-3xl mx-auto">
              <div className="mb-8">
                <div className="group mb-1">
                  {isEditingName ? (
                    <Input
                      ref={nameInputRef}
                      type="text"
                      value={editedName}
                      onChange={(e) => handleNameChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") setIsEditingName(false);
                        if (e.key === "Escape") {
                          setEditedName(source.name || "");
                          setIsEditingName(false);
                        }
                      }}
                      onBlur={() => setIsEditingName(false)}
                      className="text-2xl font-semibold bg-transparent border-none outline-none focus:ring-0 p-0 w-full"
                      placeholder="Untitled connection"
                    />
                  ) : (
                    <h1
                      onClick={
                        canEdit ? () => setIsEditingName(true) : undefined
                      }
                      className={cn(
                        "text-2xl font-semibold rounded px-1 -mx-1 transition-colors",
                        canEdit && "cursor-text hover:bg-muted/50",
                      )}
                    >
                      {source.name || (
                        <span className="text-muted-foreground">
                          Untitled connection
                        </span>
                      )}
                    </h1>
                  )}
                </div>

                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <code className="font-mono">{source.slug}</code>
                  <Button
                    variant="ghost"
                    onClick={copySlug}
                    size="sm"
                    className="h-6 text-xs p-0"
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>

              {typeInfo && (
                <Card className="p-4 mb-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          "p-2 rounded-lg",
                          source.status === "online"
                            ? "bg-green-500/10"
                            : "bg-muted",
                        )}
                      >
                        <ConnectionIcon
                          connectionType={
                            source.connection_type as ConnectionType
                          }
                          className="h-5 w-5"
                        />
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          {source.status === "online"
                            ? "Connected"
                            : source.status === "error"
                              ? "Connection Error"
                              : source.status === "pending"
                                ? "Testing..."
                                : "Disconnected"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {typeInfo.label}
                          {metadata?.host
                            ? ` \u00b7 ${String(metadata.host)}`
                            : null}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleTestConnection}
                        disabled={source.status === "pending"}
                        className="h-8 text-xs"
                      >
                        <RefreshCw
                          className={cn(
                            "h-3 w-3 mr-1.5",
                            source.status === "pending" && "animate-spin",
                          )}
                        />
                        Test Connection
                      </Button>
                      {canEdit && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setShowEditModal(true)}
                          className="h-8 w-8 p-0"
                          title="Edit connection"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {source.last_error && (
                    <div className="mt-3 p-2 rounded bg-red-500/10 text-red-600 dark:text-red-400 text-xs flex items-start gap-2">
                      <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      {source.last_error}
                    </div>
                  )}
                </Card>
              )}

              <div className="space-y-4">
                <SectionHeader>Properties</SectionHeader>
                <div className="space-y-3">
                  <div className="flex items-start py-1.5">
                    <span className="w-32 text-sm text-muted-foreground flex items-center gap-2">
                      <Circle className="h-3.5 w-3.5" />
                      Status
                    </span>
                    <div className="flex items-center gap-2">
                      <div
                        className={cn(
                          "h-2 w-2 rounded-full",
                          source.status === "online"
                            ? "bg-green-500"
                            : source.status === "error"
                              ? "bg-red-500"
                              : source.status === "pending"
                                ? "bg-yellow-500 animate-pulse"
                                : "bg-zinc-400",
                        )}
                      />
                      <span className="text-sm capitalize">
                        {source.status}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-start py-1.5">
                    <span className="w-32 text-sm text-muted-foreground flex items-center gap-2">
                      <Database className="h-3.5 w-3.5" />
                      Type
                    </span>
                    <span className="text-sm">{typeInfo?.label}</span>
                  </div>

                  {!!metadata?.host && (
                    <div className="flex items-start py-1.5">
                      <span className="w-32 text-sm text-muted-foreground flex items-center gap-2">
                        <ExternalLink className="h-3.5 w-3.5" />
                        Host
                      </span>
                      <span className="text-sm font-mono">
                        {String(metadata.host)}
                      </span>
                    </div>
                  )}

                  {!!metadata?.database && (
                    <div className="flex items-start py-1.5">
                      <span className="w-32 text-sm text-muted-foreground flex items-center gap-2">
                        <Table2 className="h-3.5 w-3.5" />
                        Database
                      </span>
                      <span className="text-sm font-mono">
                        {String(metadata.database)}
                      </span>
                    </div>
                  )}

                  {metadata?.tables != null && (
                    <div className="flex items-start py-1.5">
                      <span className="w-32 text-sm text-muted-foreground flex items-center gap-2">
                        <Table2 className="h-3.5 w-3.5" />
                        Tables
                      </span>
                      <span className="text-sm">
                        {(
                          (source.config as Record<string, unknown>)
                            ?.selectedTables as string[]
                        )?.length
                          ? `${
                              (
                                (source.config as Record<string, unknown>)
                                  .selectedTables as string[]
                              ).length
                            } of ${metadata.tables} tables selected`
                          : `${String(metadata.tables)} tables discovered`}
                      </span>
                    </div>
                  )}

                  <div className="flex items-start py-1.5">
                    <span className="w-32 text-sm text-muted-foreground flex items-center gap-2">
                      <Calendar className="h-3.5 w-3.5" />
                      Created
                    </span>
                    <span className="text-sm">
                      {source.created_at
                        ? format(
                            new Date(source.created_at),
                            "MMM d, yyyy 'at' h:mm a",
                          )
                        : "\u2014"}
                    </span>
                  </div>

                  <div className="flex items-start py-1.5">
                    <span className="w-32 text-sm text-muted-foreground flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5" />
                      Last connected
                    </span>
                    <span className="text-sm">
                      {source.last_connected_at
                        ? formatDistanceToNow(
                            new Date(source.last_connected_at),
                            { addSuffix: true },
                          )
                        : "Never"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Linked Devices (read-only; derived from each device's linked_connections) */}
              <div className="mt-8 space-y-4">
                <SectionHeader>Linked Devices</SectionHeader>
                {linkedDevices.length > 0 ? (
                  <div className="space-y-1">
                    {linkedDevices.map(({ device }) => (
                      <Link
                        key={device.id}
                        href={`/devices/${device.slug}`}
                        className="flex items-center gap-2.5 px-3 py-2 rounded-md hover:bg-muted/50 transition-colors text-sm"
                      >
                        <Cpu className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span>{device.name || device.slug}</span>
                        {device.device_type && (
                          <span className="text-xs text-muted-foreground ml-auto">
                            {device.device_type}
                          </span>
                        )}
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No devices linked yet. Link from a device&apos;s Data tab.
                  </p>
                )}
              </div>

              {canEdit && (
                <div className="mt-12 pt-8 border-t border-border">
                  <SectionHeader className="mb-4">Danger Zone</SectionHeader>
                  <Button
                    onClick={() => setShowDeleteConfirm(true)}
                    size="sm"
                    variant="destructive"
                    disabled={isDeleting}
                  >
                    {isDeleting ? (
                      <>
                        <Spinner className="h-3 w-3 mr-1.5" />
                        Removing...
                      </>
                    ) : (
                      "Remove connection"
                    )}
                  </Button>
                </div>
              )}
              <AlertDialog
                open={showDeleteConfirm}
                onOpenChange={setShowDeleteConfirm}
              >
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove Connection</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to remove &quot;
                      {source.name || source.slug}
                      &quot;? This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={handleDelete}
                    >
                      Remove
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}

          {activeTab === "tables" && (
            <div className="p-6 max-w-3xl mx-auto space-y-8">
              <TableSelector
                sourceId={source.slug}
                config={(source.config as Record<string, unknown>) || {}}
                onUpdate={async (selectedTables) => {
                  await updateSource(source.id, {
                    config: { selectedTables },
                  });
                  mutate();
                  mutateSchema();
                }}
              />

              {canEdit && (
                <div className="space-y-3">
                  <div>
                    <h3 className="text-sm font-medium">Identity mapping</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Map a column that names the things you monitor — each
                      value becomes its own source.
                    </p>
                  </div>
                  {discoveryRules.length > 0 && (
                    <div className="space-y-1.5">
                      {discoveryRules.map((rule) => (
                        <div
                          key={`${rule.schema ?? ""}.${rule.table}`}
                          className="flex items-center gap-2 text-sm rounded-md border border-border/60 px-3 py-2"
                        >
                          <span className="font-mono text-xs">
                            {rule.table}.{rule.idColumn}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            → {rule.kind} sources
                          </span>
                          <button
                            className="ml-auto text-xs text-muted-foreground hover:text-destructive transition-colors"
                            onClick={async () => {
                              await fetch(
                                `/api/sources/${source.id}/discovery?table=${encodeURIComponent(rule.table)}`,
                                { method: "DELETE" },
                              );
                              mutate();
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <IdentityMapping
                    sourceId={source.id}
                    schema={schema ?? null}
                    onSaved={() => {
                      mutate();
                    }}
                  />
                  {discoveryRules.length > 0 && (
                    <ScopeColumnsEditor
                      sourceId={source.id}
                      schema={schema ?? null}
                      scopeColumns={
                        (
                          (source.config ?? {}) as {
                            scopeColumns?: string[];
                          }
                        ).scopeColumns ?? []
                      }
                      onSaved={() => mutate()}
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === "context" && (
            <div className="mt-8">
              <ContextTab sourceId={source.id} />
            </div>
          )}
        </div>
      </div>
      {canEdit && <SaveBar {...saveBarProps} />}

      {showEditModal && (
        <EditConnectionModal
          source={source}
          open={showEditModal}
          onOpenChange={setShowEditModal}
          onSaved={() => mutate()}
        />
      )}

      <AlertDialog open={leaveConfirm.isOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes that will be lost. Are you sure you want
              to leave?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={leaveConfirm.onStay}>
              Stay
            </AlertDialogCancel>
            <AlertDialogAction onClick={leaveConfirm.onLeave}>
              Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageWrapper>
  );
}
