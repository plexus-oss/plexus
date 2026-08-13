"use client";

/**
 * Intelligence — model observability for the labeling loop.
 *
 * One page answering "is the model performing, what is it retrieving, and
 * what are humans teaching it": a 7-day summary strip, the recent inference
 * runs (each row opens a read-only detail sheet with the retrieval record and
 * per-proposal verdicts), and the model's own memory (context notes it asked
 * to remember, deletable here). Data: GET /api/intelligence.
 */

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { format } from "date-fns";
import { ArrowRight, Brain, Sparkles } from "lucide-react";
import { PageWrapper } from "@/components/ui/page-wrapper";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { DeleteButton } from "@/components/ui/delete-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { fetcher } from "@/lib/fetcher";
import { toast } from "@/lib/toast-utils";
import { cn } from "@/lib/utils";
import { formatRelativeShort } from "@/lib/format/relative-time";
import type { LabelRunStats } from "@/lib/ai/label/run-stats";

// =============================================================================
// API payload types (see app/api/intelligence/route.ts)
// =============================================================================

interface RunObservation {
  label: string;
  note: string | null;
  start_ms: number | null;
  end_ms: number | null;
  confidence: "low" | "medium" | "high" | null;
  kind: "label" | "remember";
  verdict: "applied" | "dismissed" | null;
  verdict_at: string | null;
}

interface RunContextItem {
  id: string;
  slug: string;
  name: string;
  chars: number;
}

interface LabelRun {
  id: string;
  created_at: string;
  provider: string | null;
  model: string | null;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  metrics: string[];
  window_start: string | null;
  window_end: string | null;
  context_items: RunContextItem[];
  observations: RunObservation[];
}

interface MemoryItem {
  id: string;
  source_id: string;
  source_slug: string;
  source_name: string | null;
  source_type: string;
  content: string | null;
  created_at: string | null;
}

interface IntelligencePayload {
  stats: LabelRunStats;
  runs: LabelRun[];
  sources: Record<string, { name: string | null; type: string }>;
  memory: MemoryItem[];
}

// =============================================================================
// Formatting
// =============================================================================

const fmtLatency = (ms: number | null): string => {
  if (ms == null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
};

const fmtTokens = (n: number): string =>
  n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString();

const runTokens = (r: LabelRun): number | null =>
  r.input_tokens == null && r.output_tokens == null
    ? null
    : (r.input_tokens ?? 0) + (r.output_tokens ?? 0);

const uniqueSlugs = (metrics: string[]): string[] => [
  ...new Set(metrics.map((m) => m.slice(0, m.indexOf(":")))),
];

const sourceHref = (slug: string, type: string | undefined): string =>
  type === "connection" ? `/connections/${slug}` : `/devices/${slug}`;

function verdictSummary(observations: RunObservation[]): string {
  let applied = 0;
  let dismissed = 0;
  let pending = 0;
  for (const o of observations) {
    if (o.verdict === "applied") applied += 1;
    else if (o.verdict === "dismissed") dismissed += 1;
    else pending += 1;
  }
  const parts: string[] = [];
  if (applied) parts.push(`${applied} applied`);
  if (dismissed) parts.push(`${dismissed} dismissed`);
  if (pending) parts.push(`${pending} pending`);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

// =============================================================================
// Page
// =============================================================================

export default function IntelligencePage() {
  const { data, isLoading, mutate } = useSWR<IntelligencePayload>(
    "/api/intelligence",
    fetcher,
  );
  const [selectedRun, setSelectedRun] = useState<LabelRun | null>(null);

  const handleDeleteMemory = async (item: MemoryItem) => {
    try {
      const res = await fetch(
        `/api/sources/${item.source_id}/context/${item.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      toast.success("Memory deleted");
      await mutate();
    } catch {
      toast.error("Failed to delete memory");
    }
  };

  return (
    <PageWrapper
      title="Intelligence"
      description="How the labeling model is performing"
    >
      <div className="flex flex-col h-full">
        <div className="flex-1 flex flex-col overflow-hidden p-2">
          {isLoading || !data ? (
            <div className="flex items-center justify-center h-full">
              <Spinner className="h-5 w-5 text-muted-foreground" />
            </div>
          ) : (
            <>
              <SummaryBar stats={data.stats} />

              {/* Runs */}
              <Card className="flex-1 min-h-0 overflow-hidden">
                <div className="h-full overflow-auto">
                  {data.runs.length === 0 ? (
                    <EmptyState
                      icon={Sparkles}
                      title="No runs yet"
                      description="Use Label on a chart panel to get the first proposals."
                      className="h-full"
                    />
                  ) : (
                    <RunsTable
                      runs={data.runs}
                      sources={data.sources}
                      onSelect={setSelectedRun}
                    />
                  )}
                </div>
              </Card>

              <MemorySection
                memory={data.memory}
                onDelete={handleDeleteMemory}
              />
            </>
          )}
        </div>
      </div>

      <RunDetailSheet
        run={selectedRun}
        sources={data?.sources ?? {}}
        onOpenChange={(open) => {
          if (!open) setSelectedRun(null);
        }}
      />
    </PageWrapper>
  );
}

// =============================================================================
// Summary strip (filter-bar idiom — see /runs, /alerts/monitors)
// =============================================================================

function SummaryBar({ stats }: { stats: LabelRunStats }) {
  const providers = Object.keys(stats.tokensByProvider);
  const tokensNote =
    providers.length > 1
      ? providers
          .map((p) => `${p} ${fmtTokens(stats.tokensByProvider[p])}`)
          .join(" · ")
      : null;

  return (
    <div className="flex items-center gap-2 mb-2 flex-wrap">
      <SummaryStat
        value={String(stats.runs)}
        label={stats.runs === 1 ? "run" : "runs"}
      />

      <div className="w-px h-5 bg-border" />

      {stats.acceptanceRate == null ? (
        <span className="text-[10px] text-muted-foreground">
          no verdicts yet
        </span>
      ) : (
        <SummaryStat
          value={`${Math.round(stats.acceptanceRate * 100)}%`}
          label={`accepted · ${stats.applied} applied · ${stats.dismissed} dismissed`}
        />
      )}

      <div className="w-px h-5 bg-border" />

      <SummaryStat value={fmtLatency(stats.medianLatencyMs)} label="median" />

      <div className="w-px h-5 bg-border" />

      <SummaryStat
        value={fmtTokens(stats.tokens)}
        label={tokensNote ? `tokens · ${tokensNote}` : "tokens"}
      />

      <span className="ml-auto text-[10px] text-muted-foreground">
        Last 7 days
      </span>
    </div>
  );
}

function SummaryStat({ value, label }: { value: string; label: string }) {
  return (
    <span className="text-[10px] text-muted-foreground tabular-nums">
      <span className="text-foreground font-medium">{value}</span> {label}
    </span>
  );
}

// =============================================================================
// Runs table (table idiom — see /runs, /alerts/monitors)
// =============================================================================

function RunsTable({
  runs,
  sources,
  onSelect,
}: {
  runs: LabelRun[];
  sources: IntelligencePayload["sources"];
  onSelect: (run: LabelRun) => void;
}) {
  return (
    <Table className="w-full">
      <TableHeader className="bg-muted/50 sticky top-0 z-10">
        <TableRow>
          {[
            "Source",
            "Model",
            "Latency",
            "Tokens",
            "Proposals",
            "Verdicts",
            "Context",
            "When",
          ].map((col) => (
            <TableHead
              key={col}
              className="text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-3 py-2"
            >
              {col}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => {
          const slugs = uniqueSlugs(run.metrics);
          const tokens = runTokens(run);
          return (
            <TableRow
              key={run.id}
              onClick={() => onSelect(run)}
              className="border-b border-border/50 transition-colors cursor-pointer hover:bg-muted/50"
            >
              {/* Source / metrics */}
              <TableCell className="px-3 py-2.5">
                <span className="text-sm font-medium truncate max-w-[220px] inline-block align-middle">
                  {slugs.map((s) => sources[s]?.name || s).join(", ")}
                </span>
                <span className="text-xs text-muted-foreground align-middle">
                  {" "}
                  · {run.metrics.length} metric
                  {run.metrics.length !== 1 ? "s" : ""}
                </span>
              </TableCell>

              {/* Model */}
              <TableCell className="px-3 py-2.5 whitespace-nowrap">
                {run.model ? (
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                    {run.model}
                  </code>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {run.provider ?? "—"}
                  </span>
                )}
              </TableCell>

              {/* Latency */}
              <TableCell className="px-3 py-2.5">
                <span className="text-xs text-foreground tabular-nums">
                  {fmtLatency(run.latency_ms)}
                </span>
              </TableCell>

              {/* Tokens */}
              <TableCell className="px-3 py-2.5">
                <span className="text-xs text-foreground tabular-nums">
                  {tokens == null ? "—" : fmtTokens(tokens)}
                </span>
              </TableCell>

              {/* Proposals */}
              <TableCell className="px-3 py-2.5">
                <span className="text-xs text-foreground tabular-nums">
                  {run.observations.length}
                </span>
              </TableCell>

              {/* Verdicts */}
              <TableCell className="px-3 py-2.5 whitespace-nowrap">
                <span className="text-xs text-muted-foreground">
                  {verdictSummary(run.observations)}
                </span>
              </TableCell>

              {/* Context */}
              <TableCell className="px-3 py-2.5">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {run.context_items.length > 0
                    ? `${run.context_items.length} item${
                        run.context_items.length !== 1 ? "s" : ""
                      }`
                    : "—"}
                </span>
              </TableCell>

              {/* When */}
              <TableCell className="px-3 py-2.5">
                <span
                  className="text-[10px] text-muted-foreground tabular-nums"
                  title={new Date(run.created_at).toISOString()}
                >
                  {formatRelativeShort(run.created_at)}
                </span>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

// =============================================================================
// Run detail sheet (read-only — rhythm matches column-metadata-sheet)
// =============================================================================

function RunDetailSheet({
  run,
  sources,
  onOpenChange,
}: {
  run: LabelRun | null;
  sources: IntelligencePayload["sources"];
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={run !== null} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
        {run && (
          <>
            <SheetHeader className="border-b border-border px-6 py-4">
              <SheetTitle className="text-sm">Labeling run</SheetTitle>
              <SheetDescription>
                {format(new Date(run.created_at), "MMM d, yyyy 'at' HH:mm:ss")}
                {" · "}
                {run.provider ?? "unknown provider"}
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 px-6 py-5 space-y-5">
              {/* Performance */}
              <div>
                <DetailHeading>Run</DetailHeading>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <DetailField label="Model">
                    <span className="font-mono text-[11px]">
                      {run.model ?? "—"}
                    </span>
                  </DetailField>
                  <DetailField label="Latency">
                    {fmtLatency(run.latency_ms)}
                  </DetailField>
                  <DetailField label="Tokens in / out">
                    {run.input_tokens ?? "—"} / {run.output_tokens ?? "—"}
                  </DetailField>
                  <DetailField label="Window">
                    {run.window_start && run.window_end
                      ? `${format(new Date(run.window_start), "MMM d, HH:mm")} – ${format(
                          new Date(run.window_end),
                          "HH:mm",
                        )}`
                      : "—"}
                  </DetailField>
                </div>
              </div>

              {/* Metrics */}
              <div>
                <DetailHeading>Metrics</DetailHeading>
                <div className="flex flex-wrap gap-1">
                  {run.metrics.map((m) => (
                    <code
                      key={m}
                      className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono text-muted-foreground"
                    >
                      {m}
                    </code>
                  ))}
                </div>
              </div>

              {/* Retrieval record */}
              <div className="pt-4 border-t border-border/50">
                <DetailHeading>Context used</DetailHeading>
                {run.context_items.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No source context was included in this prompt.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {run.context_items.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-3 text-xs"
                      >
                        <span className="truncate">
                          {item.name}
                          <span className="text-muted-foreground">
                            {" "}
                            · {item.chars} chars
                          </span>
                        </span>
                        <Link
                          href={sourceHref(item.slug, sources[item.slug]?.type)}
                          className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground transition-colors shrink-0"
                        >
                          {item.slug}
                          <ArrowRight className="h-3 w-3" />
                        </Link>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Proposals + verdicts */}
              <div className="pt-4 border-t border-border/50">
                <DetailHeading>Proposals</DetailHeading>
                {run.observations.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    The model proposed nothing for this window.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {run.observations.map((o, i) => (
                      <div
                        key={i}
                        className="p-3 rounded-lg bg-muted/30 border border-border/50 space-y-1"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-medium leading-tight">
                            {o.label}
                          </span>
                          <VerdictBadge verdict={o.verdict} />
                        </div>
                        {o.note && (
                          <p className="text-xs text-muted-foreground">
                            {o.note}
                          </p>
                        )}
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          {o.kind === "remember" ? (
                            <span className="inline-flex items-center gap-1">
                              <Brain className="h-3 w-3" />
                              remember
                            </span>
                          ) : (
                            <>
                              {o.confidence && <span>{o.confidence}</span>}
                              {o.start_ms != null && (
                                <span className="font-mono tabular-nums">
                                  {format(new Date(o.start_ms), "HH:mm:ss")}
                                  {o.end_ms != null &&
                                    ` – ${format(new Date(o.end_ms), "HH:mm:ss")}`}
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DetailHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">
      {children}
    </div>
  );
}

function DetailField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className="text-muted-foreground">{label}</span>
      <div className="mt-0.5 tabular-nums">{children}</div>
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: RunObservation["verdict"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0",
        verdict === "applied"
          ? "bg-green-500/10 text-green-500"
          : verdict === "dismissed"
            ? "bg-muted text-muted-foreground"
            : "bg-amber-500/10 text-amber-500",
      )}
    >
      {verdict === "applied"
        ? "Applied"
        : verdict === "dismissed"
          ? "Dismissed"
          : "Pending"}
    </span>
  );
}

// =============================================================================
// Model memory
// =============================================================================

function MemorySection({
  memory,
  onDelete,
}: {
  memory: MemoryItem[];
  onDelete: (item: MemoryItem) => void;
}) {
  return (
    <div className="shrink-0 mt-2 max-h-[35%] flex flex-col">
      <div className="flex items-center gap-2 mb-2 shrink-0">
        <h2 className="text-sm font-medium">Model memory</h2>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {memory.length} remembered
        </span>
      </div>
      <Card className="min-h-0 overflow-y-auto">
        {memory.length === 0 ? (
          <p className="text-xs text-muted-foreground px-3 py-3">
            Nothing remembered yet — apply a Remember proposal to save one. The
            model retrieves these facts into every future run.
          </p>
        ) : (
          <ul>
            {memory.map((item) => (
              <li
                key={item.id}
                className="group flex items-start gap-2.5 px-3 py-2 border-b border-border/40 last:border-b-0"
              >
                <Brain className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs whitespace-pre-wrap">{item.content}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    <Link
                      href={sourceHref(item.source_slug, item.source_type)}
                      className="font-mono hover:text-foreground transition-colors"
                    >
                      {item.source_name || item.source_slug}
                    </Link>
                    {item.created_at && (
                      <span className="tabular-nums">
                        {" · "}
                        {formatRelativeShort(item.created_at)}
                      </span>
                    )}
                  </p>
                </div>
                <DeleteButton
                  entityName="this memory"
                  confirmDescription="The model will no longer see this fact in future runs."
                  onConfirm={() => onDelete(item)}
                  className="shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
