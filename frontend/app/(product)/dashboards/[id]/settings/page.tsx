"use client";

import { use, useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { PageWrapper } from "@/components/ui/page-wrapper";
import { TabNav } from "@/components/ui/tab-nav";
import { SectionHeader } from "@/components/ui/section-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDashboard, useDashboards } from "@/hooks/use-dashboards";
import { MINUTE_MS, HOUR_MS, DAY_MS } from "@/lib/constants/time";
import {
  useDashboardShare,
  useDashboardAnalytics,
} from "@/hooks/use-dashboard-share";
import {
  ChevronRight,
  Link2,
  Users,
  Eye,
  Trash2,
  Copy,
  Check,
  Plus,
  BarChart3,
  Globe,
  Calendar,
  ExternalLink,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
} from "lucide-react";
import Link from "next/link";
import type { ShareLinkAccess } from "@/lib/db/types";
import { useRole } from "@/hooks/use-role";
import { toast } from "@/lib/toast-utils";
import { cn } from "@/lib/utils";
import { DashboardIcon } from "@/components/dashboard/icon-picker";
import { VariableEditor } from "@/components/dashboard/variable-editor";
import type {
  DashboardVariable,
  DashboardConfig,
  DashboardDisplaySettings,
} from "@/lib/types/dashboard";
import { SaveBar } from "@/components/ui/save-bar";
import { useSaveBar } from "@/hooks/use-save-bar";
import { useFormattedTime } from "@/hooks/use-formatted-time";
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

type SettingsTab = "display" | "variables" | "sharing" | "analytics";

interface SettingsPageProps {
  params: Promise<{ id: string }>;
}

type AnalyticsPeriod = 7 | 30 | 90;

function TrendIndicator({
  value,
  suffix = "%",
}: {
  value: number | null;
  suffix?: string;
}) {
  if (value === null) return <span className="text-muted-foreground">--</span>;
  const isPositive = value > 0;
  const isNeutral = value === 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-medium",
        isPositive && "text-emerald-600 dark:text-emerald-400",
        !isPositive && !isNeutral && "text-red-600 dark:text-red-400",
        isNeutral && "text-muted-foreground",
      )}
    >
      {isPositive ? (
        <ArrowUpRight className="h-3 w-3" />
      ) : isNeutral ? (
        <Minus className="h-3 w-3" />
      ) : (
        <ArrowDownRight className="h-3 w-3" />
      )}
      {isPositive && "+"}
      {value}
      {suffix}
    </span>
  );
}

export default function DashboardSettingsPage({ params }: SettingsPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const {
    dashboard,
    isLoading: dashboardLoading,
    updateDashboard,
  } = useDashboard(id);
  const { deleteDashboard } = useDashboards();
  const {
    shareLinks,
    permissions,
    isLoading: shareLoading,
    createShareLink,
    revokeShareLink,
    inviteUser,
    removePermission,
    updatePermission,
  } = useDashboardShare(id);

  const { canEdit } = useRole();
  const { formatDate } = useFormattedTime();
  const [activeTab, setActiveTab] = useState<SettingsTab>("display");
  const [analyticsPeriod, setAnalyticsPeriod] = useState<AnalyticsPeriod>(30);
  const { analytics, isLoading: analyticsLoading } = useDashboardAnalytics(
    id,
    analyticsPeriod,
  );

  const [copied, setCopied] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [email, setEmail] = useState("");
  const [accessLevel, setAccessLevel] = useState<ShareLinkAccess>("view");
  const [isCreatingLink, setIsCreatingLink] = useState(false);
  const [isInviting, setIsInviting] = useState(false);

  // Local state for deferred save
  const [localDisplaySettings, setLocalDisplaySettings] =
    useState<Partial<DashboardDisplaySettings> | null>(null);
  const [localVariables, setLocalVariables] = useState<
    DashboardVariable[] | null
  >(null);

  const dashboardRef = useRef(dashboard);
  const localDisplaySettingsRef = useRef(localDisplaySettings);
  const localVariablesRef = useRef(localVariables);
  useEffect(() => {
    dashboardRef.current = dashboard;
    localDisplaySettingsRef.current = localDisplaySettings;
    localVariablesRef.current = localVariables;
  });

  const { saveBarProps, leaveConfirm, markDirty } = useSaveBar({
    onSave: async () => {
      const db = dashboardRef.current;
      if (!db) return;
      const config = { ...(db.config as DashboardConfig) };
      let changed = false;
      if (localDisplaySettingsRef.current !== null) {
        const current = config.displaySettings || {};
        config.displaySettings = {
          ...current,
          ...localDisplaySettingsRef.current,
        };
        changed = true;
      }
      if (localVariablesRef.current !== null) {
        config.variables = localVariablesRef.current;
        changed = true;
      }
      if (changed) {
        await updateDashboard({ config } as { config: DashboardConfig });
      }
      setLocalDisplaySettings(null);
      setLocalVariables(null);
    },
    onDiscard: () => {
      setLocalDisplaySettings(null);
      setLocalVariables(null);
    },
    currentPath: `/dashboards/${id}/settings`,
    enabled: canEdit,
    successMessage: "Dashboard settings saved",
    errorMessage: "Failed to save settings",
  });

  const handleDisplayChange = useCallback(
    (updates: Partial<DashboardDisplaySettings>) => {
      setLocalDisplaySettings((prev) => ({ ...prev, ...updates }));
      markDirty();
    },
    [markDirty],
  );

  const handleVariablesChange = useCallback(
    (variables: DashboardVariable[]) => {
      setLocalVariables(variables);
      markDirty();
    },
    [markDirty],
  );

  const handleDelete = useCallback(() => {
    // Navigate first; useDashboards optimistically removes the item from
    // the list cache, so the destination already reflects the delete.
    // The hook toasts on failure and reverts the cache.
    setShowDeleteConfirm(false);
    router.push(`/dashboards`);
    void deleteDashboard(id).catch(() => {});
  }, [deleteDashboard, id, router]);

  const handleCopyLink = async (token: string) => {
    try {
      const url = `${window.location.origin}/shared/${token}`;
      await navigator.clipboard.writeText(url);
      setCopied(token);
      setTimeout(() => setCopied(null), 2000);
      toast.success("Link copied to clipboard");
    } catch {
      toast.error("Failed to copy link");
    }
  };

  const handleCreateLink = async () => {
    setIsCreatingLink(true);
    try {
      await createShareLink();
      toast.success("Share link created");
    } catch {
      // Error handled by hook
    } finally {
      setIsCreatingLink(false);
    }
  };

  const handleInvite = async () => {
    if (!email.includes("@")) return;
    setIsInviting(true);
    try {
      await inviteUser(email, accessLevel);
      setEmail("");
    } catch {
      // Error handled by hook
    } finally {
      setIsInviting(false);
    }
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  };

  const formatRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / MINUTE_MS);
    const diffHours = Math.floor(diffMs / HOUR_MS);
    const diffDays = Math.floor(diffMs / DAY_MS);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return formatDate(date, "short");
  };

  // Calculate chart data with filled dates
  const viewsByDay = analytics?.viewsByDay;
  const chartData = useMemo(() => {
    if (!viewsByDay) return [];
    const data = viewsByDay.slice(-analyticsPeriod);
    const maxViews = Math.max(...data.map((d) => d.views), 1);
    return data.map((d) => ({
      ...d,
      height: (d.views / maxViews) * 100,
    }));
  }, [viewsByDay, analyticsPeriod]);

  const tabs = [
    {
      id: "display",
      label: "General",
    },
    {
      id: "variables",
      label: "Dashboard Filters",
    },
    {
      id: "sharing",
      label: "Sharing",
    },
    {
      id: "analytics",
      label: "Analytics",
    },
  ];

  if (dashboardLoading) {
    return (
      <PageWrapper title="Dashboard Settings">
        <div className="h-full flex items-center justify-center">
          <Spinner />
        </div>
      </PageWrapper>
    );
  }

  if (!dashboard) {
    return (
      <PageWrapper title="Dashboard Settings">
        <div className="h-full flex items-center justify-center">
          <p className="text-muted-foreground">Dashboard not found</p>
        </div>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper
      title={
        <div className="flex items-center gap-1">
          <Link
            href={`/dashboards/${id}`}
            className="text-muted-foreground text-sm hover:text-foreground transition-colors flex items-center gap-1"
          >
            <DashboardIcon
              icon={dashboard.icon}
              iconUrl={dashboard.icon_url}
              size="sm"
            />
            {dashboard.name}
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-sm font-medium">Settings</span>
        </div>
      }
      description="Manage the settings for this dashboard"
    >
      <div className="flex flex-col h-full">
        <TabNav
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={(id) => setActiveTab(id as SettingsTab)}
        />

        <div className="flex-1 overflow-auto">
          <div className="p-6 max-w-2xl mx-auto space-y-8">
            {activeTab === "display" &&
              dashboard &&
              (() => {
                const config = dashboard.config as DashboardConfig;
                const serverDs = config.displaySettings || {};
                const ds = { ...serverDs, ...localDisplaySettings };

                return (
                  <div className="space-y-6">
                    <div>
                      <SectionHeader>General</SectionHeader>
                      <p className="text-[12px] text-muted-foreground mt-1">
                        Control how this dashboard looks when viewed. Lock
                        editing to use it as a read-only UI page.
                      </p>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between py-2">
                        <div>
                          <Label className="text-sm">Lock editing</Label>
                          <p className="text-[12px] text-muted-foreground mt-0.5">
                            Prevent panel editing. Dashboard acts as a read-only
                            page.
                          </p>
                        </div>
                        <Switch
                          checked={ds.lockEditing ?? false}
                          onCheckedChange={(checked) =>
                            handleDisplayChange({ lockEditing: checked })
                          }
                          disabled={!canEdit}
                        />
                      </div>

                      <div className="border-t border-border" />

                      <div className="flex items-center justify-between py-2">
                        <div>
                          <Label className="text-sm">Hide toolbar</Label>
                          <p className="text-[12px] text-muted-foreground mt-0.5">
                            Hide the time range, filters, and variables bar.
                          </p>
                        </div>
                        <Switch
                          checked={ds.hideToolbar ?? false}
                          onCheckedChange={(checked) =>
                            handleDisplayChange({ hideToolbar: checked })
                          }
                          disabled={!canEdit}
                        />
                      </div>

                      <div className="flex items-center justify-between py-2">
                        <div>
                          <Label className="text-sm">Time scrubber</Label>
                          <p className="text-[12px] text-muted-foreground mt-0.5">
                            Show a mini timeline of data density below the
                            toolbar for quick time navigation.
                          </p>
                        </div>
                        <Switch
                          checked={ds.showScrubber ?? true}
                          onCheckedChange={(checked) =>
                            handleDisplayChange({ showScrubber: checked })
                          }
                          disabled={!canEdit}
                        />
                      </div>

                      <div className="flex items-center justify-between py-2">
                        <div>
                          <Label className="text-sm">Hide panel titles</Label>
                          <p className="text-[12px] text-muted-foreground mt-0.5">
                            Remove the floating title from all panels for a
                            cleaner look.
                          </p>
                        </div>
                        <Switch
                          checked={ds.hidePanelTitles ?? false}
                          onCheckedChange={(checked) =>
                            handleDisplayChange({ hidePanelTitles: checked })
                          }
                          disabled={!canEdit}
                        />
                      </div>

                      <div className="border-t border-border" />

                      <div className="flex items-center justify-between py-2">
                        <div>
                          <Label className="text-sm">Sync tooltips</Label>
                          <p className="text-[12px] text-muted-foreground mt-0.5">
                            Show a crosshair on all chart panels when hovering
                            one.
                          </p>
                        </div>
                        <Switch
                          checked={ds.syncTooltips ?? false}
                          onCheckedChange={(checked) =>
                            handleDisplayChange({ syncTooltips: checked })
                          }
                          disabled={!canEdit}
                        />
                      </div>

                      <div className="border-t border-border" />

                      <div className="flex items-center justify-between py-2">
                        <div>
                          <Label className="text-sm">Auto-refresh</Label>
                          <p className="text-[12px] text-muted-foreground mt-0.5">
                            Automatically refresh connection panels on an
                            interval.
                          </p>
                        </div>
                        <Select
                          value={String(ds.autoRefresh ?? 0)}
                          onValueChange={(v) =>
                            handleDisplayChange({ autoRefresh: Number(v) })
                          }
                          disabled={!canEdit}
                        >
                          <SelectTrigger className="w-24 h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="0" className="text-xs">
                              Off
                            </SelectItem>
                            <SelectItem value="5" className="text-xs">
                              5s
                            </SelectItem>
                            <SelectItem value="10" className="text-xs">
                              10s
                            </SelectItem>
                            <SelectItem value="30" className="text-xs">
                              30s
                            </SelectItem>
                            <SelectItem value="60" className="text-xs">
                              1m
                            </SelectItem>
                            <SelectItem value="300" className="text-xs">
                              5m
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {canEdit && (
                      <div className="mt-12 pt-8 border-t border-border">
                        <Button
                          onClick={() => setShowDeleteConfirm(true)}
                          size="sm"
                          variant="destructive"
                        >
                          Delete dashboard
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })()}

            {activeTab === "variables" && dashboard && (
              <div className="space-y-4">
                <div>
                  <SectionHeader>Dashboard Filters</SectionHeader>
                  <p className="text-[12px] text-muted-foreground mt-1">
                    Dashboard filters parameterize queries. Use{" "}
                    <code className="bg-muted px-1 rounded text-[11px]">
                      $name
                    </code>{" "}
                    in panel queries to reference them.
                  </p>
                </div>
                <VariableEditor
                  variables={
                    localVariables ??
                    ((dashboard.config as DashboardConfig).variables || [])
                  }
                  onChange={handleVariablesChange}
                  canEdit={canEdit}
                />
              </div>
            )}

            {activeTab === "sharing" && (
              <>
                {/* Share Links Section */}
                <div className="space-y-4">
                  <SectionHeader
                    action={
                      canEdit ? (
                        <Button
                          size="sm"
                          onClick={handleCreateLink}
                          disabled={isCreatingLink}
                          className="h-7 text-xs gap-1.5"
                        >
                          {isCreatingLink ? (
                            <Spinner className="h-3 w-3" />
                          ) : (
                            <Plus className="h-3 w-3" />
                          )}
                          Create Link
                        </Button>
                      ) : undefined
                    }
                  >
                    Share Links
                  </SectionHeader>
                  <Card className="p-4">
                    {shareLoading ? (
                      <div className="flex items-center justify-center py-6">
                        <Spinner />
                      </div>
                    ) : shareLinks.length > 0 ? (
                      <div className="space-y-3">
                        {shareLinks.map((link) => (
                          <div
                            key={link.id}
                            className="flex items-center gap-3 p-3 rounded-md bg-muted/50"
                          >
                            <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">
                                {link.name || "Untitled Link"}
                              </div>
                              <div className="text-xs text-muted-foreground truncate font-mono">
                                {window.location.origin}/shared/{link.token}
                              </div>
                              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <Eye className="h-3 w-3" />
                                  {link.view_count} views
                                </span>
                                {link.expires_at && (
                                  <span className="flex items-center gap-1">
                                    <Calendar className="h-3 w-3" />
                                    Expires{" "}
                                    {formatDate(link.expires_at, "short")}
                                  </span>
                                )}
                                {link.max_views && (
                                  <span>Max {link.max_views} views</span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs gap-1.5"
                                onClick={() => handleCopyLink(link.token)}
                              >
                                {copied === link.token ? (
                                  <Check className="h-3 w-3 text-green-500" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                                Copy
                              </Button>
                              {canEdit && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                                  onClick={() => revokeShareLink(link.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-6 text-muted-foreground">
                        <Link2 className="h-6 w-6 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No share links yet</p>
                        <p className="text-xs">
                          Create a link to share this dashboard publicly
                        </p>
                      </div>
                    )}
                  </Card>
                </div>

                {/* People with Access Section */}
                <div className="space-y-4">
                  <SectionHeader>People with Access</SectionHeader>
                  <Card className="p-4 space-y-4">
                    {/* Invite form */}
                    <div className="flex gap-2">
                      <Input
                        type="email"
                        placeholder="Enter email address"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="h-9 text-sm flex-1"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleInvite();
                          }
                        }}
                      />
                      <Select
                        value={accessLevel}
                        onValueChange={(v) =>
                          setAccessLevel(v as ShareLinkAccess)
                        }
                      >
                        <SelectTrigger className="w-24 h-9 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="view">Can view</SelectItem>
                          <SelectItem value="edit">Can edit</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        className="h-9 text-xs"
                        onClick={handleInvite}
                        disabled={!email.includes("@") || isInviting}
                      >
                        {isInviting ? (
                          <Spinner className="h-3.5 w-3.5" />
                        ) : (
                          "Invite"
                        )}
                      </Button>
                    </div>

                    {/* Permissions list */}
                    {shareLoading ? (
                      <div className="flex items-center justify-center py-6">
                        <Spinner />
                      </div>
                    ) : permissions.length > 0 ? (
                      <div className="space-y-2 border-t pt-4">
                        {permissions.map((permission) => (
                          <div
                            key={permission.id}
                            className="flex items-center justify-between py-2 px-3 bg-muted/50 rounded-md"
                          >
                            <div className="flex items-center gap-3">
                              <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
                                {(permission.email || "U")[0].toUpperCase()}
                              </div>
                              <div>
                                <div className="text-sm font-medium">
                                  {permission.email || "Unknown"}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {permission.accepted_at
                                    ? `Joined ${formatDate(permission.accepted_at, "short")}`
                                    : "Pending invitation"}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Select
                                value={permission.access_level}
                                onValueChange={(v) =>
                                  updatePermission(
                                    permission.id,
                                    v as ShareLinkAccess,
                                  )
                                }
                              >
                                <SelectTrigger className="w-24 h-7 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="view">Can view</SelectItem>
                                  <SelectItem value="edit">Can edit</SelectItem>
                                </SelectContent>
                              </Select>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                                onClick={() => removePermission(permission.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-6 text-muted-foreground border-t">
                        <Users className="h-6 w-6 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No one else has access yet</p>
                        <p className="text-xs">
                          Invite people to collaborate on this dashboard
                        </p>
                      </div>
                    )}
                  </Card>
                </div>
              </>
            )}

            {activeTab === "analytics" && (
              <>
                {analyticsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Spinner />
                  </div>
                ) : analytics ? (
                  <div className="space-y-6">
                    {/* Period Selector - Linear style */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1 p-0.5 bg-muted/50 rounded-lg">
                        {([7, 30, 90] as const).map((period) => (
                          <Button
                            key={period}
                            variant="ghost"
                            size="sm"
                            onClick={() => setAnalyticsPeriod(period)}
                            className={cn(
                              "px-3 py-1.5 text-xs font-medium rounded-md transition-all h-auto",
                              analyticsPeriod === period
                                ? "bg-background text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {period}d
                          </Button>
                        ))}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        vs previous {analyticsPeriod} days
                      </span>
                    </div>

                    {/* Stats Overview - Linear style cards */}
                    <div className="grid grid-cols-3 gap-3">
                      <div className="p-4 rounded-lg border bg-card">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Views
                          </span>
                          <TrendIndicator
                            value={analytics.trends?.views ?? null}
                          />
                        </div>
                        <div className="text-2xl font-semibold tabular-nums">
                          {analytics.totalViews.toLocaleString()}
                        </div>
                      </div>
                      <div className="p-4 rounded-lg border bg-card">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Unique Visitors
                          </span>
                          <TrendIndicator
                            value={analytics.trends?.viewers ?? null}
                          />
                        </div>
                        <div className="text-2xl font-semibold tabular-nums">
                          {analytics.uniqueViewers.toLocaleString()}
                        </div>
                      </div>
                      <div className="p-4 rounded-lg border bg-card">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Avg. Time
                          </span>
                          <TrendIndicator
                            value={analytics.trends?.duration ?? null}
                          />
                        </div>
                        <div className="text-2xl font-semibold tabular-nums">
                          {formatDuration(analytics.averageDuration)}
                        </div>
                      </div>
                    </div>

                    {/* Views Chart - Linear style */}
                    <div className="rounded-lg border bg-card overflow-hidden">
                      <div className="px-4 py-3 border-b">
                        <h3 className="text-sm font-medium">Views over time</h3>
                      </div>
                      <div className="p-4">
                        <div className="h-28 flex items-end gap-px">
                          {chartData.map((day) => (
                            <div
                              key={day.date}
                              className="flex-1 group relative"
                            >
                              <div
                                className={cn(
                                  "w-full rounded-t transition-colors",
                                  day.views > 0
                                    ? "bg-primary/60 group-hover:bg-primary"
                                    : "bg-muted/30",
                                )}
                                style={{
                                  height: `${Math.max(day.height, day.views > 0 ? 8 : 2)}%`,
                                }}
                              />
                              {/* Tooltip */}
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-popover border rounded shadow-lg text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                                <div className="font-medium">
                                  {day.views} views
                                </div>
                                <div className="text-muted-foreground">
                                  {formatDate(day.date, "short")}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="flex justify-between mt-3 text-xs text-muted-foreground">
                          <span>
                            {chartData[0]?.date
                              ? formatDate(chartData[0].date, "short")
                              : ""}
                          </span>
                          <span>Today</span>
                        </div>
                      </div>
                    </div>

                    {/* Two column layout for Traffic & Locations */}
                    <div className="grid grid-cols-2 gap-4">
                      {/* Traffic Sources */}
                      <div className="rounded-lg border bg-card overflow-hidden">
                        <div className="px-4 py-3 border-b">
                          <h3 className="text-sm font-medium">
                            Traffic sources
                          </h3>
                        </div>
                        <div className="p-4">
                          {analytics.viewsByReferrer &&
                          analytics.viewsByReferrer.length > 0 ? (
                            <div className="space-y-3">
                              {analytics.viewsByReferrer
                                .slice(0, 5)
                                .map((item) => {
                                  const maxViews =
                                    analytics.viewsByReferrer[0].views;
                                  const width = (item.views / maxViews) * 100;
                                  const percentage = Math.round(
                                    (item.views / analytics.totalViews) * 100,
                                  );
                                  return (
                                    <div
                                      key={item.source}
                                      className="space-y-1.5"
                                    >
                                      <div className="flex items-center justify-between text-sm">
                                        <span className="flex items-center gap-2 truncate">
                                          {item.source === "Direct" ? (
                                            <div className="w-4 h-4 rounded bg-muted flex items-center justify-center">
                                              <Minus className="h-2.5 w-2.5" />
                                            </div>
                                          ) : (
                                            <div className="w-4 h-4 rounded bg-muted flex items-center justify-center">
                                              <ExternalLink className="h-2.5 w-2.5" />
                                            </div>
                                          )}
                                          {item.source}
                                        </span>
                                        <span className="text-muted-foreground tabular-nums">
                                          {percentage}%
                                        </span>
                                      </div>
                                      <div className="h-1 bg-muted rounded-full overflow-hidden">
                                        <div
                                          className="h-full bg-primary/60 rounded-full transition-all"
                                          style={{ width: `${width}%` }}
                                        />
                                      </div>
                                    </div>
                                  );
                                })}
                            </div>
                          ) : (
                            <div className="text-center py-4 text-muted-foreground">
                              <ExternalLink className="h-5 w-5 mx-auto mb-1.5 opacity-40" />
                              <p className="text-xs">No traffic data yet</p>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Locations */}
                      <div className="rounded-lg border bg-card overflow-hidden">
                        <div className="px-4 py-3 border-b">
                          <h3 className="text-sm font-medium">Top locations</h3>
                        </div>
                        <div className="p-4">
                          {analytics.viewsByCountry.length > 0 ? (
                            <div className="space-y-3">
                              {analytics.viewsByCountry
                                .slice(0, 5)
                                .map((item) => {
                                  const maxViews =
                                    analytics.viewsByCountry[0].views;
                                  const width = (item.views / maxViews) * 100;
                                  const percentage = Math.round(
                                    (item.views / analytics.totalViews) * 100,
                                  );
                                  return (
                                    <div
                                      key={item.country}
                                      className="space-y-1.5"
                                    >
                                      <div className="flex items-center justify-between text-sm">
                                        <span className="flex items-center gap-2 truncate">
                                          <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                                          {item.country}
                                        </span>
                                        <span className="text-muted-foreground tabular-nums">
                                          {percentage}%
                                        </span>
                                      </div>
                                      <div className="h-1 bg-muted rounded-full overflow-hidden">
                                        <div
                                          className="h-full bg-primary/60 rounded-full transition-all"
                                          style={{ width: `${width}%` }}
                                        />
                                      </div>
                                    </div>
                                  );
                                })}
                            </div>
                          ) : (
                            <div className="text-center py-4 text-muted-foreground">
                              <Globe className="h-5 w-5 mx-auto mb-1.5 opacity-40" />
                              <p className="text-xs">No location data yet</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Share Link Performance */}
                    {analytics.shareLinkStats &&
                      analytics.shareLinkStats.length > 0 && (
                        <div className="rounded-lg border bg-card overflow-hidden">
                          <div className="px-4 py-3 border-b">
                            <h3 className="text-sm font-medium">
                              Share link performance
                            </h3>
                          </div>
                          <div className="divide-y">
                            {analytics.shareLinkStats.map((link) => (
                              <div
                                key={link.id}
                                className="px-4 py-3 flex items-center justify-between hover:bg-muted/30 transition-colors"
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="w-8 h-8 rounded-md bg-muted/50 flex items-center justify-center shrink-0">
                                    <Link2 className="h-4 w-4 text-muted-foreground" />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="text-sm font-medium truncate">
                                      {link.name || "Untitled link"}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {link.lastViewedAt
                                        ? `Last viewed ${formatRelativeTime(link.lastViewedAt)}`
                                        : "No views yet"}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-6 shrink-0">
                                  <div className="text-right">
                                    <div className="text-sm font-medium tabular-nums">
                                      {link.views}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      views
                                    </div>
                                  </div>
                                  <div className="text-right">
                                    <div className="text-sm font-medium tabular-nums">
                                      {link.uniqueViewers}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      visitors
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                    <div className="rounded-lg border bg-card overflow-hidden">
                      <div className="px-4 py-3 border-b">
                        <h3 className="text-sm font-medium">Recent activity</h3>
                      </div>
                      {analytics.recentViews.length > 0 ? (
                        <div className="divide-y">
                          {analytics.recentViews
                            .slice(0, 10)
                            .map((view, index) => (
                              <div
                                key={view.id}
                                className="px-4 py-3 flex items-center gap-3 hover:bg-muted/30 transition-colors"
                              >
                                <div className="relative">
                                  <div className="w-8 h-8 rounded-full bg-muted/50 flex items-center justify-center">
                                    <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                                  </div>
                                  {index < analytics.recentViews.length - 1 && (
                                    <div className="absolute top-8 left-1/2 w-px h-3 bg-border -translate-x-1/2" />
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium">
                                      {view.country || "Unknown location"}
                                    </span>
                                    {view.city && (
                                      <span className="text-xs text-muted-foreground">
                                        {view.city}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <span>
                                      {formatRelativeTime(view.startedAt)}
                                    </span>
                                    {view.duration !== null && (
                                      <>
                                        <span>·</span>
                                        <span>
                                          {formatDuration(view.duration)}
                                        </span>
                                      </>
                                    )}
                                    {view.shareLinkName && (
                                      <>
                                        <span>·</span>
                                        <span className="truncate">
                                          via {view.shareLinkName}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                </div>
                                {view.referrer && (
                                  <div className="text-xs text-muted-foreground truncate max-w-[120px]">
                                    {(() => {
                                      try {
                                        return new URL(
                                          view.referrer,
                                        ).hostname.replace(/^www\./, "");
                                      } catch {
                                        return null;
                                      }
                                    })()}
                                  </div>
                                )}
                              </div>
                            ))}
                        </div>
                      ) : (
                        <div className="px-4 py-8 text-center text-muted-foreground">
                          <Eye className="h-6 w-6 mx-auto mb-2 opacity-40" />
                          <p className="text-sm">No views yet</p>
                          <p className="text-xs mt-1">
                            Share this dashboard to see activity
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-16 text-muted-foreground">
                    <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
                      <BarChart3 className="h-6 w-6 opacity-50" />
                    </div>
                    <p className="text-sm font-medium">No analytics data yet</p>
                    <p className="text-xs mt-1 max-w-[200px] mx-auto">
                      Share this dashboard to start collecting view analytics
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      {canEdit && <SaveBar {...saveBarProps} />}

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Dashboard</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{dashboard.name}&quot;? This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
