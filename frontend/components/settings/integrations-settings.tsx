"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePermissions } from "@/hooks/use-permissions";
import Image from "next/image";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { WebhookForm } from "@/components/webhooks/webhook-form";
import { SecretDisplay } from "@/components/webhooks/secret-display";
import { WebhookEventPicker } from "@/components/webhooks/webhook-event-picker";
import { DeliveryLogViewer } from "@/components/webhooks/delivery-log-viewer";
import { WebhookTester } from "@/components/webhooks/webhook-tester";
import { EmailSetupDialog } from "@/components/webhooks/email-integration-manager";
import {
  useWebhooks,
  type CreateWebhookInput,
  type UpdateWebhookInput,
} from "@/hooks/use-webhooks";
import { useSlackIntegrations } from "@/hooks/use-slack-integrations";
import { useEmailIntegrations } from "@/hooks/use-email-integrations";
import { useMonitors, monitorTargets } from "@/hooks/use-monitors";
import { toast } from "@/lib/toast-utils";
import { cn } from "@/lib/utils";
import {
  Search,
  MoreVertical,
  Pencil,
  Trash2,
  Webhook,
  TestTube,
  History,
  Plus,
  Send,
  Mail,
  X,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { Webhook as WebhookType, WebhookEventType } from "@/lib/db/types";

// =============================================================================
// CONSTANTS
// =============================================================================

const TYPE_CHIPS = [
  { value: "all", label: "All" },
  { value: "slack", label: "Slack" },
  { value: "email", label: "Email" },
  { value: "webhook", label: "Webhook" },
] as const;

type FilterType = "all" | "slack" | "email" | "webhook";

// =============================================================================
// EXPORTS
// =============================================================================

export function IntegrationsSettings() {
  return (
    <Suspense fallback={<IntegrationsSettingsSkeleton />}>
      <IntegrationsSettingsContent />
    </Suspense>
  );
}

export function IntegrationsSettingsSkeleton() {
  return (
    <div className="flex h-full items-center justify-center p-2">
      <Spinner />
    </div>
  );
}

// =============================================================================
// MAIN CONTENT
// =============================================================================

function IntegrationsSettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // UI gating only — the routes enforce these server-side.
  const { can } = usePermissions();
  const canManageChannels = can("action-manage-integrations");
  const canManageWebhooks = can("action-edit-webhook");
  const canCreateWebhook = can("action-create-webhook");

  // View state
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [detailWebhookId, setDetailWebhookId] = useState<string | null>(null);
  const [detailMode, setDetailMode] = useState<"logs" | "test">("logs");

  // Dialog states
  const [createOpen, setCreateOpen] = useState(false);
  const [editingWebhookId, setEditingWebhookId] = useState<string | null>(null);
  const [newWebhookSecret, setNewWebhookSecret] = useState<string | null>(null);

  // Slack edit state
  const [editingSlackId, setEditingSlackId] = useState<string | null>(null);
  const [editingSlackEvents, setEditingSlackEvents] = useState<
    WebhookEventType[]
  >([]);
  const [testingSlackId, setTestingSlackId] = useState<string | null>(null);

  // Email state
  const [emailOpen, setEmailOpen] = useState(false);
  const [editingEmailId, setEditingEmailId] = useState<string | null>(null);
  const [editingEmailEvents, setEditingEmailEvents] = useState<
    WebhookEventType[]
  >([]);
  const [testingEmailId, setTestingEmailId] = useState<string | null>(null);

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<
    (typeof allIntegrations)[0] | null
  >(null);

  // Fetch all integrations
  const {
    webhooks,
    isLoading: webhooksLoading,
    createWebhook,
    updateWebhook,
    toggleWebhook,
    deleteWebhook,
  } = useWebhooks();

  const {
    integrations: slackIntegrations,
    isLoading: slackLoading,
    connect: connectSlack,
    toggleIntegration: toggleSlack,
    updateIntegration: updateSlack,
    deleteIntegration: deleteSlack,
    testIntegration: testSlack,
  } = useSlackIntegrations();

  const {
    integrations: emailIntegrations,
    isLoading: emailLoading,
    toggleIntegration: toggleEmail,
    updateIntegration: updateEmail,
    deleteIntegration: deleteEmail,
    testIntegration: testEmail,
  } = useEmailIntegrations();

  const isLoading = webhooksLoading || slackLoading || emailLoading;

  // Read-only routing summary: which monitors explicitly target each
  // integration. Editing routing stays monitor-side (/alerts/monitors).
  const { monitors } = useMonitors();
  const targetedByCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of monitors) {
      for (const id of monitorTargets(m) ?? []) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    return counts;
  }, [monitors]);

  // Handle URL params
  useEffect(() => {
    const webhookId = searchParams.get("webhook");
    const action = searchParams.get("action");

    if (webhookId) {
      // Consume the one-time deep-link params, then strip them from the URL.
      // Deferred so the state update isn't a synchronous cascade in the effect body.
      queueMicrotask(() => {
        setDetailWebhookId(webhookId);
        if (action === "logs") setDetailMode("logs");
        else if (action === "test") setDetailMode("test");
      });
      router.replace("/alerts/integrations", { scroll: false });
    }

    // Handle Slack OAuth callback
    const slackStatus = searchParams.get("slack");
    if (slackStatus === "connected") {
      const channel = searchParams.get("channel");
      const team = searchParams.get("team");
      toast.success("Slack connected", {
        description:
          channel && team
            ? `Events will be sent to #${channel} in ${team}`
            : "Your Slack channel is now connected",
      });
      router.replace("/alerts/integrations", { scroll: false });
    } else if (slackStatus === "error") {
      toast.error("Slack connection failed", {
        description: searchParams.get("message") || "Please try again",
      });
      router.replace("/alerts/integrations", { scroll: false });
    }
  }, [searchParams, router]);

  // Build unified integrations list
  const allIntegrations = useMemo(
    () => [
      ...webhooks.map((w) => ({
        id: w.id,
        type: "webhook" as const,
        name: w.name,
        description: w.description || w.url,
        enabled: w.enabled,
        events: w.events as WebhookEventType[],
        stats: {
          total: w.total_deliveries,
          success: w.successful_deliveries,
          failed: w.failed_deliveries,
        },
        lastActivity: w.last_triggered_at,
        secretPrefix: w.secretPrefix,
        url: w.url,
        raw: w,
      })),
      ...slackIntegrations.map((s) => ({
        id: s.id,
        type: "slack" as const,
        name: `#${s.channel_name}`,
        description: s.team_name,
        enabled: s.enabled,
        events: s.events,
        stats: {
          total: s.total_events,
          success: s.successful_events,
          failed: s.failed_events,
        },
        lastActivity: s.last_event_at || s.created_at,
        lastError: s.last_error,
        raw: s,
      })),
      ...emailIntegrations.map((e) => ({
        id: e.id,
        type: "email" as const,
        name: e.name,
        description: e.email_address,
        enabled: e.enabled,
        events: e.events,
        stats: {
          total: e.total_events,
          success: e.successful_events,
          failed: e.failed_events,
        },
        lastActivity: e.last_event_at,
        lastError: e.last_error,
        raw: e,
      })),
    ],
    [webhooks, slackIntegrations, emailIntegrations],
  );

  // Filter integrations
  const filteredIntegrations = useMemo(() => {
    let result = allIntegrations;

    if (filterType !== "all") {
      result = result.filter((i) => i.type === filterType);
    }

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.description?.toLowerCase().includes(q) ||
          i.type.toLowerCase().includes(q),
      );
    }

    return result;
  }, [allIntegrations, filterType, search]);

  // Handlers
  const handleCreate = async (
    data: CreateWebhookInput | UpdateWebhookInput,
  ) => {
    const result = await createWebhook(data as CreateWebhookInput);
    setCreateOpen(false);
    setNewWebhookSecret((result.webhook as WebhookType).secret);
  };

  const handleToggle = async (
    integration: (typeof allIntegrations)[0],
    enabled: boolean,
  ) => {
    if (integration.type === "webhook") {
      await toggleWebhook(integration.id, enabled);
    } else if (integration.type === "slack") {
      await toggleSlack(integration.id, enabled);
    } else if (integration.type === "email") {
      await toggleEmail(integration.id, enabled);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === "webhook") {
      await deleteWebhook(deleteTarget.id);
    } else if (deleteTarget.type === "slack") {
      await deleteSlack(deleteTarget.id);
    } else if (deleteTarget.type === "email") {
      await deleteEmail(deleteTarget.id);
    }
    setDeleteTarget(null);
  };

  const handleConnectSlack = async () => {
    try {
      const url = await connectSlack();
      window.location.href = url;
    } catch (error) {
      toast.error("Failed to connect Slack", {
        description:
          error instanceof Error ? error.message : "Please try again",
      });
    }
  };

  const handleTestSlack = async (id: string, channelName: string) => {
    setTestingSlackId(id);
    try {
      const result = await testSlack(id);
      if (result.success) {
        toast.success(`Test sent to ${channelName}`, {
          description: `Response time: ${result.responseTimeMs}ms`,
        });
      } else {
        toast.error("Test failed", { description: result.error });
      }
    } catch (error) {
      toast.error("Test failed", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setTestingSlackId(null);
    }
  };

  const handleSaveSlackEvents = async () => {
    if (!editingSlackId) return;
    await updateSlack(editingSlackId, { events: editingSlackEvents });
    setEditingSlackId(null);
  };

  const handleTestEmail = async (id: string, emailAddress: string) => {
    setTestingEmailId(id);
    try {
      const result = await testEmail(id);
      if (result.success) {
        toast.success(`Test sent to ${emailAddress}`, {
          description: `Response time: ${result.responseTimeMs}ms`,
        });
      } else {
        toast.error("Test failed", { description: result.error });
      }
    } catch (error) {
      toast.error("Test failed", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setTestingEmailId(null);
    }
  };

  const handleSaveEmailEvents = async () => {
    if (!editingEmailId) return;
    await updateEmail(editingEmailId, { events: editingEmailEvents });
    setEditingEmailId(null);
  };

  return (
    <>
      <div className="flex flex-col h-full">
        <div className="flex-1 flex flex-col overflow-hidden p-2">
          {/* Secret banner */}
          {newWebhookSecret && (
            <Card className="border-amber-500/50 bg-amber-500/5 mb-2">
              <div className="p-3">
                <SecretDisplay secret={newWebhookSecret} />
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => setNewWebhookSecret(null)}
                >
                  I&apos;ve saved the secret
                </Button>
              </div>
            </Card>
          )}

          {/* Filter Bar */}
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  placeholder="Search..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-7 h-8 w-48"
                />
              </div>

              <div className="w-px h-5 bg-border" />

              {/* Type Chips */}
              {TYPE_CHIPS.map((chip) => {
                const active = filterType === chip.value;
                return (
                  <Button
                    key={chip.value}
                    variant={active ? "default" : "outline"}
                    size="sm"
                    onClick={() => setFilterType(chip.value as FilterType)}
                    className={cn(
                      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] h-auto",
                      active
                        ? "bg-foreground text-background border-foreground hover:bg-foreground/90"
                        : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/50",
                    )}
                  >
                    {chip.label}
                  </Button>
                );
              })}

              {/* Count */}
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {filteredIntegrations.length} integration
                {filteredIntegrations.length !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Add dropdown */}
            {(canManageChannels || canCreateWebhook) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm">
                    <Plus className="h-3 w-3 mr-1.5" />
                    Add
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canManageChannels && (
                    <>
                      <DropdownMenuItem onClick={handleConnectSlack}>
                        <Image
                          src="/slack.png"
                          alt=""
                          width={16}
                          height={16}
                          className="h-4 w-4 mr-2"
                        />
                        Slack
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setEmailOpen(true)}>
                        <Mail className="h-4 w-4 mr-2" />
                        Email
                      </DropdownMenuItem>
                    </>
                  )}
                  {canManageChannels && canCreateWebhook && (
                    <DropdownMenuSeparator />
                  )}
                  {canCreateWebhook && (
                    <DropdownMenuItem onClick={() => setCreateOpen(true)}>
                      <Webhook className="h-4 w-4 mr-2" />
                      Custom Webhook
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {/* Table */}
          <div className="flex flex-1 gap-0 overflow-hidden relative">
            <Card className="flex-1 overflow-hidden">
              <div className="h-full overflow-auto">
                {isLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <Spinner className="h-5 w-5 text-muted-foreground" />
                  </div>
                ) : filteredIntegrations.length === 0 ? (
                  <EmptyState
                    icon={Webhook}
                    title={
                      search || filterType !== "all"
                        ? "No matches"
                        : "No integrations"
                    }
                    description={
                      search || filterType !== "all"
                        ? "Try adjusting your search or filters"
                        : "Connect Slack, Email, or create a custom webhook"
                    }
                    className="h-full"
                  />
                ) : (
                  <Table className="w-full">
                    <TableHeader className="bg-muted/50 sticky top-0 z-10">
                      <TableRow>
                        <TableHead className="text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-3 py-2 w-12">
                          On
                        </TableHead>
                        <TableHead className="text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-3 py-2">
                          Integration
                        </TableHead>
                        <TableHead className="text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-3 py-2">
                          Type
                        </TableHead>
                        <TableHead className="text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-3 py-2">
                          Deliveries
                        </TableHead>
                        <TableHead className="text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-3 py-2">
                          Last Active
                        </TableHead>
                        <TableHead className="text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-3 py-2 w-12" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredIntegrations.map((integration) => (
                        <TableRow
                          key={`${integration.type}-${integration.id}`}
                          className="border-b border-border/50 transition-colors hover:bg-muted/50"
                        >
                          {/* Toggle */}
                          <TableCell className="px-3 py-2.5">
                            <Switch
                              checked={integration.enabled}
                              onCheckedChange={(enabled) =>
                                handleToggle(integration, enabled)
                              }
                            />
                          </TableCell>

                          {/* Integration name + description */}
                          <TableCell className="px-3 py-2.5">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div
                                className={cn(
                                  "w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0",
                                  (integration.type === "webhook" ||
                                    integration.type === "email") &&
                                    "bg-primary/10",
                                )}
                              >
                                {integration.type === "slack" && (
                                  <Image
                                    src="/slack.png"
                                    alt="Slack"
                                    width={20}
                                    height={20}
                                    className="h-5 w-5"
                                  />
                                )}
                                {integration.type === "email" && (
                                  <Mail className="h-3.5 w-3.5 text-primary" />
                                )}
                                {integration.type === "webhook" && (
                                  <Webhook className="h-3.5 w-3.5 text-primary" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-sm font-medium truncate">
                                    {integration.name}
                                  </span>
                                  {!integration.enabled && (
                                    <Badge
                                      variant="secondary"
                                      className="text-[10px] px-1 py-0"
                                    >
                                      Off
                                    </Badge>
                                  )}
                                </div>
                                <div className="text-[10px] text-muted-foreground truncate max-w-[240px]">
                                  {integration.description}
                                </div>
                                {(targetedByCount.get(integration.id) ?? 0) >
                                  0 && (
                                  <Link
                                    href="/alerts/monitors"
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                                  >
                                    Targeted by{" "}
                                    {targetedByCount.get(integration.id)}{" "}
                                    monitor
                                    {targetedByCount.get(integration.id) === 1
                                      ? ""
                                      : "s"}
                                  </Link>
                                )}
                              </div>
                            </div>
                          </TableCell>

                          {/* Type */}
                          <TableCell className="px-3 py-2.5">
                            <Badge
                              variant="outline"
                              className="text-[10px] capitalize"
                            >
                              {integration.type}
                            </Badge>
                          </TableCell>

                          {/* Stats */}
                          <TableCell className="px-3 py-2.5">
                            {integration.stats ? (
                              <span className="text-xs text-muted-foreground tabular-nums">
                                <span className="text-foreground">
                                  {integration.stats.success}
                                </span>
                                /{integration.stats.total}
                              </span>
                            ) : (
                              <span className="text-[10px] text-muted-foreground">
                                —
                              </span>
                            )}
                          </TableCell>

                          {/* Last active */}
                          <TableCell className="px-3 py-2.5">
                            {integration.lastActivity ? (
                              <span className="text-[10px] text-muted-foreground">
                                {formatDistanceToNow(
                                  new Date(integration.lastActivity),
                                  { addSuffix: true },
                                )}
                              </span>
                            ) : (
                              <span className="text-[10px] text-muted-foreground">
                                —
                              </span>
                            )}
                          </TableCell>

                          {/* Actions */}
                          <TableCell className="px-3 py-2.5">
                            {(integration.type === "webhook"
                              ? canManageWebhooks
                              : canManageChannels) && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                >
                                  <MoreVertical className="h-3.5 w-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {integration.type === "webhook" && (
                                  <>
                                    <DropdownMenuItem
                                      onClick={() => {
                                        setDetailWebhookId(integration.id);
                                        setDetailMode("test");
                                      }}
                                    >
                                      <TestTube className="h-4 w-4 mr-2" />
                                      Test
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => {
                                        setDetailWebhookId(integration.id);
                                        setDetailMode("logs");
                                      }}
                                    >
                                      <History className="h-4 w-4 mr-2" />
                                      View Logs
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() =>
                                        setEditingWebhookId(integration.id)
                                      }
                                    >
                                      <Pencil className="h-4 w-4 mr-2" />
                                      Edit
                                    </DropdownMenuItem>
                                  </>
                                )}
                                {integration.type === "slack" && (
                                  <>
                                    <DropdownMenuItem
                                      onClick={() =>
                                        handleTestSlack(
                                          integration.id,
                                          integration.name,
                                        )
                                      }
                                      disabled={
                                        testingSlackId === integration.id
                                      }
                                    >
                                      <Send className="h-4 w-4 mr-2" />
                                      {testingSlackId === integration.id
                                        ? "Sending..."
                                        : "Send Test"}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => {
                                        setEditingSlackId(integration.id);
                                        setEditingSlackEvents(
                                          integration.events,
                                        );
                                      }}
                                    >
                                      Configure Events
                                    </DropdownMenuItem>
                                  </>
                                )}
                                {integration.type === "email" && (
                                  <>
                                    <DropdownMenuItem
                                      onClick={() =>
                                        handleTestEmail(
                                          integration.id,
                                          integration.description || "",
                                        )
                                      }
                                      disabled={
                                        testingEmailId === integration.id
                                      }
                                    >
                                      <Send className="h-4 w-4 mr-2" />
                                      {testingEmailId === integration.id
                                        ? "Sending..."
                                        : "Send Test"}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => {
                                        setEditingEmailId(integration.id);
                                        setEditingEmailEvents(
                                          integration.events,
                                        );
                                      }}
                                    >
                                      Configure Events
                                    </DropdownMenuItem>
                                  </>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => setDeleteTarget(integration)}
                                  className="text-destructive"
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  {integration.type === "slack"
                                    ? "Disconnect"
                                    : "Delete"}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </Card>

            {/* Detail Panel (Webhook Logs / Test) */}
            <AnimatePresence mode="wait">
              {detailWebhookId && (
                <>
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="fixed inset-0 bg-black/50 z-40"
                    onClick={() => setDetailWebhookId(null)}
                  />
                  <motion.div
                    initial={{ opacity: 0, x: 40 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 40 }}
                    transition={{ type: "spring", damping: 25, stiffness: 300 }}
                    className="fixed right-0 top-0 bottom-0 w-[720px] bg-background border-l flex flex-col z-50"
                  >
                    {/* Header */}
                    <div className="flex-shrink-0 border-b">
                      <div className="flex items-center justify-between p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                            {detailMode === "logs" ? (
                              <History className="h-5 w-5 text-primary" />
                            ) : (
                              <TestTube className="h-5 w-5 text-primary" />
                            )}
                          </div>
                          <div>
                            <h2 className="font-semibold">
                              {detailMode === "logs"
                                ? "Delivery Logs"
                                : "Test Webhook"}
                            </h2>
                            <div className="text-[10px] text-muted-foreground">
                              {
                                webhooks.find((w) => w.id === detailWebhookId)
                                  ?.name
                              }
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant={
                              detailMode === "logs" ? "default" : "ghost"
                            }
                            size="sm"
                            className="text-xs h-7"
                            onClick={() => setDetailMode("logs")}
                          >
                            Logs
                          </Button>
                          <Button
                            variant={
                              detailMode === "test" ? "default" : "ghost"
                            }
                            size="sm"
                            className="text-xs h-7"
                            onClick={() => setDetailMode("test")}
                          >
                            Test
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="rounded-full h-8 w-8 ml-2"
                            onClick={() => setDetailWebhookId(null)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-4">
                      {detailMode === "logs" ? (
                        <DeliveryLogViewer webhookId={detailWebhookId} />
                      ) : (
                        <div className="max-w-md">
                          <WebhookTester webhookId={detailWebhookId} />
                        </div>
                      )}
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Create Webhook Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Webhook</DialogTitle>
            <DialogDescription>
              Configure a webhook endpoint to receive event notifications
            </DialogDescription>
          </DialogHeader>
          <WebhookForm
            onSubmit={handleCreate}
            onCancel={() => setCreateOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Edit Webhook Dialog */}
      <Dialog
        open={!!editingWebhookId}
        onOpenChange={(open) => !open && setEditingWebhookId(null)}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Webhook</DialogTitle>
            <DialogDescription>Update webhook configuration</DialogDescription>
          </DialogHeader>
          {editingWebhookId && (
            <WebhookForm
              initialValues={webhooks.find((w) => w.id === editingWebhookId)}
              onSubmit={async (data) => {
                await updateWebhook(editingWebhookId, data);
                setEditingWebhookId(null);
              }}
              onCancel={() => setEditingWebhookId(null)}
              isEditing
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Slack Events Dialog */}
      <Dialog
        open={!!editingSlackId}
        onOpenChange={(open) => !open && setEditingSlackId(null)}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Configure Events</DialogTitle>
            <DialogDescription>
              Choose which events to send to this Slack channel
            </DialogDescription>
          </DialogHeader>
          <div className="border rounded-lg p-4 max-h-64 overflow-y-auto">
            <WebhookEventPicker
              value={editingSlackEvents}
              onChange={setEditingSlackEvents}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditingSlackId(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveSlackEvents}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Email Setup Dialog */}
      <EmailSetupDialog open={emailOpen} onOpenChange={setEmailOpen} />

      {/* Edit Email Events Dialog */}
      <Dialog
        open={!!editingEmailId}
        onOpenChange={(open) => !open && setEditingEmailId(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Configure Events</DialogTitle>
            <DialogDescription>
              Choose which events to send to this email address
            </DialogDescription>
          </DialogHeader>
          <div className="border rounded-lg p-4 max-h-64 overflow-y-auto">
            <WebhookEventPicker
              value={editingEmailEvents}
              onChange={setEditingEmailEvents}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditingEmailId(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEmailEvents}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete/Disconnect Confirmation */}
      <ConfirmActionDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={
          deleteTarget?.type === "slack"
            ? `Disconnect ${deleteTarget.name}?`
            : `Delete ${deleteTarget?.name ?? "integration"}?`
        }
        description={
          deleteTarget?.type === "slack"
            ? `This will disconnect ${deleteTarget.name} from receiving events.`
            : `Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`
        }
        confirmLabel={deleteTarget?.type === "slack" ? "Disconnect" : "Delete"}
        onConfirm={handleDeleteConfirm}
      />
    </>
  );
}
