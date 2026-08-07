"use client";

import { useState, useEffect, useCallback, use, useRef, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageWrapper } from "@/components/ui/page-wrapper";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { DashboardGrid } from "@/components/dashboard/dashboard-grid";
import { AddPanelModal } from "@/components/dashboard/add-panel-modal";
import { EmptyDashboardState } from "@/components/dashboard/empty-dashboard-state";
import { PanelEditSidebar } from "@/components/dashboard/panel-edit-sidebar";
import { TelemetryProvider } from "@/components/dashboard/telemetry-provider";
import { DashboardInteractionProvider } from "@/components/dashboard/dashboard-interaction-context";
import { DashboardStateProvider } from "@/components/dashboard/dashboard-state-context";
import { DashboardToolbar } from "@/components/dashboard/dashboard-toolbar";
import { RunComparePicker } from "@/components/dashboard/run-compare-picker";
import { MiniScrubber } from "@/components/dashboard/mini-scrubber";
import { DashboardBreadcrumb } from "@/components/dashboard/dashboard-breadcrumb";
import { IconPicker, DashboardIcon } from "@/components/dashboard/icon-picker";
import { useDashboard } from "@/hooks/use-dashboards";
import { useRole } from "@/hooks/use-role";
import { useHotkeys } from "@/hooks/use-hotkeys";
import type {
  DashboardConfig,
  Panel,
  TimeRange,
  DataFilter,
  DashboardVariable,
} from "@/lib/types/dashboard";
import { parseRelativeTime } from "@/lib/types/dashboard";
import { isConnectionSource } from "@/lib/types/dashboard";
import { toast } from "@/lib/toast-utils";
import { LayoutDashboard, Check, AlertCircle, Settings } from "lucide-react";
import Link from "next/link";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ACTION_ADD_PANEL } from "@/lib/shortcuts";
import { SaveBar } from "@/components/ui/save-bar";
import { useSaveBar } from "@/hooks/use-save-bar";
import { CreateButton } from "@/components/ui/create-button";

const EMPTY_VARIABLES: DashboardVariable[] = [];
const EMPTY_FILTERS: DataFilter[] = [];

interface DashboardPageProps {
  params: Promise<{ id: string }>;
}

export default function DashboardPage({ params }: DashboardPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  // Replay-mode params: ?t=<ISO>[&window=<10m|30s|2h>] freezes the dashboard
  // at an absolute window centered on `t`. Used for deterministic recording
  // and any shared link that needs to pin to a specific moment in time.
  const tParam = searchParams.get("t");
  const windowParam = searchParams.get("window");
  const { dashboard, isLoading, error, updateDashboard } = useDashboard(id);

  const [showAddPanel, setShowAddPanel] = useState(false);
  const [, setEditingName] = useState(false);
  const [, setNameInput] = useState("");
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);

  const [localConfig, setLocalConfig] = useState<DashboardConfig | null>(null);
  const { canEdit: roleCanEdit } = useRole();
  const displaySettings = localConfig?.displaySettings;
  const canEdit = roleCanEdit && !displaySettings?.lockEditing;

  const initializedIdRef = useRef<string | null>(null);
  const localConfigRef = useRef<DashboardConfig | null>(null);

  const {
    saveStatus,
    markDirty,
    reset: resetSaveBar,
    saveBarProps,
    leaveConfirm,
  } = useSaveBar({
    onSave: async () => {
      if (!localConfigRef.current) return;
      await updateDashboard({ config: localConfigRef.current });
    },
    onDiscard: () => {
      if (dashboard?.config) {
        setLocalConfig(dashboard.config);
        localConfigRef.current = dashboard.config;
      }
    },
    currentPath: `/dashboards/${id}`,
    enabled: canEdit,
    successMessage: "Dashboard saved",
    errorMessage: "Failed to save dashboard",
  });

  // Get selected panel from config
  const selectedPanel =
    localConfig?.panels.find((p) => p.id === selectedPanelId) || null;

  // Keep the last non-null panel so its content stays visible during the close
  // animation. This is read during render, so it lives in state (not a ref),
  // updated via the render-phase "adjust state on prop change" pattern.
  const [lastPanel, setLastPanel] = useState<Panel | null>(null);
  if (selectedPanel && selectedPanel !== lastPanel) {
    setLastPanel(selectedPanel);
  }

  // Reset local state when navigating between dashboards. Done in the render
  // phase (tracking the previous id) rather than an effect, so the resets don't
  // trigger a cascading post-commit render.
  const [prevDashboardId, setPrevDashboardId] = useState(id);
  if (id !== prevDashboardId) {
    setPrevDashboardId(id);
    setSelectedPanelId(null);
    setShowAddPanel(false);
    setEditingName(false);
    setLastPanel(null);
    resetSaveBar();
  }

  // Initialize local config when dashboard loads — only once per dashboard ID
  useEffect(() => {
    if (dashboard?.config && initializedIdRef.current !== id) {
      let cfg = dashboard.config;
      // ?t=<ISO>[&window=<10m>] override → freeze to an absolute window
      // centered on the moment. Refresh is disabled so the view doesn't drift.
      if (tParam) {
        const center = new Date(tParam);
        if (!isNaN(center.getTime())) {
          const ms = parseRelativeTime(windowParam || "10m");
          const start = new Date(center.getTime() - ms / 2);
          const end = new Date(center.getTime() + ms / 2);
          cfg = {
            ...cfg,
            timeRange: {
              type: "absolute",
              value: `${start.toISOString()}/${end.toISOString()}`,
            },
            refreshInterval: 0,
          };
        }
      }
      setLocalConfig(cfg);
      localConfigRef.current = cfg;
      setNameInput(dashboard.name);
      initializedIdRef.current = id;
    }
  }, [dashboard, id, tParam, windowParam]);

  const handleConfigChange = useCallback(
    (config: DashboardConfig) => {
      setLocalConfig(config);
      localConfigRef.current = config;
      markDirty();
    },
    [markDirty],
  );


  const handleAddPanel = useCallback(
    (panel: Panel) => {
      setLocalConfig((prev) => {
        if (!prev) return prev;
        const next = { ...prev, panels: [...prev.panels, panel] };
        localConfigRef.current = next;
        markDirty();
        return next;
      });
      setShowAddPanel(false);
      setSelectedPanelId(panel.id);
    },
    [markDirty],
  );

  const handleTimeRangeChange = useCallback(
    (timeRange: TimeRange) => {
      setLocalConfig((prev) => {
        if (!prev) return prev;
        const next = { ...prev, timeRange };
        localConfigRef.current = next;
        markDirty();
        return next;
      });
    },
    [markDirty],
  );

  const handleRefreshIntervalChange = useCallback(
    (refreshInterval: number) => {
      setLocalConfig((prev) => {
        if (!prev) return prev;
        const next = { ...prev, refreshInterval };
        localConfigRef.current = next;
        markDirty();
        return next;
      });
    },
    [markDirty],
  );

  const handleFiltersChange = useCallback(
    (filters: DataFilter[]) => {
      setLocalConfig((prev) => {
        if (!prev) return prev;
        const next = { ...prev, filters };
        localConfigRef.current = next;
        markDirty();
        return next;
      });
    },
    [markDirty],
  );

  const handleVariableChange = useCallback(
    (name: string, value: string) => {
      setLocalConfig((prev) => {
        if (!prev) return prev;
        const vars = [...(prev.variables || [])];
        const idx = vars.findIndex((v) => v.name === name);
        if (idx < 0) return prev;
        vars[idx] = { ...vars[idx], current: value };
        const next = { ...prev, variables: vars };
        localConfigRef.current = next;
        markDirty();
        return next;
      });
    },
    [markDirty],
  );

  // Compute available fields from all panel metrics + connection columns
  const availableFilterFields = useMemo(() => {
    if (!localConfig) return [];
    const fields = new Set<string>();
    for (const panel of localConfig.panels) {
      // Realtime metrics
      for (const metric of panel.metrics || []) {
        fields.add(metric);
      }
      // Connection columns
      if (
        isConnectionSource(panel.dataSource) &&
        panel.dataSource.selectedColumns
      ) {
        for (const col of panel.dataSource.selectedColumns) {
          fields.add(col);
        }
      }
    }
    return Array.from(fields);
  }, [localConfig]);

  const handlePanelSelect = useCallback((panelId: string) => {
    setSelectedPanelId(panelId);
  }, []);

  const handlePanelDeselect = useCallback(() => {
    setSelectedPanelId(null);
  }, []);

  const handlePanelUpdate = useCallback(
    (updates: Partial<Panel>) => {
      setLocalConfig((prev) => {
        if (!prev || !selectedPanelId) return prev;
        const updatedPanels = prev.panels.map((p) =>
          p.id === selectedPanelId ? { ...p, ...updates } : p,
        );
        const next = { ...prev, panels: updatedPanels };
        localConfigRef.current = next;
        markDirty();
        return next;
      });
    },
    [selectedPanelId, markDirty],
  );

  const handlePanelDelete = useCallback(() => {
    setLocalConfig((prev) => {
      if (!prev || !selectedPanelId) return prev;
      const updatedPanels = prev.panels.filter((p) => p.id !== selectedPanelId);
      const next = { ...prev, panels: updatedPanels };
      localConfigRef.current = next;
      markDirty();
      return next;
    });
    setSelectedPanelId(null);
    toast.success("Panel deleted");
  }, [selectedPanelId, markDirty]);

  // Handle icon change
  const handleIconChange = useCallback(
    async (icon: string | null) => {
      try {
        await updateDashboard({ icon: icon ?? undefined });
      } catch {
        // Error handled by hook
      }
    },
    [updateDashboard],
  );

  // Persist the chosen library image (or null to clear) onto this dashboard.
  const handleUploadChange = useCallback(
    async (iconUrl: string | null) => {
      try {
        await updateDashboard({ icon_url: iconUrl });
      } catch {
        // Error handled by hook
      }
    },
    [updateDashboard],
  );

  // Navigate to next/prev panel
  const navigatePanel = useCallback((direction: "next" | "prev") => {
    const panels = localConfigRef.current?.panels;
    if (!panels?.length) return;

    setSelectedPanelId((currentId) => {
      const currentIndex = currentId
        ? panels.findIndex((p) => p.id === currentId)
        : -1;

      let nextIndex: number;
      if (direction === "next") {
        nextIndex = currentIndex < panels.length - 1 ? currentIndex + 1 : 0;
      } else {
        nextIndex = currentIndex > 0 ? currentIndex - 1 : panels.length - 1;
      }

      return panels[nextIndex].id;
    });
  }, []);

  // Handle Enter on dashboard panel - navigate to it
  const handlePanelEnter = useCallback(() => {
    if (!selectedPanelId) return;
    const panels = localConfigRef.current?.panels;
    if (!panels) return;

    const panel = panels.find((p) => p.id === selectedPanelId);
    if (panel?.type === "dashboard" && panel.config.dashboardId) {
      router.push(`/dashboards/${panel.config.dashboardId}`);
    }
  }, [selectedPanelId, router]);

  useHotkeys(
    [
      {
        key: ACTION_ADD_PANEL,
        description: "Add panel",
        category: "action",
        callback: () => setShowAddPanel(true),
      },
      {
        key: "escape",
        description: "Deselect panel / Close sidebar",
        category: "action",
        callback: () => {
          if (showAddPanel) {
            setShowAddPanel(false);
          } else if (selectedPanelId) {
            setSelectedPanelId(null);
          }
        },
        enabled: () => showAddPanel || !!selectedPanelId,
      },
      {
        key: "backspace",
        description: "Delete selected panel",
        category: "action",
        callback: handlePanelDelete,
        enabled: () => canEdit && !!selectedPanelId,
      },
      {
        key: "j",
        description: "Select next panel",
        category: "navigation",
        callback: () => navigatePanel("next"),
        enabled: () =>
          !showAddPanel && (localConfigRef.current?.panels.length ?? 0) > 0,
      },
      {
        key: "k",
        description: "Select previous panel",
        category: "navigation",
        callback: () => navigatePanel("prev"),
        enabled: () =>
          !showAddPanel && (localConfigRef.current?.panels.length ?? 0) > 0,
      },
      {
        key: "ArrowDown",
        description: "Select next panel",
        category: "navigation",
        callback: () => navigatePanel("next"),
        enabled: () =>
          !showAddPanel && (localConfigRef.current?.panels.length ?? 0) > 0,
      },
      {
        key: "ArrowUp",
        description: "Select previous panel",
        category: "navigation",
        callback: () => navigatePanel("prev"),
        enabled: () =>
          !showAddPanel && (localConfigRef.current?.panels.length ?? 0) > 0,
      },
      // Enter to drill into dashboard panel
      {
        key: "Enter",
        description: "Open dashboard panel",
        category: "action",
        callback: handlePanelEnter,
        enabled: () => {
          const panels = localConfigRef.current?.panels;
          if (!selectedPanelId || !panels) return false;
          const panel = panels.find((p) => p.id === selectedPanelId);
          return panel?.type === "dashboard" && !!panel.config.dashboardId;
        },
      },
    ],
    [
      showAddPanel,
      selectedPanelId,
      saveStatus,
      handlePanelDelete,
      navigatePanel,
      handlePanelEnter,
    ],
  );

  if (error) {
    return (
      <PageWrapper title="Dashboard">
        <EmptyState
          icon={LayoutDashboard}
          title="Dashboard not found"
          description="The dashboard you're looking for doesn't exist or was deleted"
          className="h-full"
        />
      </PageWrapper>
    );
  }

  const config = localConfig || dashboard?.config || null;

  const titleContent = (
    <div className="flex flex-col gap-0.5">
      {dashboard && dashboard?.parent_id ? (
        <DashboardBreadcrumb dashboard={dashboard} />
      ) : null}
      {!dashboard?.parent_id && dashboard ? (
        <div className="flex items-center gap-1">
          {canEdit ? (
            <IconPicker
              value={dashboard?.icon || ""}
              onChange={handleIconChange}
              size="sm"
              iconUrl={dashboard?.icon_url}
              onUploadChange={handleUploadChange}
            />
          ) : (
            <DashboardIcon
              icon={dashboard?.icon}
              iconUrl={dashboard?.icon_url}
              size="sm"
            />
          )}
          <span className="text-xs font-medium text-foreground">
            {dashboard?.name || ""}
          </span>
        </div>
      ) : null}
    </div>
  );

  // Save status indicator (brief inline for saved/error states only)
  const saveStatusIndicator = (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {saveStatus === "saved" && (
        <>
          <Check className="h-3 w-3 text-green-500" />
          <span>Saved</span>
        </>
      )}
      {saveStatus === "error" && (
        <>
          <AlertCircle className="h-3 w-3 text-destructive" />
          <span>Error</span>
        </>
      )}
    </div>
  );

  const toolbarRow =
    config && !displaySettings?.hideToolbar ? (
      <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-b border-border relative">
        <div className="flex items-center gap-2">
          <DashboardToolbar
            timeRange={config.timeRange}
            onTimeRangeChange={handleTimeRangeChange}
            refreshInterval={config.refreshInterval || 0}
            onRefreshIntervalChange={handleRefreshIntervalChange}
            filters={config.filters || []}
            onFiltersChange={handleFiltersChange}
            availableFields={availableFilterFields}
          />
          {canEdit &&
            (saveStatus === "saved" || saveStatus === "error") &&
            saveStatusIndicator}
        </div>
        <div className="flex items-center gap-1">
          {config.panels.length > 0 && (
            <RunComparePicker timeRange={config.timeRange} />
          )}
          {canEdit ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label="Dashboard settings"
                asChild
              >
                <Link href={`/dashboards/${id}/settings`}>
                  <Settings className="h-4 w-4" />
                </Link>
              </Button>
              <CreateButton
                label="Add Panel"
                onClick={() => setShowAddPanel(true)}
                shortcut={ACTION_ADD_PANEL}
              />
            </>
          ) : null}
        </div>
      </div>
    ) : null;
  if (isLoading || !config || !dashboard) {
    return (
      <PageWrapper title={titleContent}>
        <div className="flex items-center justify-center h-full py-12">
          <Spinner />
        </div>
      </PageWrapper>
    );
  }

  const mainContent = (
    <>
      {toolbarRow}
      {config.panels.length > 0 && displaySettings?.showScrubber !== false ? (
        <MiniScrubber
          panels={config.panels}
          timeRange={config.timeRange}
          onTimeRangeChange={handleTimeRangeChange}
        />
      ) : null}
      <div className="flex">
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 p-1">
            {config.panels.length === 0 ? (
              <EmptyDashboardState onAddPanel={() => setShowAddPanel(true)} />
            ) : (
              <DashboardGrid
                config={config}
                onConfigChange={handleConfigChange}
                isEditing={canEdit}
                onPanelSelect={canEdit ? handlePanelSelect : undefined}
                selectedPanelId={canEdit ? selectedPanelId : null}
              />
            )}
          </div>

          <div
            className={`overflow-hidden transition-all duration-100 ease-out ${
              selectedPanel ? "w-[400px]" : "w-0"
            }`}
            onTransitionEnd={() => {
              if (!selectedPanel) setLastPanel(null);
            }}
          >
            {selectedPanel || lastPanel ? (
              <PanelEditSidebar
                panel={(selectedPanel || lastPanel)!}
                onClose={handlePanelDeselect}
                onUpdate={handlePanelUpdate}
                onDelete={handlePanelDelete}
                timeRange={config.timeRange}
              />
            ) : null}
          </div>
        </div>
      </div>

      <AddPanelModal
        open={showAddPanel}
        onClose={() => setShowAddPanel(false)}
        onAdd={handleAddPanel}
        existingPanelCount={config.panels.length}
        currentDashboardId={id}
        timeRange={config.timeRange}
      />

      {canEdit && <SaveBar {...saveBarProps} />}

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
    </>
  );

  return (
    <PageWrapper title={titleContent}>
      {config.panels.length === 0 ? (
        mainContent
      ) : (
        <TelemetryProvider
          key={id}
          timeRange={config.timeRange}
          refreshInterval={config.refreshInterval || 0}
        >
          <DashboardStateProvider
            filters={config.filters || EMPTY_FILTERS}
            variables={config.variables || EMPTY_VARIABLES}
            refreshInterval={config.refreshInterval || 0}
            onVariableChange={handleVariableChange}
          >
            <DashboardInteractionProvider
              currentTimeRange={config.timeRange}
              onTimeRangeChange={handleTimeRangeChange}
              syncTooltips={config.displaySettings?.syncTooltips}
            >
              {mainContent}
            </DashboardInteractionProvider>
          </DashboardStateProvider>
        </TelemetryProvider>
      )}
    </PageWrapper>
  );
}
