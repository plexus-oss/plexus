"use client";

/**
 * Fleet — one row per source: is it streaming, are its monitors healthy, does
 * it have open alerts, how noisy is it. Answers "what's working and what needs
 * me" across every connection and device in one view. Composes useSources
 * (status), useMonitors (per-source health), useFleetHealth (throughput) and
 * useFleetOverview (open-alert + noise tallies, platform loop health).
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import {
  Search,
  CheckCircle2,
  AlertTriangle,
  MinusCircle,
  Radio,
  Plug,
  Cpu,
  Activity,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useSources } from "@/hooks/use-sources";
import { useMonitors } from "@/hooks/use-monitors";
import type { Monitor } from "@/hooks/use-monitors";
import { useFleetHealth } from "@/hooks/use-fleet-health";
import { useFleetOverview } from "@/hooks/use-fleet-overview";

type Filter = "all" | "attention" | "connection" | "device";

interface FleetRow {
  id: string;
  slug: string;
  name: string;
  type: string;
  status: string;
  lastDataAt: string | null;
  monitors: {
    total: number;
    working: number;
    skipped: number;
    failing: number;
    pending: number;
  };
  openAlerts: number;
  noise: number;
  noiseTotal: number;
  /** Higher = more it needs a human. Drives the default sort. */
  concern: number;
}

function rollupMonitors(monitors: Monitor[]) {
  const r = { total: 0, working: 0, skipped: 0, failing: 0, pending: 0 };
  for (const m of monitors) {
    r.total++;
    const state = m.health?.state;
    if (state === "working") r.working++;
    else if (state === "skipped") r.skipped++;
    else if (state === "failing") r.failing++;
    else if (state === "pending") r.pending++;
  }
  return r;
}

// A source's "needs a human" score: failing monitors dominate, then being
// offline, then open alerts, then silently-skipped monitors.
function concernScore(row: Omit<FleetRow, "concern">): number {
  let score = 0;
  score += row.monitors.failing * 1000;
  if (row.status === "error") score += 800;
  if (row.status === "offline") score += 400;
  score += row.openAlerts * 100;
  score += row.monitors.skipped * 40;
  return score;
}

export default function FleetPage() {
  const router = useRouter();
  const { sources, isLoading: sourcesLoading } = useSources();
  const { monitors } = useMonitors();
  const { fleet } = useFleetHealth();
  const { alertsBySource, platform } = useFleetOverview();

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const rows = useMemo<FleetRow[]>(() => {
    // Index the composable slices by their join key.
    const monitorsBySource = new Map<string, Monitor[]>();
    for (const m of monitors) {
      const list = monitorsBySource.get(m.source_id) ?? [];
      list.push(m);
      monitorsBySource.set(m.source_id, list);
    }
    const lastDataBySlug = new Map(fleet.map((f) => [f.source_id, f.last_data_at]));
    const alertsById = new Map(alertsBySource.map((a) => [a.source_id, a]));

    return sources.map((s) => {
      const mon = rollupMonitors(monitorsBySource.get(s.id) ?? []);
      const alert = alertsById.get(s.id);
      const base = {
        id: s.id,
        slug: s.slug,
        name: s.name || s.slug,
        type: s.source_type,
        status: s.status,
        lastDataAt: lastDataBySlug.get(s.slug) ?? null,
        monitors: mon,
        openAlerts: alert?.open ?? 0,
        noise: alert?.noise ?? 0,
        noiseTotal: alert?.noise_total ?? 0,
      };
      return { ...base, concern: concernScore(base) };
    });
  }, [sources, monitors, fleet, alertsBySource]);

  const filtered = useMemo(() => {
    let result = rows;
    if (filter === "attention") result = result.filter((r) => r.concern > 0);
    else if (filter === "connection")
      result = result.filter((r) => r.type === "connection");
    else if (filter === "device")
      result = result.filter((r) => r.type === "device");

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (r) =>
          r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q),
      );
    }
    // Problems first; within the same concern, streaming/named order is stable.
    return [...result].sort(
      (a, b) => b.concern - a.concern || a.name.localeCompare(b.name),
    );
  }, [rows, filter, search]);

  const summary = useMemo(() => {
    const online = rows.filter((r) => r.status === "online").length;
    const failing = rows.reduce((n, r) => n + r.monitors.failing, 0);
    const skipped = rows.reduce((n, r) => n + r.monitors.skipped, 0);
    const openAlerts = rows.reduce((n, r) => n + r.openAlerts, 0);
    return { total: rows.length, online, failing, skipped, openAlerts };
  }, [rows]);

  const FILTERS: { value: Filter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "attention", label: "Needs attention" },
    { value: "connection", label: "Connections" },
    { value: "device", label: "Devices" },
  ];

  return (
    <div className="flex flex-col h-full p-2 gap-2">
      {/* Summary + platform health */}
      <div className="flex flex-wrap items-stretch gap-2">
        <StatTile label="Sources" value={summary.total} />
        <StatTile
          label="Online"
          value={summary.online}
          tone={summary.online < summary.total ? "muted" : "good"}
        />
        <StatTile
          label="Monitors failing"
          value={summary.failing}
          tone={summary.failing > 0 ? "bad" : "good"}
        />
        <StatTile
          label="Skipped"
          value={summary.skipped}
          tone={summary.skipped > 0 ? "warn" : "good"}
        />
        <StatTile
          label="Open alerts"
          value={summary.openAlerts}
          tone={summary.openAlerts > 0 ? "warn" : "good"}
        />
        <PlatformTile platform={platform} />
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            placeholder="Search sources..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-7 h-8 w-52"
          />
        </div>
        <div className="w-px h-5 bg-border" />
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            variant={filter === f.value ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(f.value)}
            className={cn(
              "px-2 py-0.5 rounded-full text-[11px] h-auto",
              filter === f.value
                ? "bg-foreground text-background border-foreground hover:bg-foreground/90"
                : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/50",
            )}
          >
            {f.label}
          </Button>
        ))}
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {filtered.length} source{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <Card className="flex-1 overflow-hidden">
        <div className="h-full overflow-auto">
          {sourcesLoading ? (
            <div className="flex items-center justify-center h-full">
              <Spinner className="h-5 w-5 text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Activity}
              title={
                rows.length === 0 ? "No sources yet" : "No matching sources"
              }
              description={
                rows.length === 0
                  ? "Connect a data source or device to see it here."
                  : "Try adjusting your search or filter."
              }
              className="h-full"
            />
          ) : (
            <Table className="w-full">
              <TableHeader className="bg-muted/50 sticky top-0 z-10">
                <TableRow>
                  <Th>Source</Th>
                  <Th>Status</Th>
                  <Th>Last data</Th>
                  <Th>Monitors</Th>
                  <Th>Open alerts</Th>
                  <Th>Noise</Th>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <TableRow
                    key={row.id}
                    onClick={() => router.push(`/devices/${row.slug}`)}
                    className="border-b border-border/50 cursor-pointer hover:bg-muted/50 transition-colors"
                  >
                    <TableCell className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        {row.type === "connection" ? (
                          <Plug className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        ) : (
                          <Cpu className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate max-w-[200px]">
                            {row.name}
                          </div>
                          <code className="text-[10px] text-muted-foreground font-mono">
                            {row.slug}
                          </code>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      <StatusPill status={row.status} />
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        {row.lastDataAt
                          ? formatDistanceToNow(new Date(row.lastDataAt), {
                              addSuffix: true,
                            })
                          : "—"}
                      </span>
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      <MonitorRollup m={row.monitors} />
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      {row.openAlerts > 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400 tabular-nums">
                          <AlertTriangle className="h-3 w-3" />
                          {row.openAlerts}
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">
                          None
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      <NoiseCell noise={row.noise} total={row.noiseTotal} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </Card>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <TableHead className="text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-3 py-2">
      {children}
    </TableHead>
  );
}

function StatTile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "good" | "warn" | "bad" | "muted";
}) {
  const toneClass =
    tone === "bad"
      ? "text-red-600 dark:text-red-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "muted"
          ? "text-muted-foreground"
          : "text-foreground";
  return (
    <div className="flex flex-col justify-center rounded-lg border border-border/60 bg-card px-3 py-2 min-w-[92px]">
      <span className={cn("text-lg font-semibold tabular-nums", toneClass)}>
        {value}
      </span>
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
    </div>
  );
}

function PlatformTile({
  platform,
}: {
  platform: ReturnType<typeof useFleetOverview>["platform"];
}) {
  if (!platform) return null;
  const loops = ["poll", "drain", "offline"];
  const healthy = platform.started && platform.stale.length === 0;
  return (
    <div className="flex flex-col justify-center rounded-lg border border-border/60 bg-card px-3 py-2 min-w-[140px]">
      <div className="flex items-center gap-1.5">
        <Radio
          className={cn(
            "h-3.5 w-3.5",
            !platform.started
              ? "text-muted-foreground"
              : healthy
                ? "text-emerald-500"
                : "text-red-500",
          )}
        />
        <span className="text-sm font-semibold">
          {!platform.started
            ? "Starting"
            : healthy
              ? "Healthy"
              : "Degraded"}
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5">
        {loops.map((name) => (
          <span
            key={name}
            title={
              platform.stale.includes(name)
                ? `${name} loop is stale`
                : `${name} loop ok`
            }
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              !platform.started
                ? "bg-muted-foreground/40"
                : platform.stale.includes(name)
                  ? "bg-red-500"
                  : "bg-emerald-500",
            )}
          />
        ))}
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider ml-0.5">
          Platform
        </span>
      </div>
    </div>
  );
}

const STATUS_STYLES: Record<
  string,
  { label: string; className: string }
> = {
  online: {
    label: "Online",
    className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  },
  offline: {
    label: "Offline",
    className: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
  },
  error: {
    label: "Error",
    className: "bg-red-500/15 text-red-600 dark:text-red-400",
  },
  pending: {
    label: "Pending",
    className: "bg-muted text-muted-foreground",
  },
};

function StatusPill({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.pending;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
        s.className,
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status === "online"
            ? "bg-emerald-500"
            : status === "error"
              ? "bg-red-500"
              : status === "offline"
                ? "bg-zinc-400"
                : "bg-muted-foreground/50",
        )}
      />
      {s.label}
    </span>
  );
}

function MonitorRollup({ m }: { m: FleetRow["monitors"] }) {
  if (m.total === 0) {
    return <span className="text-[11px] text-muted-foreground">None</span>;
  }
  // Lead with the most alarming state; the rest is available on the monitors tab.
  if (m.failing > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
        <AlertTriangle className="h-3 w-3" />
        {m.failing} failing
        <span className="text-muted-foreground font-normal">
          of {m.total}
        </span>
      </span>
    );
  }
  if (m.skipped > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
        <AlertTriangle className="h-3 w-3" />
        {m.skipped} skipped
        <span className="text-muted-foreground font-normal">
          of {m.total}
        </span>
      </span>
    );
  }
  if (m.working > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3 w-3" />
        {m.working} working
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <MinusCircle className="h-3 w-3" />
      {m.pending} pending
    </span>
  );
}

function NoiseCell({ noise, total }: { noise: number; total: number }) {
  if (total === 0) {
    return <span className="text-[11px] text-muted-foreground">—</span>;
  }
  const pct = Math.round((noise / total) * 100);
  const loud = pct >= 50;
  return (
    <span
      title={`${noise} of ${total} recent alerts marked noise`}
      className={cn(
        "text-xs tabular-nums",
        loud ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
      )}
    >
      {pct}%
    </span>
  );
}
