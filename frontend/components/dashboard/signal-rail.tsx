"use client";

/**
 * Signal rail — a collapsible right-side rail listing every source's metrics
 * (same discovery tree as the add-panel source picker) for drag-a-metric
 * chart composition:
 *
 * - Drag a metric row onto a chart-family panel → appends it to that panel.
 * - Drag onto empty dashboard space → creates a new panel (line instantly;
 *   a drop-time sample classifies state/sparse signals into honest types —
 *   see lib/dashboard/classify-signal.ts).
 * - Click a row (no-drag fallback) → "Add to…" menu of chart panels + New panel.
 *
 * The Add Panel modal stays the full-featured path; this rail is the fast one.
 */

import { useMemo, useState, useSyncExternalStore } from "react";
import {
  ChevronRight,
  GripVertical,
  Plus,
  Search,
  Wifi,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useMergedMetricsBySource } from "@/hooks/use-merged-metrics";
import {
  matchesAllTokens,
  tokenizeQuery,
  truncateMiddle,
} from "@/lib/dashboard/metric-search";
import {
  METRIC_DRAG_MIME,
  canAcceptMetric,
  hasDroppedMetric,
  subscribeMetricDropped,
} from "@/lib/dashboard/metric-dnd";
import type { Panel } from "@/lib/types/dashboard";
import { getPanelDefinition } from "@/lib/panels/registry";

interface SignalRailProps {
  /** Current dashboard panels — feeds the "Add to…" menu. */
  panels: Panel[];
  /** Append a qualified metric to an existing chart panel (saved via the panel-update path). */
  onAddToPanel: (panelId: string, qualifiedMetric: string) => void;
  /** Create a new panel for a qualified metric (line first, then signal-shape classified). */
  onCreatePanel: (qualifiedMetric: string) => void;
  onClose: () => void;
}

export function SignalRail({
  panels,
  onAddToPanel,
  onCreatePanel,
  onClose,
}: SignalRailProps) {
  const { sources, isLoading } = useMergedMetricsBySource();
  // First-run teaching hint: shown until the first successful drop lands
  // (drop handlers set the flag), then gone forever. Server snapshot "seen"
  // avoids a hydration flash.
  const dropSeen = useSyncExternalStore(
    subscribeMetricDropped,
    hasDroppedMetric,
    () => true,
  );
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  /** Qualified metric key whose "Add to…" menu is open (one at a time). */
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const tokens = useMemo(() => tokenizeQuery(search), [search]);
  const searching = tokens.length > 0;

  // Space-tokenized, all-terms-must-match, over "source metric" so terms can
  // span both levels ("drone gyro"). Sources with no surviving metrics drop.
  const filteredSources = useMemo(() => {
    if (!searching) return sources;
    return sources
      .map((s) => ({
        ...s,
        metrics: s.metrics.filter((m) =>
          matchesAllTokens(`${s.source_id} ${m}`, tokens),
        ),
      }))
      .filter((s) => s.metrics.length > 0);
  }, [sources, tokens, searching]);

  const chartPanels = useMemo(() => panels.filter(canAcceptMetric), [panels]);

  const toggleGroup = (sourceId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
  };

  return (
    <div className="h-full w-full flex flex-col border-l border-border bg-background">
      {/* Header */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
        <span className="text-sm font-semibold">Metrics</span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          aria-label="Close metrics rail"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Search */}
      <div className="shrink-0 border-b border-border p-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search devices, metrics…"
            className="h-8 w-full border-0 bg-transparent pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground/60"
          />
        </div>
      </div>

      {/* Tree */}
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {isLoading && sources.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        ) : sources.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">
            No sources yet — connect a device to see its metrics here.
          </p>
        ) : filteredSources.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">
            No metrics match &ldquo;{search}&rdquo;
          </p>
        ) : (
          filteredSources.map((source) => {
            const isOpen = searching || !collapsed.has(source.source_id);
            return (
              <Collapsible
                key={source.source_id}
                open={isOpen}
                onOpenChange={() => toggleGroup(source.source_id)}
              >
                <CollapsibleTrigger asChild>
                  <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/50">
                    <ChevronRight
                      className={`h-3.5 w-3.5 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
                    />
                    <span className="truncate font-medium">
                      {source.source_id}
                    </span>
                    {source.isOnline && (
                      <Wifi className="ml-auto h-3 w-3 shrink-0 text-blue-500" />
                    )}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  {source.metrics.map((metric) => (
                    <MetricRow
                      key={`${source.source_id}:${metric}`}
                      sourceId={source.source_id}
                      metric={metric}
                      chartPanels={chartPanels}
                      menuOpen={menuFor === `${source.source_id}:${metric}`}
                      onMenuOpenChange={(open) =>
                        setMenuFor(
                          open ? `${source.source_id}:${metric}` : null,
                        )
                      }
                      onAddToPanel={onAddToPanel}
                      onCreatePanel={onCreatePanel}
                    />
                  ))}
                </CollapsibleContent>
              </Collapsible>
            );
          })
        )}
      </div>

      {/* First-run hint — disappears forever after the first successful drop */}
      {!dropSeen && (
        <div className="shrink-0 border-t border-border px-3 py-2">
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Drag a metric onto a chart — or onto empty space for a new panel.
          </p>
        </div>
      )}
    </div>
  );
}

function MetricRow({
  sourceId,
  metric,
  chartPanels,
  menuOpen,
  onMenuOpenChange,
  onAddToPanel,
  onCreatePanel,
}: {
  sourceId: string;
  metric: string;
  chartPanels: Panel[];
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onAddToPanel: (panelId: string, qualifiedMetric: string) => void;
  onCreatePanel: (qualifiedMetric: string) => void;
}) {
  const qualified = `${sourceId}:${metric}`;

  return (
    <Popover open={menuOpen} onOpenChange={onMenuOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          draggable
          onDragStart={(e) => {
            // A drag is a drag — never also open the click menu.
            onMenuOpenChange(false);
            e.dataTransfer.setData(METRIC_DRAG_MIME, qualified);
            e.dataTransfer.effectAllowed = "copy";
          }}
          title={qualified}
          className="group flex w-full cursor-grab items-center gap-2 rounded py-1 pl-3 pr-2 text-left transition-colors hover:bg-muted/60 active:cursor-grabbing"
        >
          {/* Grip: drag affordance — reserves its slot so text never shifts */}
          <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100" />
          <span className="whitespace-nowrap font-mono text-[11px] text-muted-foreground group-hover:text-foreground">
            {truncateMiddle(metric, 32)}
          </span>
          {/* Not a nested <button> — the whole row is the menu trigger */}
          <span className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-40 transition group-hover:bg-muted group-hover:opacity-100">
            <Plus className="h-3 w-3" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="left" align="start" className="w-60 p-1">
        <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Add{" "}
          <span className="font-mono normal-case">
            {truncateMiddle(metric, 20)}
          </span>{" "}
          to…
        </div>
        {chartPanels.map((p) => {
          const def = getPanelDefinition(p.type);
          const Icon = def?.icon;
          const already = p.metrics.includes(qualified);
          return (
            <button
              key={p.id}
              type="button"
              disabled={already}
              onClick={() => {
                onAddToPanel(p.id, qualified);
                onMenuOpenChange(false);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted/60 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
            >
              {Icon && (
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">
                {p.title || def?.label || p.type}
              </span>
              {already && (
                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                  added
                </span>
              )}
            </button>
          );
        })}
        {chartPanels.length > 0 && <div className="my-1 h-px bg-border" />}
        <button
          type="button"
          onClick={() => {
            onCreatePanel(qualified);
            onMenuOpenChange(false);
          }}
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted/60"
        >
          <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span>New panel</span>
        </button>
      </PopoverContent>
    </Popover>
  );
}
