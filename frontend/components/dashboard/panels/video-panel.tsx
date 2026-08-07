"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useVideo } from "@/components/dashboard/video-context";
import { useRealtimeVideoFrame } from "@/hooks/realtime/use-realtime-data";
import { useRecordingForWindow } from "@/hooks/use-recording-for-window";
import { useTelemetryFromProvider } from "@/components/dashboard/telemetry-provider";
import { AttitudeIndicator } from "@/components/ui/charts/attitude-indicator";
import type { Panel, TimeRange } from "@/lib/types/dashboard";
import { Spinner } from "@/components/ui/spinner";
import { Video, VideoOff, Circle, Square, Play, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Recording } from "@/lib/db/queries/recordings";
import { VideoPlayer } from "@/components/ui/video-player";

/** Small live attitude HUD overlaid on a camera feed. Reads roll/pitch metric
 * keys from the realtime store and feeds the shared AttitudeIndicator. */
function VideoAttitudeOverlay({
  panelId,
  rollKey,
  pitchKey,
}: {
  panelId: string;
  rollKey?: string;
  pitchKey?: string;
}) {
  const keys = useMemo(
    () => [rollKey, pitchKey].filter((k): k is string => !!k),
    [rollKey, pitchKey],
  );
  const { data } = useTelemetryFromProvider(keys, `${panelId}-attitude`);
  if (keys.length === 0) return null;

  const lastVal = (key?: string): number => {
    const pts = key ? data[key] : undefined;
    return pts && pts.length > 0 ? pts[pts.length - 1].value : 0;
  };

  return (
    <div className="absolute top-2 right-2 rounded-lg overflow-hidden ring-1 ring-white/15 shadow-lg pointer-events-none">
      <AttitudeIndicator
        roll={lastVal(rollKey)}
        pitch={lastVal(pitchKey)}
        width={128}
        height={128}
      />
    </div>
  );
}

// ── Recording Overlay ──────────────────────────────────────────────────────

type RecordingState =
  | { phase: "idle" }
  | { phase: "picking" }
  | { phase: "active"; recording: Recording }
  | { phase: "done"; recording: Recording }
  | { phase: "error"; message: string };

// Duration chips speak the app's time vocabulary (mirrors QUICK_RANGES in
// time-range-picker.tsx), capped at the recorder's 4h session limit.
const DURATION_OPTIONS = ["15m", "1h", "2h", "4h"] as const;

function RecordingOverlay({
  cameraId,
  sourceId,
}: {
  cameraId: string;
  sourceId?: string;
}) {
  const [state, setState] = useState<RecordingState>({ phase: "idle" });
  const [showPlayer, setShowPlayer] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollStatus = useCallback((id: string) => {
    stopPolling();
    let consecutiveFailures = 0;
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/recordings/${id}`);
        if (!res.ok) {
          // Hard stop on auth/not-found — these won't recover by retrying.
          if (res.status === 401 || res.status === 404) {
            stopPolling();
            setState({ phase: "error", message: res.status === 401 ? "Session expired" : "Recording not found" });
            return;
          }
          // Transient server error — allow up to 3 consecutive failures before giving up.
          consecutiveFailures++;
          if (consecutiveFailures >= 3) {
            stopPolling();
            setState({ phase: "error", message: "Lost contact with recording service" });
          }
          return;
        }
        consecutiveFailures = 0;
        const { recording } = await res.json();
        if (recording.status === "done") {
          stopPolling();
          setState({ phase: "done", recording });
        } else if (recording.status === "error") {
          stopPolling();
          setState({ phase: "error", message: recording.error_message ?? "Recording failed" });
        } else {
          setState({ phase: "active", recording });
        }
      } catch {
        consecutiveFailures++;
        if (consecutiveFailures >= 3) {
          stopPolling();
          setState({ phase: "error", message: "Lost contact with recording service" });
        }
      }
    }, 5000);
  }, [stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  // On mount, check for an in-progress recording for this camera so navigation
  // away and back doesn't lose the active/done state.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/recordings")
      .then((res) => {
        if (!res.ok || cancelled) return;
        return res.json();
      })
      .then((body) => {
        if (!body || cancelled) return;
        const recordings: Recording[] = body.recordings ?? [];
        // List is newest-first; pick the first non-error match for this camera.
        const match = recordings.find(
          (r) => r.camera_id === cameraId && r.status !== "error"
        );
        if (!match) return;
        if (match.status === "done") {
          setState({ phase: "done", recording: match });
        } else {
          setState({ phase: "active", recording: match });
          pollStatus(match.id);
        }
      })
      .catch(() => {
        // Best-effort — silently stay idle if the fetch fails.
      });
    return () => { cancelled = true; };
  }, [cameraId, pollStatus]);

  async function startRecording(duration: string) {
    try {
      const res = await fetch("/api/recordings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ camera_id: cameraId, source_id: sourceId, duration }),
      });
      if (!res.ok) throw new Error("Failed to start recording");
      const { recording } = await res.json();
      setState({ phase: "active", recording });
      pollStatus(recording.id);
    } catch (e: unknown) {
      setState({ phase: "error", message: e instanceof Error ? e.message : "Failed to start" });
    }
  }

  async function stopRecording(id: string) {
    // Optimistically flip to stop_requested so the button disappears immediately.
    setState((s) =>
      s.phase === "active"
        ? { phase: "active", recording: { ...s.recording, status: "stop_requested" } }
        : s,
    );
    try {
      const res = await fetch(`/api/recordings/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        stopPolling();
        setState({ phase: "error", message: body?.error?.message ?? "Failed to stop recording" });
        return;
      }
      // Success — keep polling; the recorder transitions status to done.
    } catch {
      stopPolling();
      setState({ phase: "error", message: "Failed to stop recording" });
    }
  }

  return (
    <>
      {/* HLS player overlay */}
      {showPlayer && state.phase === "done" && state.recording.playback_url && (
        <VideoPlayer url={`/api/recordings/${state.recording.id}/video`} onClose={() => setShowPlayer(false)} />
      )}

      {/* Duration picker popover — time-vocabulary chips, not a raw number */}
      {state.phase === "picking" && (
        <div className="absolute bottom-10 right-2 z-20 bg-background border border-border rounded-lg shadow-lg p-3 w-44 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground font-medium">
              Record for
            </span>
            <button
              onClick={() => setState({ phase: "idle" })}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {DURATION_OPTIONS.map((d) => (
              <button
                key={d}
                onClick={() => startRecording(d)}
                className="h-7 rounded border border-border text-[11px] font-medium text-foreground hover:bg-muted hover:border-red-500/40"
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Error badge */}
      {state.phase === "error" && (
        <div className="absolute top-2 right-2 z-20 flex items-center gap-1.5 bg-yellow-500/90 text-black px-2 py-1 rounded text-xs">
          <span>{state.message}</span>
          <button onClick={() => setState({ phase: "idle" })}>
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* REC / STOPPING badge while active */}
      {state.phase === "active" && (
        <div className="absolute top-2 right-2 z-20 flex items-center gap-1.5 bg-black/70 px-2 py-1 rounded text-xs text-white">
          <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
          <span>{state.recording.status === "stop_requested" ? "STOPPING" : "REC"}</span>
        </div>
      )}

      {/* Watch button when done */}
      {state.phase === "done" && state.recording.playback_url && (
        <button
          onClick={() => setShowPlayer(true)}
          className="absolute top-2 right-2 z-20 flex items-center gap-1.5 bg-black/70 hover:bg-black/90 px-2 py-1 rounded text-xs text-white"
        >
          <Play className="h-3 w-3" />
          Watch
        </button>
      )}

      {/* Record / Stop button */}
      <div className="absolute bottom-2 right-2 z-20">
        {state.phase === "idle" && (
          <button
            onClick={() => setState({ phase: "picking" })}
            title="Start recording"
            className="flex items-center justify-center h-7 w-7 rounded-full bg-black/50 hover:bg-black/80 text-white"
          >
            <Circle className="h-4 w-4 fill-red-500 text-red-500" />
          </button>
        )}
        {state.phase === "picking" && (
          <button
            onClick={() => setState({ phase: "idle" })}
            className="flex items-center justify-center h-7 w-7 rounded-full bg-black/50 hover:bg-black/80 text-white"
          >
            <Circle className="h-4 w-4 fill-red-500 text-red-500" />
          </button>
        )}
        {state.phase === "active" && state.recording.status !== "stop_requested" && (
          <button
            onClick={() => stopRecording(state.recording.id)}
            title="Stop recording"
            className="flex items-center justify-center h-7 w-7 rounded-full bg-black/50 hover:bg-black/80 text-white"
          >
            <Square className="h-4 w-4 fill-white text-white" />
          </button>
        )}
        {(state.phase === "done" || state.phase === "error") && (
          <button
            onClick={() => setState({ phase: "idle" })}
            title="New recording"
            className="flex items-center justify-center h-7 w-7 rounded-full bg-black/50 hover:bg-black/80 text-white"
          >
            <Circle className="h-4 w-4 fill-red-500 text-red-500" />
          </button>
        )}
      </div>
    </>
  );
}

interface VideoPanelProps {
  panel: Panel;
  timeRange: TimeRange;
}

interface EmbedOpts { autoplay: boolean; loop: boolean; muted: boolean }

function toYouTubeEmbed(url: string, opts: EmbedOpts): string | null {
  // Handles: youtu.be/ID, youtube.com/watch?v=ID, youtube.com/embed/ID, youtube.com/shorts/ID
  const m =
    url.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/) ||
    url.match(/youtube\.com\/(?:watch\?v=|embed\/|shorts\/)([A-Za-z0-9_-]{6,})/);
  if (!m) return null;
  const id = m[1];
  const p = new URLSearchParams({
    autoplay: opts.autoplay ? "1" : "0",
    mute: opts.muted ? "1" : "0",
    loop: opts.loop ? "1" : "0",
    controls: "1",
    modestbranding: "1",
    rel: "0",
    playsinline: "1",
  });
  // YouTube requires playlist=ID for loop to work
  if (opts.loop) p.set("playlist", id);
  return `https://www.youtube.com/embed/${id}?${p.toString()}`;
}

function toVimeoEmbed(url: string, opts: EmbedOpts): string | null {
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (!m) return null;
  const id = m[1];
  const p = new URLSearchParams({
    autoplay: opts.autoplay ? "1" : "0",
    muted: opts.muted ? "1" : "0",
    loop: opts.loop ? "1" : "0",
    controls: "1",
  });
  return `https://player.vimeo.com/video/${id}?${p.toString()}`;
}

// Parse camera from metrics array (format: source_id:$camera:camera_id)
// Note: camera_id itself may contain colons (e.g., "picam:0")
function parseCameraFromMetrics(metrics: string[]): { sourceId: string; cameraId: string } | null {
  const cameraMetric = metrics.find((m) => m.includes(":$camera:"));
  if (!cameraMetric) return null;

  // Split only on first two colons to preserve camera_id with colons
  const firstColon = cameraMetric.indexOf(":");
  const markerStart = cameraMetric.indexOf(":$camera:");
  if (firstColon === -1 || markerStart === -1) return null;

  const sourceId = cameraMetric.substring(0, markerStart);
  const cameraId = cameraMetric.substring(markerStart + ":$camera:".length);

  return { sourceId, cameraId };
}

export function VideoPanel({ panel, timeRange }: VideoPanelProps) {
  // Static URL mode: config.videoUrl overrides the live-camera path entirely.
  // Useful for reference footage (e.g. public NASA docking videos) in demos.
  const videoUrl = (panel.config as { videoUrl?: string }).videoUrl;
  const poster = (panel.config as { videoPoster?: string }).videoPoster;
  const autoplay = (panel.config as { autoplay?: boolean }).autoplay !== false;
  const loop = (panel.config as { loop?: boolean }).loop !== false;
  const muted = (panel.config as { muted?: boolean }).muted !== false;
  const recordingEnabled = !!(panel.config as { recordingEnabled?: boolean }).recordingEnabled;

  // First try to get camera from metrics array, fall back to config for backwards compatibility
  const cameraFromMetrics = useMemo(
    () => parseCameraFromMetrics(panel.metrics || []),
    [panel.metrics]
  );

  const sourceId = cameraFromMetrics?.sourceId || panel.config.sourceId || panel.sources?.[0];
  const configuredCameraId = cameraFromMetrics?.cameraId || panel.config.cameraId;
  const cameraId = configuredCameraId || "default";
  const frameRate = panel.config.frameRate || 10;

  // Replay: when the dashboard is frozen to an absolute window (e.g. opened from
  // a recording), play the recorded footage seeked into that window so video and
  // telemetry charts scrub together. Null while live — live path untouched.
  const recordingMatch = useRecordingForWindow(sourceId, configuredCameraId, timeRange);

  // Use video context - works for both authenticated and shared dashboards
  const { videoFrameStore, isConnected, isSharedView, registerCamera } = useVideo();
  // Subscribe only to this panel's camera key so sibling panels don't cause
  // re-renders. When cameraId isn't explicitly configured, accept any frame
  // from this source (devices may report non-"default" camera_ids).
  const frameKey = `${sourceId}:${cameraId}`;
  const fallbackPrefix = !configuredCameraId && sourceId ? `${sourceId}:` : undefined;
  const currentFrame = useRealtimeVideoFrame(videoFrameStore, frameKey, fallbackPrefix);

  // Derived: we're streaming exactly when the registration effect below does
  // not early-return (i.e. an authenticated, connected camera is registered).
  const isStreaming =
    !isSharedView && isConnected && !!sourceId && !!registerCamera;

  // Register with the provider's camera aggregator. The provider sends a
  // consolidated `subscribe` (routing) + `start_camera` / `stop_camera`
  // (device commands), so only one message pair is sent per unique camera
  // even when multiple VideoPanel instances share the same dashboard.
  useEffect(() => {
    if (isSharedView || !isConnected || !sourceId || !registerCamera) return;
    const unregister = registerCamera(panel.id, sourceId, cameraId, frameRate);
    return () => {
      unregister();
    };
  }, [isConnected, sourceId, cameraId, frameRate, registerCamera, isSharedView, panel.id]);

  // Render each frame via an object URL rather than a `data:` URL. Safari
  // retains decoded `data:`-URL images aggressively; at ~10fps a long-lived
  // feed grows tab memory into the GBs and trips the "significant memory"
  // reload. Object URLs let us revoke the previous frame's bytes the instant
  // the next one arrives, keeping memory flat.
  // Drive the <img> src imperatively rather than through state: at ~10fps a
  // setState-per-frame would re-render the whole panel, and React state for a
  // value that only feeds one DOM attribute is unnecessary. We revoke the
  // previous object URL the instant the next frame arrives, keeping memory flat.
  const imgRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const b64 = currentFrame?.frame;
    if (!b64) {
      img.removeAttribute("src");
      return;
    }
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [currentFrame?.frame]);

  // ── Static URL mode ────────────────────────────────────────────────
  // Detects YouTube / Vimeo URLs → iframe embed. Otherwise uses <video>
  // for direct MP4/WebM/MOV. Anything else falls through to iframe too
  // so generic embed URLs (Twitch, Cloudflare Stream, etc.) work.
  if (videoUrl) {
    const ytEmbed = toYouTubeEmbed(videoUrl, { autoplay, loop, muted });
    const vimeoEmbed = toVimeoEmbed(videoUrl, { autoplay, loop, muted });
    const embedSrc = ytEmbed || vimeoEmbed;
    const isDirectVideo = /\.(mp4|webm|mov|m4v|ogg)(\?.*)?$/i.test(videoUrl);

    return (
      <div className="h-full w-full relative bg-black overflow-hidden">
        {embedSrc ? (
          <iframe
            src={embedSrc}
            className="h-full w-full border-0"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        ) : isDirectVideo ? (
          <video
            src={videoUrl}
            poster={poster}
            autoPlay={autoplay}
            loop={loop}
            muted={muted}
            playsInline
            controls={false}
            className="h-full w-full object-contain"
          />
        ) : (
          <iframe
            src={videoUrl}
            className="h-full w-full border-0"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        )}
        <div className="absolute bottom-2 left-2 flex items-center gap-2 text-xs text-white/70 bg-black/50 px-2 py-1 rounded">
          <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
          <span>Reference footage</span>
        </div>
      </div>
    );
  }

  // Replay mode — a finished recording overlaps the frozen window for this camera.
  if (recordingMatch) {
    return (
      <div className="h-full w-full relative bg-black overflow-hidden">
        <VideoPlayer
          url={`/api/recordings/${recordingMatch.recording.id}/video`}
          startTime={recordingMatch.seekSeconds}
          autoPlay
          fill
        />
        <div className="absolute bottom-2 left-2 flex items-center gap-2 text-xs text-white/70 bg-black/50 px-2 py-1 rounded">
          <div className="h-2 w-2 rounded-full bg-blue-500" />
          <span>Replay</span>
        </div>
      </div>
    );
  }

  // No source configured
  if (!sourceId) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2">
        <VideoOff className="h-8 w-8" />
        <span className="text-sm">No source configured</span>
      </div>
    );
  }

  // Connecting state (only relevant for authenticated dashboards)
  if (!isConnected && !isSharedView) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2">
        <Spinner />
        <span className="text-sm">Connecting...</span>
      </div>
    );
  }

  // Waiting for first frame
  if (!currentFrame) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2">
        <Video className="h-8 w-8 animate-pulse" />
        <span className="text-sm">
          {isSharedView
            ? `Waiting for video stream...${isConnected ? "" : " (connecting)"}`
            : "Waiting for video..."}
        </span>
        {isSharedView && (
          <span className="text-xs text-muted-foreground/60">
            {frameKey}
          </span>
        )}
      </div>
    );
  }

  const attitude = (
    panel.config as { attitude?: { roll?: string; pitch?: string } }
  ).attitude;

  return (
    <div className="h-full w-full relative bg-black overflow-hidden">
      {/* Video frame */}
      {currentFrame.frame && (
        // eslint-disable-next-line @next/next/no-img-element -- live camera frame set via imgRef.src at runtime; next/image cannot drive a dynamic stream
        <img
          ref={imgRef}
          alt="Camera feed"
          className="h-full w-full object-contain"
        />
      )}

      {/* Live attitude HUD (e.g. phone-as-a-sensor demo) */}
      {attitude && (attitude.roll || attitude.pitch) && (
        <VideoAttitudeOverlay
          panelId={panel.id}
          rollKey={attitude.roll}
          pitchKey={attitude.pitch}
        />
      )}

      {/* Overlay info */}
      <div className="absolute bottom-2 left-2 flex items-center gap-2 text-xs text-white/70 bg-black/50 px-2 py-1 rounded">
        <div
          className={cn(
            "h-2 w-2 rounded-full",
            // Shared views show green when receiving frames, authenticated shows based on isStreaming
            (isSharedView || isStreaming) ? "bg-green-500 animate-pulse" : "bg-red-500"
          )}
        />
        <span>
          {currentFrame.width}x{currentFrame.height}
        </span>
      </div>

      {/* Recording controls — only when a real camera is configured, not the "default" fallback */}
      {recordingEnabled && !isSharedView && configuredCameraId && (
        <RecordingOverlay cameraId={cameraId} sourceId={sourceId} />
      )}
    </div>
  );
}
