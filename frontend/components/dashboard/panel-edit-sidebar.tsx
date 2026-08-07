"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DataSection,
  QuerySection,
  ProcessingSection,
  DisplaySection,
  SettingsSection,
} from "./panel-form";
import {
  useDashboardFilters,
  useDashboardVariables,
} from "./dashboard-state-context";
import type {
  Panel,
  PanelType,
  PanelConfig,
  DataSource,
  TimeRange,
} from "@/lib/types/dashboard";
import {
  isConnectionSource,
  type ConnectionDataSource,
} from "@/lib/types/dashboard";
import { X, Trash2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { getPanelsByCategory, getPanelDefinition } from "@/lib/panels/registry";
import { usePanelData } from "@/hooks/use-panel-data";

interface PanelEditSidebarProps {
  panel: Panel | null;
  onClose: () => void;
  onUpdate: (updates: Partial<Panel>) => void;
  onDelete?: () => void;
  timeRange?: TimeRange;
}

const PANEL_CATEGORIES = getPanelsByCategory();

const CHART_TYPES_WITH_AGGREGATION: PanelType[] = [
  "line",
  "area",
  "bar",
  "scatter",
  "heatmap",
];

export function PanelEditSidebar({
  panel,
  onClose,
  onUpdate,
  onDelete,
  timeRange,
}: PanelEditSidebarProps) {
  const [title, setTitle] = useState("");
  const [panelType, setPanelType] = useState<PanelType>("line");
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>([]);
  const [dataSource, setDataSource] = useState<DataSource>({
    type: "realtime",
  });
  const [config, setConfig] = useState<PanelConfig>({});
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const { filters: dashboardFilters } = useDashboardFilters();
  const { values: variableValues } = useDashboardVariables();

  // Live series keys for the color UI — reflects the in-progress edit (incl.
  // breakdown values like `corr_no_assoc`). The SQL query is SWR-deduped with
  // the panel preview, so this isn't a separate fetch.
  const previewPanel = useMemo<Panel>(() => {
    const base: Panel = panel ?? {
      id: "__panel_edit_preview__",
      type: "line",
      title: "",
      metrics: [],
      config: {},
      layout: { x: 0, y: 0, w: 1, h: 1 },
    };
    return {
      ...base,
      type: panelType,
      dataSource,
      config,
      metrics: selectedMetrics,
    };
  }, [panel, panelType, dataSource, config, selectedMetrics]);
  const { metrics: liveSeriesKeys } = usePanelData({
    panel: previewPanel,
    timeRange,
  });

  // Sync the form fields whenever a different panel is selected. React's
  // "adjust state when a prop changes" pattern: compare against the previously
  // synced panel during render so it resets in the same commit. The sentinel
  // start value (undefined) ensures the very first panel still syncs on mount.
  const [syncedPanel, setSyncedPanel] = useState<Panel | null | undefined>(
    undefined,
  );
  if (panel !== syncedPanel) {
    setSyncedPanel(panel);
    if (panel) {
      setTitle(panel.title);
      setPanelType(panel.type);
      setSelectedMetrics(panel.metrics ?? []);
      setDataSource(panel.dataSource ?? { type: "realtime" });
      setConfig(panel.config);
    }
  }

  const handleUpdate = (updates: Partial<Panel>) => onUpdate(updates);

  const handleTitleChange = (newTitle: string) => {
    setTitle(newTitle);
    handleUpdate({ title: newTitle });
  };

  const handleTypeChange = (newType: PanelType) => {
    setPanelType(newType);
    handleUpdate({ type: newType });
    setTypePickerOpen(false);
  };

  const handleDataSourceChange = (source: DataSource) => {
    setDataSource(source);
    handleUpdate({ dataSource: source });
  };

  const handleMetricsChange = (metrics: string[]) => {
    setSelectedMetrics(metrics);
    handleUpdate({ metrics });
  };

  const handleConfigChange = (updates: Partial<PanelConfig>) => {
    const newConfig = { ...config, ...updates };
    setConfig(newConfig);
    handleUpdate({ config: newConfig });
  };

  if (!panel) return null;

  const panelSource = getPanelDefinition(panelType)?.source ?? "data";
  const showDataSection = panelSource === "data";
  const showConnectionControls =
    showDataSection && isConnectionSource(dataSource);
  // Realtime only: connection panels aggregate in SQL (Show/Per in the Data
  // section); the client-side picker there was misleading double machinery.
  // Stored dataAggregation on old connection panels still executes (read
  // path in runPanelPipeline untouched) — we just stop offering the control.
  const showProcessing =
    showDataSection &&
    CHART_TYPES_WITH_AGGREGATION.includes(panelType) &&
    !isConnectionSource(dataSource);
  const showFilters =
    showDataSection &&
    (selectedMetrics.length > 0 || isConnectionSource(dataSource));

  const currentType = PANEL_CATEGORIES.flatMap((c) => c.types).find(
    (t) => t.value === panelType,
  );
  const CurrentIcon = currentType?.icon;

  return (
    <div className="w-full h-full border-l border-border bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-11 border-b border-border shrink-0">
        <span className="text-sm font-semibold">Edit panel</span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Scrollable content — single column */}
      <div className="flex-1 overflow-y-auto">
        {/* Visualization + Title */}
        <div className="px-4 py-4 space-y-3 border-b border-border">
          <div>
            <Label className="text-xs font-medium text-foreground">
              Visualization
            </Label>
            <Popover open={typePickerOpen} onOpenChange={setTypePickerOpen}>
              <PopoverTrigger asChild>
                <button className="w-full mt-1.5 px-3 h-9 flex items-center justify-between rounded-md border border-input bg-background text-sm hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-2 min-w-0">
                    {CurrentIcon && (
                      <CurrentIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    <span className="truncate">
                      {currentType?.label ?? "Select type"}
                    </span>
                  </div>
                  <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-3" align="start">
                <div className="space-y-4 max-h-96 overflow-y-auto">
                  {PANEL_CATEGORIES.map((category) => (
                    <div key={category.name}>
                      <div className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wide mb-2 px-1">
                        {category.name}
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        {category.types.map((type) => {
                          const Icon = type.icon;
                          const isSelected = panelType === type.value;
                          return (
                            <button
                              key={type.value}
                              onClick={() => handleTypeChange(type.value)}
                              title={type.description}
                              className={cn(
                                "p-2 rounded-md text-center transition-colors flex flex-col items-center gap-1",
                                isSelected
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-muted/40 hover:bg-muted text-foreground",
                              )}
                            >
                              <Icon className="h-4 w-4" />
                              <span className="text-[10px] leading-tight truncate w-full">
                                {type.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          <div>
            <Label className="text-xs font-medium text-foreground">Title</Label>
            <Input
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              className="h-9 text-sm mt-1.5"
              placeholder="Panel title"
            />
          </div>
        </div>

        {/* Data */}
        {showDataSection && (
          <DataSection
            dataSource={dataSource}
            selectedMetrics={selectedMetrics}
            onDataSourceChange={handleDataSourceChange}
            onMetricsChange={handleMetricsChange}
            variant={panelType === "datagrid" ? "table" : "chart"}
          />
        )}

        {/* Query (connection sources) */}
        {showConnectionControls && dataSource.query && (
          <QuerySection
            dataSource={dataSource as ConnectionDataSource}
            onDataSourceChange={handleDataSourceChange}
            timeRange={timeRange}
            variables={variableValues}
          />
        )}

        {/* Processing */}
        {showProcessing && (
          <ProcessingSection
            config={config}
            onConfigChange={handleConfigChange}
            selectedMetrics={selectedMetrics}
            timeRange={timeRange}
          />
        )}

        {/* Display (per-type) */}
        <DisplaySection
          panelType={panelType}
          config={config}
          onConfigChange={handleConfigChange}
          selectedMetrics={selectedMetrics}
          dataSource={dataSource}
          liveSeriesKeys={liveSeriesKeys}
          showShared={showDataSection}
        />

        {/* Settings */}
        {(showConnectionControls || showFilters) && (
          <SettingsSection
            dataSource={dataSource}
            onDataSourceChange={handleDataSourceChange}
            config={config}
            onConfigChange={handleConfigChange}
            selectedMetrics={selectedMetrics}
            dashboardFilters={dashboardFilters}
            showRefresh={showConnectionControls}
            showFilters={showFilters}
          />
        )}

        {/* Delete */}
        {onDelete && (
          <div className="px-4 py-4 border-t border-border mt-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full h-9 text-sm text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete panel
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete panel</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete &quot;{panel?.title}&quot;?
                    This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={onDelete}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>
    </div>
  );
}
