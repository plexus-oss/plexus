"use client";

/**
 * Intelligence — model observability for the labeling loop.
 *
 * One page answering "is the model performing, what is it retrieving, and
 * what are humans teaching it": 7-day stat cards, the recent inference runs
 * (each row opens a read-only detail sheet with the retrieval record and
 * per-proposal verdicts), and the model's own memory (context notes it asked
 * to remember, deletable here). Data: GET /api/intelligence.
 */

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { format } from "date-fns";
import { ArrowRight, Brain } from "lucide-react";
import { PageWrapper } from "@/components/ui/page-wrapper";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
      {isLoading || !data ? (
        <div className="flex items-center justify-center h-full">
          <Spinner className="h-5 w-5 text-muted-foreground" />
        </div>
      ) : (
        <div className="p-4 space-y-6 max-w-6xl mx-auto">
          <StatCards stats={data.stats} />
          <RunsSection
            runs={data.runs}
            sources={data.sources}
            onSelect={setSelectedRun}
          />
          <MemorySection memory={data.memory} onDelete={handleDeleteMemory} />
        </div>
      )}

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
// Stat cards
// =============================================================================

function StatCards({ stats }: { stats: LabelRunStats }) {
  const providers = Object.keys(stats.tokensByProvider);
  const tokensNote =
    providers.length > 1
      ? providers
          .map((p) => `${p} ${fmtTokens(stats.tokensByProvider[p])}`)
          .join(" · ")
      : null;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
      <StatCard label="Runs (7d)" value={String(stats.runs)} />
      <StatCard
        label="Acceptance rate (7d)"
        value={
          stats.acceptanceRate == null
            ? "—"
            : `${Math.round(stats.acceptanceRate * 100)}%`
        }
        note={
          stats.acceptanceRate == null
            ? "no verdicts yet"
            : `${stats.applied} applied · ${stats.dismissed} dismissed`
        }
      />
      <StatCard
        label="Median latency (7d)"
        value={fmtLatency(stats.medianLatencyMs)}
      />
      <StatCard
        label="Tokens (7d)"
        value={fmtTokens(stats.tokens)}
        note={tokensNote}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string | null;
}) {
  return (
    <Card className="p-3">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {note && (
        <div className="mt-0.5 text-[11px] text-muted-foreground truncate">
          {note}
        </div>
      )}
    </Card>
  );
}

// =============================================================================
// Runs table
// =============================================================================

function RunsSection({
  runs,
  sources,
  onSelect,
}: {
  runs: LabelRun[];
  sources: IntelligencePayload["sources"];
  onSelect: (run: LabelRun) => void;
}) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-sm font-medium">Runs</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Every inference call — what went in, what came out, what you decided
        </p>
      </div>
      {runs.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">
          No runs yet — use Label on a chart panel to get the first proposals.
        </p>
      ) : (
        <Card className="p-0 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-xs">Time</TableHead>
                <TableHead className="text-xs">Source / metrics</TableHead>
                <TableHead className="text-xs">Model</TableHead>
                <TableHead className="text-xs text-right">Latency</TableHead>
                <TableHead className="text-xs text-right">Tokens</TableHead>
                <TableHead className="text-xs text-right">Proposals</TableHead>
                <TableHead className="text-xs">Verdicts</TableHead>
                <TableHead className="text-xs">Context</TableHead>
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
                    className="cursor-pointer text-xs"
                  >
                    <TableCell className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                      {format(new Date(run.created_at), "MMM d, HH:mm:ss")}
                    </TableCell>
                    <TableCell className="max-w-[220px]">
                      <span className="truncate block">
                        {slugs
                          .map((s) => sources[s]?.name || s)
                          .join(", ")}
                        <span className="text-muted-foreground">
                          {" "}
                          · {run.metrics.length} metric
                          {run.metrics.length !== 1 ? "s" : ""}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span className="text-muted-foreground">
                        {run.provider ?? "—"}
                      </span>{" "}
                      <span className="font-mono text-[11px]">
                        {run.model ?? ""}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap">
                      {fmtLatency(run.latency_ms)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap">
                      {tokens == null ? "—" : fmtTokens(tokens)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {run.observations.length}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {verdictSummary(run.observations)}
                    </TableCell>
                    <TableCell>
                      {run.context_items.length > 0 ? (
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0 text-muted-foreground"
                        >
                          {run.context_items.length} item
                          {run.context_items.length !== 1 ? "s" : ""}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </section>
  );
}

// =============================================================================
// Run detail sheet (read-only)
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

            <div className="flex-1 px-6 py-5 space-y-6">
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
                    <Badge
                      key={m}
                      variant="outline"
                      className="font-mono text-[10px] px-1.5 py-0 text-muted-foreground"
                    >
                      {m}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Retrieval record */}
              <div>
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
                          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors shrink-0"
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
              <div>
                <DetailHeading>Proposals</DetailHeading>
                {run.observations.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    The model proposed nothing for this window.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {run.observations.map((o, i) => (
                      <div
                        key={i}
                        className="rounded-md border border-border p-2.5 space-y-1"
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
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          {o.kind === "remember" ? (
                            <span className="inline-flex items-center gap-1">
                              <Brain className="h-3 w-3" />
                              remember
                            </span>
                          ) : (
                            <>
                              {o.confidence && <span>{o.confidence}</span>}
                              {o.start_ms != null && (
                                <span className="font-mono">
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
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] px-1.5 py-0 shrink-0",
        verdict === "applied"
          ? "text-green-600 dark:text-green-400 border-green-500/40"
          : verdict === "dismissed"
            ? "text-muted-foreground"
            : "text-amber-600 dark:text-amber-400 border-amber-500/40",
      )}
    >
      {verdict ?? "pending"}
    </Badge>
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
    <section className="space-y-2">
      <div>
        <h2 className="text-sm font-medium">Model memory</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Facts the model asked to remember — these are retrieved into every
          future run.
        </p>
      </div>
      {memory.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">
          Nothing remembered yet — apply a Remember proposal to save one.
        </p>
      ) : (
        <div className="space-y-2">
          {memory.map((item) => (
            <Card key={item.id} className="p-3 flex items-start gap-3">
              <div className="p-2 rounded-lg bg-muted shrink-0">
                <Brain className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm whitespace-pre-wrap">{item.content}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  <Link
                    href={sourceHref(item.source_slug, item.source_type)}
                    className="hover:text-foreground transition-colors"
                  >
                    {item.source_name || item.source_slug}
                  </Link>
                  {item.created_at && (
                    <>
                      {" · "}
                      {format(new Date(item.created_at), "MMM d, yyyy")}
                    </>
                  )}
                </p>
              </div>
              <DeleteButton
                entityName="this memory"
                confirmDescription="The model will no longer see this fact in future runs."
                onConfirm={() => onDelete(item)}
                className="shrink-0"
              />
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
