"use client";

/**
 * /runs/[id] — the run's home.
 *
 * A run is an object with a page, not a row in a table: identity (editable
 * name, status, duration, source, timing), the auto-generated metric grid of
 * its window, and what happened during it (annotations, alerts). Compare is
 * the page's primary CTA — you compare FROM a run, not from a mode hidden in
 * a dashboard toolbar. Active runs tick live and carry the End-run control.
 */

import {
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  ArrowLeft,
  Bell,
  FlaskConical,
  GitCompare,
  LayoutDashboard,
  MessageSquare,
  Square,
} from "lucide-react";
import { PageWrapper } from "@/components/ui/page-wrapper";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ChartPanel } from "@/components/dashboard/panels/chart-panel";
import { TelemetryProvider } from "@/components/dashboard/telemetry-provider";
import { DashboardStateProvider } from "@/components/dashboard/dashboard-state-context";
import { DashboardInteractionProvider } from "@/components/dashboard/dashboard-interaction-context";
import {
  formatDuration,
  STATUS_DOT,
} from "@/components/dashboard/run-compare-picker";
import { Elapsed } from "@/components/runs/elapsed";
import { useRuns, type Run } from "@/hooks/use-runs";
import { useAlerts } from "@/hooks/use-alerts";
import { useFormattedTime } from "@/hooks/use-formatted-time";
import { formatDateTimeInZone } from "@/lib/timezone";
import { formatRelativeShort } from "@/lib/format/relative-time";
import { fetcher } from "@/lib/fetcher";
import type { Panel, TimeRange } from "@/lib/types/dashboard";
import { cn } from "@/lib/utils";

const ts = (iso: string) => new Date(iso).getTime();

interface RunPageProps {
  params: Promise<{ id: string }>;
}

export default function RunPage({ params }: RunPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const { runs, isLoading, updateRun } = useRuns();
  const { timezone, use12Hour } = useFormattedTime();

  const run = useMemo(() => runs.find((r) => r.id === id) ?? null, [runs, id]);

  // Identity — editable name (borderless input, save on blur/Enter).
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const commitName = useCallback(async () => {
    if (!run || nameDraft === null) return;
    const next = nameDraft.trim();
    setNameDraft(null);
    if (next && next !== run.name) {
      await updateRun(run.id, { name: next }).catch(() => {});
    }
  }, [run, nameDraft, updateRun]);

  const [ending, setEnding] = useState(false);
  const endRun = useCallback(async () => {
    if (!run || ending) return;
    setEnding(true);
    try {
      await updateRun(run.id, {
        ended_at: new Date().toISOString(),
        status: "completed",
      });
    } finally {
      setEnding(false);
    }
  }, [run, ending, updateRun]);

  // Source resolution (uuid → slug/name) for metrics + links.
  const { data: sourcesData } = useSWR<{
    sources: Array<{ id: string; slug: string; name: string | null }>;
  }>("/api/sources", fetcher);
  const source = useMemo(() => {
    if (!run?.source_id) return null;
    return sourcesData?.sources.find((s) => s.id === run.source_id) ?? null;
  }, [run, sourcesData]);

  const { data: metricsData, isLoading: metricsLoading } = useSWR<{
    metrics: Array<{ name: string }>;
  }>(source ? `/api/sources/${source.slug}/metrics` : null, fetcher);
  const metricNames = useMemo(
    () => (metricsData?.metrics ?? []).map((m) => m.name).slice(0, 12),
    [metricsData],
  );

  // The run's window. Active runs use a live relative range so charts stream.
  const [loadedAt] = useState(() => Date.now());
  const [rangeOverride, setRangeOverride] = useState<TimeRange | null>(null);
  const frame = useMemo<TimeRange | null>(() => {
    if (!run) return null;
    if (!run.ended_at) {
      // Live: window since run start, refreshed by the provider's live path.
      const spanMin = Math.max(
        1,
        Math.ceil((loadedAt - ts(run.started_at)) / 60_000) + 1,
      );
      return { type: "relative", value: `${spanMin}m` };
    }
    const start = ts(run.started_at);
    const end = ts(run.ended_at);
    const pad = Math.max((end - start) * 0.05, 2_000);
    return {
      type: "absolute",
      value: `${new Date(start - pad).toISOString()}/${new Date(
        end + pad,
      ).toISOString()}`,
    };
  }, [run, loadedAt]);
  const timeRange = rangeOverride ?? frame;

  const panels = useMemo<Panel[]>(() => {
    if (!source) return [];
    return metricNames.map((metric, i) => ({
      id: `run-${id}-${metric}`,
      type: "line" as Panel["type"],
      title: metric,
      metrics: [`${source.slug}:${metric}`],
      config: {
        sourceId: source.slug,
        showLegend: false,
        showAlerts: false,
        showAnnotations: true,
      },
      layout: { x: (i % 2) * 6, y: Math.floor(i / 2) * 4, w: 6, h: 4 },
    }));
  }, [source, metricNames, id]);

  // What happened during the run: annotations + alerts inside the window.
  const windowBounds = useMemo(() => {
    if (!run) return null;
    return {
      start: run.started_at,
      end: run.ended_at ?? new Date(loadedAt).toISOString(),
    };
  }, [run, loadedAt]);

  const { data: annotationsData } = useSWR<{
    annotations: Array<{
      id: string;
      label: string;
      notes: string | null;
      timestamp_start: string;
      timestamp_end: string | null;
    }>;
  }>(
    source && windowBounds
      ? `/api/annotations?sourceId=${encodeURIComponent(source.slug)}&start=${encodeURIComponent(new Date(windowBounds.start).toISOString())}&end=${encodeURIComponent(new Date(windowBounds.end).toISOString())}`
      : null,
    fetcher,
  );
  const runAnnotations = annotationsData?.annotations ?? [];

  const { alerts } = useAlerts({
    sourceId: source ? [source.slug] : [],
    enabled: !!source,
  });
  const runAlerts = useMemo(() => {
    if (!windowBounds) return [];
    const s = ts(windowBounds.start);
    const e = ts(windowBounds.end);
    return alerts.filter((a) => {
      const t = new Date(a.triggered_at).getTime();
      return t >= s && t <= e;
    });
  }, [alerts, windowBounds]);

  // Compare CTA — pick the other run, land on the comparison.
  const [compareOpen, setCompareOpen] = useState(false);
  const otherRuns = useMemo(
    () =>
      runs.filter(
        (r) =>
          r.id !== id &&
          (!run?.source_id || !r.source_id || r.source_id === run.source_id),
      ),
    [runs, id, run],
  );

  // New run id (navigation) → clear transient state.
  const [prevId, setPrevId] = useState(id);
  if (prevId !== id) {
    setPrevId(id);
    setRangeOverride(null);
    setNameDraft(null);
  }

  useEffect(() => {
    // Active run page: tick the frame forward every 30 s so live charts keep
    // the whole run in view as it grows.
    if (!run || run.ended_at) return;
    const t = setInterval(() => setRangeOverride(null), 30_000);
    return () => clearInterval(t);
  }, [run]);

  if (isLoading) {
    return (
      <PageWrapper title="Run">
        <div className="flex items-center justify-center h-full py-12">
          <Spinner />
        </div>
      </PageWrapper>
    );
  }

  if (!run) {
    return (
      <PageWrapper title="Run">
        <EmptyState
          icon={FlaskConical}
          title="Run not found"
          description="This run doesn't exist or was deleted."
          action={{ label: "All runs", onClick: () => router.push("/runs") }}
          className="h-full"
        />
      </PageWrapper>
    );
  }

  const fmtAbs = (iso: string) =>
    formatDateTimeInZone(new Date(iso), timezone, use12Hour);

  const titleContent = (
    <div className="flex items-center gap-2 min-w-0">
      <Link
        href="/runs"
        className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
        aria-label="All runs"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
      </Link>
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full shrink-0",
          STATUS_DOT[run.status],
        )}
      />
      <input
        value={nameDraft ?? run.name}
        onChange={(e) => setNameDraft(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setNameDraft(null);
        }}
        className="bg-transparent text-xs font-medium outline-none min-w-0 w-[280px] truncate focus:border-b focus:border-border"
        aria-label="Run name"
      />
    </div>
  );

  const identityRow = (
    <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-b border-border flex-wrap">
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground min-w-0 flex-wrap">
        <span className="font-mono text-foreground">
          {run.ended_at ? (
            formatDuration(run)
          ) : (
            <Elapsed since={run.started_at} />
          )}
        </span>
        <span className="h-3 w-px bg-border" />
        <span title={fmtAbs(run.started_at)}>
          started {formatRelativeShort(new Date(run.started_at))} ago ·{" "}
          {fmtAbs(run.started_at)}
        </span>
        {run.ended_at && <span>→ {fmtAbs(run.ended_at)}</span>}
        {source && (
          <>
            <span className="h-3 w-px bg-border" />
            <Link
              href={`/devices/${source.slug}`}
              className="font-mono text-foreground/80 hover:text-foreground transition-colors"
            >
              {source.slug}
            </Link>
          </>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {!run.ended_at && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px] gap-1.5"
            onClick={endRun}
            loading={ending}
          >
            <Square className="h-3 w-3 fill-current" />
            End run
          </Button>
        )}
        <Popover open={compareOpen} onOpenChange={setCompareOpen}>
          <PopoverTrigger asChild>
            <Button
              size="sm"
              className="h-7 text-[11px] gap-1.5"
              disabled={otherRuns.length === 0}
            >
              <GitCompare className="h-3 w-3" />
              Compare
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={4} className="w-72 p-0">
            <div className="px-3 pt-2.5 pb-2 border-b border-border text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Compare {run.name} against
            </div>
            <div className="max-h-64 overflow-y-auto py-1">
              {otherRuns.map((r) => (
                <button
                  key={r.id}
                  onClick={() => {
                    setCompareOpen(false);
                    router.push(`/runs/compare?run=${run.id}&vs=${r.id}`);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-muted/60 transition-colors"
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full shrink-0",
                      STATUS_DOT[r.status],
                    )}
                  />
                  <span className="truncate flex-1 font-medium">{r.name}</span>
                  <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                    {formatDuration(r)}
                  </span>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );

  return (
    <PageWrapper title={titleContent}>
      <div className="flex flex-col h-full">
        {identityRow}
        <div className="flex-1 flex min-h-0">
          {/* Metric grid */}
          <div className="flex-1 overflow-y-auto p-2">
            {!source ? (
              <EmptyState
                icon={LayoutDashboard}
                title="No source attached"
                description="This run isn't tied to a device, so there's no telemetry to show. Runs started from a test script should pass source_id."
                className="h-full"
              />
            ) : metricsLoading || !timeRange ? (
              <div className="flex items-center justify-center h-full">
                <Spinner />
              </div>
            ) : metricNames.length === 0 ? (
              <EmptyState
                icon={LayoutDashboard}
                title="No metrics yet"
                description="The source hasn't reported telemetry for this window."
                className="h-full"
              />
            ) : (
              <TelemetryProvider
                key={`${run.id}-${source.slug}`}
                timeRange={timeRange}
                refreshInterval={run.ended_at ? 0 : 5_000}
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
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                      {panels.map((panel) => (
                        <div
                          key={panel.id}
                          className="h-64 rounded-lg border border-border bg-card overflow-hidden"
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
                  </DashboardInteractionProvider>
                </DashboardStateProvider>
              </TelemetryProvider>
            )}
          </div>

          {/* What happened during it */}
          <aside className="w-72 shrink-0 border-l border-border overflow-y-auto">
            <section className="px-3 py-2.5 border-b border-border">
              <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                <MessageSquare className="h-3 w-3" />
                Annotations
                {runAnnotations.length > 0 && (
                  <span className="tabular-nums">{runAnnotations.length}</span>
                )}
              </div>
              {runAnnotations.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  None during this run. Press A on any chart to annotate.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {runAnnotations.map((a) => (
                    <div key={a.id} className="text-[11px]">
                      <div className="font-medium truncate">{a.label}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">
                        {fmtAbs(a.timestamp_start)}
                        {a.timestamp_end && ` → ${fmtAbs(a.timestamp_end)}`}
                      </div>
                      {a.notes && (
                        <div className="text-[10px] text-muted-foreground truncate">
                          {a.notes}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
            <section className="px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                <Bell className="h-3 w-3" />
                Alerts during run
                {runAlerts.length > 0 && (
                  <span className="tabular-nums">{runAlerts.length}</span>
                )}
              </div>
              {runAlerts.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  No alerts fired inside this window.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {runAlerts.map((a) => (
                    <Link
                      key={a.id}
                      href={`/alerts?selected=${a.id}`}
                      className="block text-[11px] hover:bg-muted/50 -mx-1 px-1 py-0.5 rounded transition-colors"
                    >
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize mr-1.5",
                          a.severity === "critical"
                            ? "bg-red-500/10 text-red-400"
                            : a.severity === "warning"
                              ? "bg-amber-500/10 text-amber-400"
                              : "bg-blue-500/10 text-blue-400",
                        )}
                      >
                        {a.severity}
                      </span>
                      <code className="text-[10px] font-mono">{a.metric}</code>
                      <div className="text-[10px] text-muted-foreground font-mono">
                        {fmtAbs(a.triggered_at)}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </aside>
        </div>
      </div>
    </PageWrapper>
  );
}
