"use client";

/**
 * Runs Page
 *
 * List of test runs — named time windows created by test scripts via
 * /api/runs or saved from a dashboard time-range. Rows open the run's
 * window in a dashboard (replay mode) and can jump to run-compare.
 */

import { useState, useMemo, useCallback, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { StartRunButton } from "@/components/runs/start-run-button";
import { Elapsed } from "@/components/runs/elapsed";
import { Button } from "@/components/ui/button";
import { DeleteButton } from "@/components/ui/delete-button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { PageWrapper } from "@/components/ui/page-wrapper";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import {
  Search,
  FlaskConical,
  GitCompareArrows,
  LayoutDashboard,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useRuns, type Run } from "@/hooks/use-runs";
import { useSourcesSwr } from "@/hooks/use-sources-swr";
import { useDashboardsSwr } from "@/hooks/use-dashboards-swr";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { formatRelativeShort } from "@/lib/format/relative-time";

// =============================================================================
// CONSTANTS
// =============================================================================

type FilterStatus = "all" | Run["status"];

const STATUS_CHIPS: { value: FilterStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "aborted", label: "Aborted" },
];

// =============================================================================
// STATUS BADGE
// =============================================================================

function RunStatusBadge({ status }: { status: Run["status"] }) {
  const map: Record<Run["status"], { label: string; className: string }> = {
    active: { label: "Active", className: "bg-emerald-500/15 text-emerald-500" },
    completed: { label: "Completed", className: "bg-muted text-muted-foreground" },
    aborted: { label: "Aborted", className: "bg-red-500/10 text-red-400" },
  };
  const { label, className } = map[status] ?? map.completed;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium",
        className,
      )}
    >
      {status === "active" && (
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
      )}
      {label}
    </span>
  );
}

// =============================================================================
// HELPERS
// =============================================================================

function durationLabel(run: Run): string {
  if (!run.ended_at) return "—";
  const ms =
    new Date(run.ended_at).getTime() - new Date(run.started_at).getTime();
  if (ms <= 0) return "—";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// A run is a frozen time window. The dashboard already understands frozen
// windows via ?t=<center>&window=<dur> (replay mode) — same contract as
// recording replay: center on the midpoint, size the window to the run's
// duration rounded up to whole minutes (parseRelativeTime accepts \d+m).
function replayHref(dashboardId: string, run: Run): string | null {
  if (!run.ended_at) return null;
  const startMs = new Date(run.started_at).getTime();
  const endMs = new Date(run.ended_at).getTime();
  if (!(endMs > startMs)) return null;
  const center = new Date((startMs + endMs) / 2).toISOString();
  const windowMin = Math.max(1, Math.ceil((endMs - startMs) / 60000));
  return `/dashboards/${dashboardId}?t=${encodeURIComponent(center)}&window=${windowMin}m`;
}

function resultOf(run: Run): boolean | null {
  const r = run.test_result as { passed?: unknown } | null | undefined;
  if (r && typeof r === "object" && typeof r.passed === "boolean") {
    return r.passed;
  }
  return null;
}

// =============================================================================
// MAIN PAGE
// =============================================================================

function RunsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // /runs?new=1 (e.g. from the dashboard Runs navigator) opens Start run.
  const autoOpenStart = searchParams.get("new") === "1";
  const { runs, isLoading, error, deleteRun } = useRuns();
  const { sources } = useSourcesSwr();
  const { dashboards } = useDashboardsSwr();

  const activeRuns = useMemo(
    () => runs.filter((r) => r.status === "active"),
    [runs],
  );

  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Row whose "open in…" dashboard picker is showing (multi-dashboard orgs).
  const [pickerRunId, setPickerRunId] = useState<string | null>(null);

  const sourceById = useMemo(() => {
    const map = new Map<string, { name: string; slug: string }>();
    for (const s of sources) map.set(s.id, { name: s.name ?? s.slug, slug: s.slug });
    return map;
  }, [sources]);

  const filteredRuns = useMemo(() => {
    let result = runs;

    if (filterStatus !== "all") {
      result = result.filter((r) => r.status === filterStatus);
    }

    if (search) {
      const q = search.toLowerCase();
      result = result.filter((r) => {
        const source = r.source_id ? sourceById.get(r.source_id) : null;
        return (
          r.name.toLowerCase().includes(q) ||
          (source
            ? source.slug.toLowerCase().includes(q) ||
              source.name.toLowerCase().includes(q)
            : false)
        );
      });
    }

    // API already orders by started_at DESC; keep it stable here.
    return [...result].sort(
      (a, b) =>
        new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
    );
  }, [runs, filterStatus, search, sourceById]);

  // Row click / keyboard-open → the run's home page.
  const openRun = useCallback(
    (run: Run) => {
      router.push(`/runs/${run.id}`);
    },
    [router],
  );

  // Hover action → replay the run's window in a dashboard (the old row-click).
  const openInDashboard = useCallback(
    (run: Run) => {
      if (!run.ended_at) return; // active runs have no frozen window yet
      if (dashboards.length === 0) return;
      if (dashboards.length === 1) {
        const href = replayHref(dashboards[0].id, run);
        if (href) router.push(href);
        return;
      }
      setPickerRunId(run.id);
    },
    [dashboards, router],
  );

  const { activeIndex, activeRef } = useListNavigation({
    items: filteredRuns,
    onOpen: openRun,
    enabled: true,
  });

  const handleDelete = useCallback(
    async (run: Run) => {
      setDeletingId(run.id);
      try {
        await deleteRun(run.id);
      } catch {
        // toast handled by the hook
      } finally {
        setDeletingId(null);
      }
    },
    [deleteRun],
  );

  const handleCompare = useCallback(
    (run: Run) => {
      // Standalone comparison — no dashboard required. The clicked run is the
      // baseline; the compare page defaults the primary to the latest other.
      router.push(`/runs/compare?vs=${run.id}`);
    },
    [router],
  );

  return (
    <PageWrapper title="Runs" description="Named test-run time windows">
      <div className="flex flex-col h-full">
        <div className="flex-1 flex flex-col overflow-hidden p-2">
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

              {/* Status Chips */}
              {STATUS_CHIPS.map((chip) => {
                const active = filterStatus === chip.value;
                return (
                  <Button
                    key={chip.value}
                    variant={active ? "default" : "outline"}
                    size="sm"
                    onClick={() => setFilterStatus(chip.value)}
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
                {filteredRuns.length} run
                {filteredRuns.length !== 1 ? "s" : ""}
              </span>
            </div>
            <StartRunButton defaultOpen={autoOpenStart} />
          </div>

          {/* Live run banner — any active run, front and center */}
          {activeRuns.map((r) => (
            <Link
              key={r.id}
              href={`/runs/${r.id}`}
              className="flex items-center gap-2 mb-2 px-3 py-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10 transition-colors text-xs"
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
              </span>
              <span className="font-medium truncate">{r.name}</span>
              <span className="text-muted-foreground">
                running <Elapsed since={r.started_at} />
              </span>
              <span className="ml-auto text-muted-foreground">View →</span>
            </Link>
          ))}

          {/* Table */}
          <Card className="flex-1 overflow-hidden">
            <div className="h-full overflow-auto">
              {isLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Spinner className="h-5 w-5 text-muted-foreground" />
                </div>
              ) : error ? (
                <EmptyState
                  icon={FlaskConical}
                  title="Failed to load runs"
                  description="Something went wrong loading your runs"
                  className="h-full"
                />
              ) : filteredRuns.length === 0 ? (
                <EmptyState
                  icon={FlaskConical}
                  title={runs.length === 0 ? "No runs yet" : "No matching runs"}
                  description={
                    runs.length === 0
                      ? "Start a run from a test script via the API, or save a time range as a run from any dashboard."
                      : "Try adjusting your search or filters"
                  }
                  className="h-full"
                />
              ) : (
                <Table className="w-full">
                  <TableHeader className="bg-muted/50 sticky top-0 z-10">
                    <TableRow>
                      {["Name", "Source", "Status", "Duration", "Started", "Result"].map(
                        (col) => (
                          <TableHead
                            key={col}
                            className="text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-3 py-2"
                          >
                            {col}
                          </TableHead>
                        ),
                      )}
                      {/* Hover actions */}
                      <TableHead className="px-3 py-2" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRuns.map((run, index) => {
                      const isActive = activeIndex === index;
                      const source = run.source_id
                        ? sourceById.get(run.source_id)
                        : null;
                      const passed = resultOf(run);

                      return (
                        <Popover
                          key={run.id}
                          open={pickerRunId === run.id}
                          // The trigger's built-in toggle fires on every row
                          // click; only let it open the picker when there is
                          // actually a choice to make (openRun handles the
                          // single-dashboard direct navigation).
                          onOpenChange={(open) =>
                            setPickerRunId(
                              open && dashboards.length > 1 && !!run.ended_at
                                ? run.id
                                : null,
                            )
                          }
                        >
                          <PopoverTrigger asChild>
                            <TableRow
                              ref={
                                isActive
                                  ? (activeRef as React.Ref<HTMLTableRowElement>)
                                  : undefined
                              }
                              onClick={() => openRun(run)}
                              className={cn(
                                "group border-b border-border/50 transition-colors cursor-pointer",
                                isActive ? "bg-accent/50" : "hover:bg-muted/50",
                              )}
                            >
                              {/* Name */}
                              <TableCell className="px-3 py-2.5">
                                <span className="text-sm font-medium truncate max-w-[220px] block">
                                  {run.name}
                                </span>
                              </TableCell>

                              {/* Source */}
                              <TableCell className="px-3 py-2.5">
                                {source ? (
                                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                                    {source.slug}
                                  </code>
                                ) : (
                                  <span className="text-xs text-muted-foreground">
                                    —
                                  </span>
                                )}
                              </TableCell>

                              {/* Status */}
                              <TableCell className="px-3 py-2.5">
                                <RunStatusBadge status={run.status} />
                              </TableCell>

                              {/* Duration */}
                              <TableCell className="px-3 py-2.5">
                                <span className="text-xs text-foreground tabular-nums">
                                  {durationLabel(run)}
                                </span>
                              </TableCell>

                              {/* Started */}
                              <TableCell className="px-3 py-2.5">
                                <span className="text-[10px] text-muted-foreground tabular-nums">
                                  {formatRelativeShort(run.started_at)}
                                </span>
                              </TableCell>

                              {/* Result */}
                              <TableCell className="px-3 py-2.5">
                                {passed === true ? (
                                  <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded font-medium bg-green-500/10 text-green-500">
                                    PASS
                                  </span>
                                ) : passed === false ? (
                                  <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded font-medium bg-red-500/10 text-red-400">
                                    FAIL
                                  </span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">
                                    —
                                  </span>
                                )}
                              </TableCell>

                              {/* Hover actions */}
                              <TableCell
                                className="px-3 py-2.5"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                                  <button
                                    onClick={() => handleCompare(run)}
                                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                                  >
                                    <GitCompareArrows className="h-3 w-3" />
                                    Compare
                                  </button>
                                  {dashboards.length > 0 && run.ended_at && (
                                    <button
                                      onClick={() => openInDashboard(run)}
                                      title="Replay this window in a dashboard"
                                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                                    >
                                      <LayoutDashboard className="h-3 w-3" />
                                    </button>
                                  )}
                                  <DeleteButton
                                    entityName={run.name}
                                    onConfirm={() => handleDelete(run)}
                                    loading={deletingId === run.id}
                                  />
                                </div>
                              </TableCell>
                            </TableRow>
                          </PopoverTrigger>

                          {/* Dashboard picker — only reachable when the org
                              has multiple dashboards (openRun gates it). */}
                          <PopoverContent align="end" className="w-56 p-1">
                            <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                              Replay window in…
                            </div>
                            <div className="max-h-64 overflow-y-auto">
                              {dashboards.map((d) => {
                                const href = replayHref(d.id, run);
                                return (
                                  <button
                                    key={d.id}
                                    disabled={!href}
                                    onClick={() => {
                                      setPickerRunId(null);
                                      if (href) router.push(href);
                                    }}
                                    className="w-full text-left px-2 py-1.5 rounded text-xs text-foreground hover:bg-muted truncate disabled:opacity-50"
                                  >
                                    {d.name}
                                  </button>
                                );
                              })}
                            </div>
                          </PopoverContent>
                        </Popover>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          </Card>
        </div>
      </div>
    </PageWrapper>
  );
}

export default function RunsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full py-12">
          <Spinner />
        </div>
      }
    >
      <RunsPageInner />
    </Suspense>
  );
}
