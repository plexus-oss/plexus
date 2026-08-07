"use client";

/**
 * Standalone run comparison — /runs/compare?run=<primaryId>&vs=<baselineId>
 *
 * Compare two runs with NO dashboard required: the primary run's source
 * declares its metrics, a chart grid is generated on the fly, and the
 * baseline overlays every chart as the violet run trace, aligned at T+0.
 * Both slots are switchable in the header; ⇄ swaps them. Rows on /runs and
 * the dashboard Runs control deep-link here.
 */

import { useCallback, useEffect, useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { ArrowLeftRight, Check, FlaskConical, Search } from "lucide-react";
import { PageWrapper } from "@/components/ui/page-wrapper";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ChartPanel } from "@/components/dashboard/panels/chart-panel";
import { TelemetryProvider } from "@/components/dashboard/telemetry-provider";
import { DashboardStateProvider } from "@/components/dashboard/dashboard-state-context";
import {
  DashboardInteractionProvider,
  useDashboardInteraction,
  RUN_COMPARE_COLORS,
} from "@/components/dashboard/dashboard-interaction-context";
import {
  formatDuration,
  STATUS_DOT,
} from "@/components/dashboard/run-compare-picker";
import { useRuns, type Run } from "@/hooks/use-runs";
import { fetcher } from "@/lib/fetcher";
import { formatRelativeShort } from "@/lib/format/relative-time";
import type { Panel, TimeRange } from "@/lib/types/dashboard";
import { cn } from "@/lib/utils";

const ts = (iso: string) => new Date(iso).getTime();

/** One of the two run slots — house picker pattern in a popover. */
function RunSelect({
  value,
  runs,
  onChange,
  accent,
}: {
  value: Run | null;
  runs: Run[];
  onChange: (run: Run) => void;
  /** "primary" (solid swatch) or "baseline" (violet swatch) */
  accent: "primary" | "baseline";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? runs.filter((r) => r.name.toLowerCase().includes(q)) : runs;
  }, [runs, query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-2 h-8 px-2.5 rounded-md border border-border bg-background text-xs font-medium hover:bg-muted/50 transition-colors max-w-[280px]">
          <span
            className={cn(
              "w-3 h-0.5 rounded-full shrink-0",
              accent === "primary" ? "bg-foreground" : "bg-[#f97316]",
            )}
          />
          <span className="truncate">{value ? value.name : "Pick a run…"}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} className="w-80 p-0">
        <div className="p-2 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search runs…"
              className="h-7 pl-7 text-[11px]"
            />
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="px-3 py-4 text-[11px] text-muted-foreground">
              {query ? `No matches for "${query}"` : "No runs yet."}
            </p>
          ) : (
            filtered.map((run) => (
              <button
                key={run.id}
                onClick={() => {
                  onChange(run);
                  setOpen(false);
                  setQuery("");
                }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors",
                  value?.id === run.id
                    ? "bg-foreground/10 text-foreground"
                    : "hover:bg-muted/60",
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full shrink-0",
                    STATUS_DOT[run.status],
                  )}
                />
                <span className="truncate flex-1 font-medium">{run.name}</span>
                <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                  {formatDuration(run)}
                </span>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {formatRelativeShort(new Date(run.started_at))}
                </span>
                {value?.id === run.id && (
                  <Check className="h-3 w-3 shrink-0 text-foreground" />
                )}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Pushes the baseline into the interaction context the panels live in. */
function CompareState({
  primary,
  baseline,
}: {
  primary: Run;
  baseline: Run | null;
}) {
  const { setCompareRuns } = useDashboardInteraction();
  useEffect(() => {
    if (!baseline) {
      setCompareRuns([]);
      return;
    }
    const start = ts(baseline.started_at);
    const end = baseline.ended_at ? ts(baseline.ended_at) : Date.now();
    setCompareRuns([
      {
        id: baseline.id,
        window: `${new Date(start).toISOString()}/${new Date(end).toISOString()}`,
        label: baseline.name,
        startedAt: start,
        alignTarget: ts(primary.started_at),
        primaryLabel: primary.name,
        sourceId: baseline.source_id,
        color: RUN_COMPARE_COLORS[0],
      },
    ]);
    return () => setCompareRuns([]);
  }, [primary, baseline, setCompareRuns]);
  return null;
}

function CompareRunsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { runs, isLoading } = useRuns();

  const primaryParam = searchParams.get("run");
  const baselineParam = searchParams.get("vs");

  // Defaults: primary = most recent completed run, baseline = the one before.
  const { primary, baseline } = useMemo(() => {
    const byRecency = [...runs].sort(
      (a, b) => ts(b.started_at) - ts(a.started_at),
    );
    const primary =
      runs.find((r) => r.id === primaryParam) ??
      byRecency.find((r) => r.ended_at) ??
      byRecency[0] ??
      null;
    const baseline =
      runs.find((r) => r.id === baselineParam && r.id !== primary?.id) ??
      byRecency.find((r) => r.id !== primary?.id && r.ended_at) ??
      null;
    return { primary, baseline };
  }, [runs, primaryParam, baselineParam]);

  // Native history API, not router.replace — slot changes are pure URL state
  // driving client SWR/memos; a router navigation re-fetches the route and
  // flashes the loading UI (reads as a page reload).
  const setSlot = useCallback(
    (slot: "run" | "vs", id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(slot, id);
      window.history.replaceState(null, "", `/runs/compare?${params.toString()}`);
    },
    [searchParams],
  );

  const swap = useCallback(() => {
    if (!primary || !baseline) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("run", baseline.id);
    params.set("vs", primary.id);
    window.history.replaceState(null, "", `/runs/compare?${params.toString()}`);
  }, [primary, baseline, searchParams]);

  // Metric discovery from the primary run's source.
  const { data: sourcesData } = useSWR<{
    sources: Array<{ id: string; slug: string }>;
  }>("/api/sources", fetcher);
  const sourceSlug = useMemo(() => {
    if (!primary?.source_id) return null;
    return (
      sourcesData?.sources.find((s) => s.id === primary.source_id)?.slug ?? null
    );
  }, [primary, sourcesData]);

  const { data: metricsData, isLoading: metricsLoading } = useSWR<{
    metrics: Array<{ name: string; type?: string }>;
  }>(sourceSlug ? `/api/sources/${sourceSlug}/metrics` : null, fetcher);

  const metricNames = useMemo(
    () => (metricsData?.metrics ?? []).map((m) => m.name).slice(0, 12),
    [metricsData],
  );

  // Frame the primary run; viewer navigation (pan/zoom) commits here.
  // Page-load instant for open-ended (still-active) runs — lazy state, not a
  // render-time Date.now() (compiler-enforced purity).
  const [loadedAt] = useState(() => Date.now());
  const [rangeOverride, setRangeOverride] = useState<TimeRange | null>(null);
  const frame = useMemo<TimeRange | null>(() => {
    if (!primary) return null;
    const start = ts(primary.started_at);
    const end = primary.ended_at ? ts(primary.ended_at) : loadedAt;
    const pad = Math.max((end - start) * 0.05, 2_000);
    return {
      type: "absolute",
      value: `${new Date(start - pad).toISOString()}/${new Date(
        end + pad,
      ).toISOString()}`,
    };
  }, [primary, loadedAt]);
  // New primary → drop any pan/zoom override (render-phase adjust pattern).
  const [prevFrameKey, setPrevFrameKey] = useState(frame?.value);
  if (frame?.value !== prevFrameKey) {
    setPrevFrameKey(frame?.value);
    setRangeOverride(null);
  }
  const timeRange = rangeOverride ?? frame;

  const panels = useMemo<Panel[]>(() => {
    if (!sourceSlug) return [];
    return metricNames.map((metric, i) => ({
      id: `compare-${sourceSlug}-${metric}`,
      type: "line" as Panel["type"],
      title: metric,
      metrics: [`${sourceSlug}:${metric}`],
      config: {
        sourceId: sourceSlug,
        showLegend: true,
        showAlerts: false,
        showAnnotations: false,
      },
      layout: { x: (i % 2) * 6, y: Math.floor(i / 2) * 4, w: 6, h: 4 },
    }));
  }, [sourceSlug, metricNames]);

  const header = (
    <div className="flex items-center gap-2 px-2 py-1.5 border-b border-border">
      <RunSelect
        value={primary}
        runs={runs}
        onChange={(r) => setSlot("run", r.id)}
        accent="primary"
      />
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={swap}
        disabled={!primary || !baseline}
        aria-label="Swap runs"
        title="Swap runs"
      >
        <ArrowLeftRight className="h-3.5 w-3.5" />
      </Button>
      <RunSelect
        value={baseline}
        runs={runs.filter((r) => r.id !== primary?.id)}
        onChange={(r) => setSlot("vs", r.id)}
        accent="baseline"
      />
      <span className="text-[10px] text-muted-foreground ml-1 hidden md:inline">
        aligned at run start
      </span>
    </div>
  );

  if (isLoading) {
    return (
      <PageWrapper title="Compare runs">
        <div className="flex items-center justify-center h-full py-12">
          <Spinner />
        </div>
      </PageWrapper>
    );
  }

  if (!primary) {
    return (
      <PageWrapper title="Compare runs">
        <EmptyState
          icon={FlaskConical}
          title="No runs to compare"
          description="Start a run from a test script via the API, or save a time range as a run from any dashboard."
          className="h-full"
        />
      </PageWrapper>
    );
  }

  return (
    <PageWrapper title="Compare runs">
      <div className="flex flex-col h-full">
        {header}
        {!sourceSlug || (metricNames.length === 0 && !metricsLoading) ? (
          <EmptyState
            icon={FlaskConical}
            title="No metrics found for this run"
            description={
              primary.source_id
                ? "The run's source hasn't reported any metrics yet."
                : "This run isn't tied to a source, so there are no metrics to plot. Pick a run created against a device."
            }
            className="flex-1"
          />
        ) : metricsLoading || !timeRange ? (
          <div className="flex-1 flex items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <TelemetryProvider
            key={`${primary.id}-${sourceSlug}`}
            timeRange={timeRange}
            refreshInterval={0}
          >
            <DashboardStateProvider
              filters={[]}
              variables={[]}
              refreshInterval={0}
            >
              <DashboardInteractionProvider
                currentTimeRange={timeRange}
                onTimeRangeChange={setRangeOverride}
                syncTooltips
              >
                <CompareState primary={primary} baseline={baseline} />
                <div className="flex-1 overflow-y-auto p-2">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                    {panels.map((panel) => (
                      <div
                        key={panel.id}
                        className="h-72 rounded-lg border border-border bg-card overflow-hidden"
                      >
                        <div className="px-3 pt-2 text-xs font-medium text-muted-foreground">
                          {panel.title}
                        </div>
                        <div className="h-[calc(100%-1.75rem)]">
                          <ChartPanel
                            panel={panel}
                            timeRange={timeRange}
                            chartType="line"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </DashboardInteractionProvider>
            </DashboardStateProvider>
          </TelemetryProvider>
        )}
      </div>
    </PageWrapper>
  );
}

export default function CompareRunsPageWrapper() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full py-12">
          <Spinner />
        </div>
      }
    >
      <CompareRunsPage />
    </Suspense>
  );
}
