"use client";

/**
 * Display section: the per-type config form (config-sections/) plus the
 * shared colors/unit/decimals block for data-driven panels.
 */

import { PanelConfigSection } from "@/components/dashboard/config-sections";
import { SharedConfig } from "@/components/dashboard/config-sections/shared-config";
import {
  isConnectionSource,
  type DataSource,
  type PanelConfig,
  type PanelType,
} from "@/lib/types/dashboard";
import { SectionHeader } from "./section-header";

interface DisplaySectionProps {
  panelType: PanelType;
  config: PanelConfig;
  onConfigChange: (updates: Partial<PanelConfig>) => void;
  selectedMetrics: string[];
  dataSource: DataSource;
  /** Live series keys from the in-progress edit (for the color pickers). */
  liveSeriesKeys: string[];
  /** Render the shared colors/unit block (data-driven panels only). */
  showShared: boolean;
}

export function DisplaySection({
  panelType,
  config,
  onConfigChange,
  selectedMetrics,
  dataSource,
  liveSeriesKeys,
  showShared,
}: DisplaySectionProps) {
  return (
    <>
      <SectionHeader>Display</SectionHeader>
      <PanelConfigSection
        type={panelType}
        config={config as Record<string, unknown>}
        onChange={onConfigChange}
        metrics={selectedMetrics}
      />
      {showShared && (
        <SharedConfig
          config={config as Record<string, unknown>}
          onChange={onConfigChange}
          metrics={selectedMetrics}
          dataSource={dataSource}
          seriesKeys={
            isConnectionSource(dataSource) ? liveSeriesKeys : undefined
          }
        />
      )}
    </>
  );
}
