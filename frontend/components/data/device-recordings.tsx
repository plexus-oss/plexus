"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { Circle, LayoutDashboard, Play, Video } from "lucide-react";
import type { Recording } from "@/lib/db/queries/recordings";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { VideoPlayer } from "@/components/ui/video-player";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useDashboardsSwr } from "@/hooks/use-dashboards-swr";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ── Status badge ────────────────────────────────────────────────────────────

export function RecordingStatusBadge({ status }: { status: Recording["status"] }) {
  const map: Record<Recording["status"], { label: string; className: string }> = {
    requested: { label: "Requested", className: "bg-muted text-muted-foreground" },
    recording: { label: "Recording", className: "bg-red-500/15 text-red-500" },
    stop_requested: { label: "Stopping", className: "bg-yellow-500/15 text-yellow-600" },
    done: { label: "Done", className: "bg-green-500/15 text-green-600" },
    error: { label: "Error", className: "bg-destructive/15 text-destructive" },
  };
  const { label, className } = map[status] ?? map.error;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium", className)}>
      {status === "recording" && (
        <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
      )}
      {label}
    </span>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function durationLabel(r: Recording): string {
  if (!r.started_at) return "—";
  const end = r.finished_at ? new Date(r.finished_at).getTime() : Date.now();
  const ms = end - new Date(r.started_at).getTime();
  if (ms <= 0) return "—";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function relative(iso: string | null): string {
  if (!iso) return "—";
  return formatDistanceToNow(new Date(iso), { addSuffix: true });
}

const TERMINAL_STATUSES = new Set<Recording["status"]>(["done", "error"]);

// ── Open in dashboard ─────────────────────────────────────────────────────────
// A recording is a frozen time window. The dashboard already understands frozen
// windows via ?t=<center>&window=<dur> (replay mode), so we hand it the
// recording's span and let every telemetry panel scrub alongside the video.

function replayHref(dashboardId: string, r: Recording): string | null {
  if (!r.started_at || !r.finished_at) return null;
  const startMs = new Date(r.started_at).getTime();
  const endMs = new Date(r.finished_at).getTime();
  if (!(endMs > startMs)) return null;
  const center = new Date((startMs + endMs) / 2).toISOString();
  // parseRelativeTime accepts \d+m — minutes exactly covers the span.
  const windowMin = Math.max(1, Math.ceil((endMs - startMs) / 60000));
  return `/dashboards/${dashboardId}?t=${encodeURIComponent(center)}&window=${windowMin}m`;
}

function OpenInDashboard({ recording }: { recording: Recording }) {
  const router = useRouter();
  const { dashboards, isLoading } = useDashboardsSwr();
  const [open, setOpen] = useState(false);

  if (!recording.started_at || !recording.finished_at) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <LayoutDashboard className="h-3 w-3" />
          Open in dashboard
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          Replay window in…
        </div>
        <div className="max-h-64 overflow-y-auto">
          {isLoading ? (
            <div className="px-2 py-2 text-xs text-muted-foreground">Loading…</div>
          ) : dashboards.length === 0 ? (
            <div className="px-2 py-2 text-xs text-muted-foreground">
              No dashboards yet
            </div>
          ) : (
            dashboards.map((d) => {
              const href = replayHref(d.id, recording);
              return (
                <button
                  key={d.id}
                  disabled={!href}
                  onClick={() => {
                    if (href) router.push(href);
                  }}
                  className="w-full text-left px-2 py-1.5 rounded text-xs text-foreground hover:bg-muted truncate disabled:opacity-50"
                >
                  {d.name}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface DeviceRecordingsProps {
  sourceId: string;
}

export function DeviceRecordings({ sourceId }: DeviceRecordingsProps) {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<Recording | null>(null);

  const load = useCallback(async (): Promise<Recording[] | null> => {
    try {
      const res = await fetch(`/api/recordings?source_id=${encodeURIComponent(sourceId)}`);
      if (res.status === 401) {
        setError("Session expired — please refresh the page.");
        return null;
      }
      if (!res.ok) {
        setError("Failed to load recordings.");
        return null;
      }
      const { recordings: rows } = await res.json();
      setError(null);
      setRecordings(rows);
      return rows;
    } catch {
      setError("Failed to load recordings.");
      return null;
    }
  }, [sourceId]);

  // Re-enter the loading state when the source changes (adjust-state-during-
  // render; the initial render already starts with isLoading = true).
  const [loadingSource, setLoadingSource] = useState(sourceId);
  if (loadingSource !== sourceId) {
    setLoadingSource(sourceId);
    setIsLoading(true);
  }

  useEffect(() => {
    void (async () => {
      try {
        await load();
      } finally {
        setIsLoading(false);
      }
    })();
  }, [load]);

  // Poll only while something is still in flight — stop once all terminal.
  const hasActive = recordings.some((r) => !TERMINAL_STATUSES.has(r.status));
  useEffect(() => {
    if (!hasActive) return;
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [hasActive, load]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        {error}
      </div>
    );
  }

  if (recordings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <Video className="h-8 w-8 opacity-30" />
        <p className="text-sm">No recordings yet</p>
        <p className="text-xs text-muted-foreground/70 text-center max-w-xs">
          Start a recording from a video panel on a dashboard to capture this
          device&apos;s camera feed.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <Table className="text-sm">
        <TableHeader className="bg-muted sticky top-0 z-10">
          <TableRow>
            <TableHead className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
              Camera
            </TableHead>
            <TableHead className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
              Started
            </TableHead>
            <TableHead className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
              Duration
            </TableHead>
            <TableHead className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
              Status
            </TableHead>
            <TableHead className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
              Actions
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {recordings.map((r) => (
            <TableRow key={r.id} className="hover:bg-muted/40">
              <TableCell className="px-3 py-2 font-mono text-xs text-foreground">
                {r.camera_id}
              </TableCell>
              <TableCell className="px-3 py-2 text-muted-foreground">
                {relative(r.started_at ?? r.created_at)}
              </TableCell>
              <TableCell className="px-3 py-2 text-foreground">
                {durationLabel(r)}
              </TableCell>
              <TableCell className="px-3 py-2">
                <RecordingStatusBadge status={r.status} />
              </TableCell>
              <TableCell className="px-3 py-2">
                <div className="flex items-center justify-end gap-3">
                  {r.status === "done" && r.playback_url && (
                    <OpenInDashboard recording={r} />
                  )}
                  {r.status === "done" && r.playback_url && (
                    <button
                      onClick={() => setPlaying(r)}
                      className="inline-flex items-center gap-1 text-xs text-foreground hover:text-primary"
                    >
                      <Play className="h-3 w-3" />
                      Watch
                    </button>
                  )}
                  {!TERMINAL_STATUSES.has(r.status) && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Circle className="h-3 w-3 text-red-500 animate-pulse" />
                      Live
                    </span>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Playback overlay */}
      {playing && playing.playback_url && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-8">
          <div className="relative w-full max-w-4xl aspect-video">
            <VideoPlayer
              url={`/api/recordings/${playing.id}/video`}
              onClose={() => setPlaying(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
