"use client";

/**
 * Settings section: connection refresh interval + panel-level "Where"
 * filters (with dashboard-filter exclusions).
 */

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FilterBuilder } from "@/components/dashboard/filter-builder";
import {
  isConnectionSource,
  type ConnectionDataSource,
  type DataFilter,
  type DataSource,
  type PanelConfig,
} from "@/lib/types/dashboard";
import { SectionHeader } from "./section-header";

interface SettingsSectionProps {
  dataSource: DataSource;
  onDataSourceChange: (source: DataSource) => void;
  config: PanelConfig;
  onConfigChange: (updates: Partial<PanelConfig>) => void;
  selectedMetrics: string[];
  dashboardFilters: DataFilter[];
  showRefresh: boolean;
  showFilters: boolean;
}

export function SettingsSection({
  dataSource,
  onDataSourceChange,
  config,
  onConfigChange,
  selectedMetrics,
  dashboardFilters,
  showRefresh,
  showFilters,
}: SettingsSectionProps) {
  return (
    <>
      <SectionHeader>Settings</SectionHeader>
      <div className="px-4 pb-4 space-y-4">
        {showRefresh && isConnectionSource(dataSource) && (
          <div>
            <Label className="text-xs font-medium">Refresh interval</Label>
            <Select
              value={String(dataSource.refreshInterval ?? 0)}
              onValueChange={(v) =>
                onDataSourceChange({
                  ...dataSource,
                  refreshInterval: Number(v),
                } as ConnectionDataSource)
              }
            >
              <SelectTrigger className="h-9 text-sm mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Off</SelectItem>
                <SelectItem value="1000">1 second</SelectItem>
                <SelectItem value="2000">2 seconds</SelectItem>
                <SelectItem value="5000">5 seconds</SelectItem>
                <SelectItem value="10000">10 seconds</SelectItem>
                <SelectItem value="30000">30 seconds</SelectItem>
                <SelectItem value="60000">1 minute</SelectItem>
                <SelectItem value="300000">5 minutes</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {showFilters && (
          <div>
            <Label className="text-xs font-medium mb-2 block">Where</Label>
            <FilterBuilder
              filters={config.filters || []}
              onChange={(filters) => onConfigChange({ filters })}
              availableFields={
                isConnectionSource(dataSource) && dataSource.selectedColumns
                  ? dataSource.selectedColumns
                  : selectedMetrics
              }
              dashboardFilters={dashboardFilters}
              excludedDashboardFilters={config.excludedDashboardFilters || []}
              onExcludedChange={(excluded) =>
                onConfigChange({ excludedDashboardFilters: excluded })
              }
            />
          </div>
        )}
      </div>
    </>
  );
}
