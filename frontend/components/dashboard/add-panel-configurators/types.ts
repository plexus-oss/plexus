/**
 * Shared contract for the per-type Add-Panel configurators.
 *
 * Each configurator is a focused right-pane form that owns its own state
 * for one panel family. It builds up a `Draft` and pushes it to the modal
 * via `onChange`; the modal turns that into a `Panel` on Add.
 *
 * Configurators DO NOT generate panel ids or layout — those are the
 * modal's responsibility (so layout placement stays consistent across
 * types). They DO own metrics, dataSource, and config.
 */

import type { DataSource, PanelConfig } from "@/lib/types/dashboard";

export interface PanelDraft {
  /** Panel type — the configurator is bound to this. */
  type: string;
  /** Title (optional — the modal collects this separately). */
  title?: string;
  /** Metrics this panel subscribes to. */
  metrics?: string[];
  /** Optional data source — undefined for panels without one. */
  dataSource?: DataSource;
  /** Type-specific panel config. */
  config: Partial<PanelConfig>;
}

export interface ConfiguratorProps {
  /** Current draft state. */
  draft: PanelDraft;
  /**
   * Replace the draft. Configurators typically merge into this.
   * Accepts an updater function (the modal backs this with a useState
   * setter) — REQUIRED when a child fires two callbacks in one event
   * (e.g. SourcePicker's onDataSourceChange + onMetricsChange), where
   * two plain `{ ...draft }` writes from the same render would clobber
   * each other.
   */
  onChange: (next: PanelDraft | ((prev: PanelDraft) => PanelDraft)) => void;
  /** Whether the draft has the minimum data needed to "Add Panel". */
  onValidChange: (valid: boolean) => void;
}
