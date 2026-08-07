"use client";

/**
 * Gateway WebSocket connection, lifted out of per-hook instances into a
 * shared provider so every consumer on a page routes through one socket.
 *
 * Two provider variants share one context:
 *   - <AuthenticatedRealtimeProvider> — browser_auth via short-lived ws-token,
 *     mounted at app root
 *   - <SharedRealtimeProvider>        — share_auth, mounted by shared-dashboard
 *
 * Consumers call useGatewayConnection() to read stores/state or
 * subscribe(consumerId, { metrics, cameras }) to register interest. The
 * provider unions all subscriptions and sends a single subscribe message
 * to the gateway (on connect, and whenever the union changes).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePlexusSession } from "@/hooks/use-plexus-session";
import { usePageVisibility } from "@/components/ui/lib/visibility";
import { MINUTE_MS, SECOND_MS } from "@/lib/constants/time";
import {
  createTelemetryStore,
  type TelemetryStore,
  type TelemetryPoint,
} from "@/hooks/realtime/telemetry-store";
import {
  createVideoFrameStore,
  type VideoFrameStore,
  type VideoFrame,
} from "@/hooks/realtime/video-store";
import {
  getBackoffDelay,
  getGatewayHost,
  type ConnectionState,
  type SensorInfo,
  type CameraInfo,
  type SourceStatus,
} from "@/hooks/realtime/types";

const MAX_PENDING_POINTS = 500;

export interface StreamConfig {
  intervalMs: number;
  isStreaming: boolean;
  store: boolean;
}

export interface SubscriptionEntry {
  metrics: readonly string[];
  cameras: readonly string[];
}

export interface GatewayConnectionValue {
  telemetryStore: TelemetryStore;
  videoFrameStore: VideoFrameStore;
  sources: SourceStatus[];
  connectionState: ConnectionState;
  isConnected: boolean;
  isPageVisible: boolean;
  error: Error | null;
  streamConfigs: Record<string, StreamConfig>;
  setStreamConfig: (sourceId: string, patch: Partial<StreamConfig>) => void;
  subscribe: (consumerId: string, entry: SubscriptionEntry) => () => void;
  send: (message: Record<string, unknown>) => void;
  reconnect: () => void;
  reconnectAttempt: number;
  maxReconnectAttempts: number;
  /**
   * Tombstone a slug so it's filtered out of `sources` (and ignored on
   * incoming `source_status` events) for `ttlMs`. Available for delete
   * handlers to call so a freshly-deleted device doesn't flicker back
   * as "unregistered" while the gateway server catches up with the
   * deletion.
   *
   * The window is short by design — the gateway notices missing rows
   * on its own polling cycle and stops emitting status events. The
   * tombstone is belt-and-suspenders for the gap.
   */
  markSourceDeleted: (slug: string, ttlMs?: number) => void;
}

const GatewayConnectionContext = createContext<GatewayConnectionValue | null>(
  null,
);

/** Read the active gateway connection. Returns null if no provider is mounted. */
export function useGatewayConnectionOrNull(): GatewayConnectionValue | null {
  return useContext(GatewayConnectionContext);
}

/** Read the active gateway connection. Throws if no provider is mounted. */
export function useGatewayConnection(): GatewayConnectionValue {
  const ctx = useContext(GatewayConnectionContext);
  if (!ctx) {
    throw new Error(
      "useGatewayConnection must be used within a GatewayConnection provider",
    );
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Shared implementation
// ---------------------------------------------------------------------------

interface OnlineSourceInit {
  source_id: string;
  platform?: string;
  sensors?: SensorInfo[];
  cameras?: CameraInfo[];
  is_streaming?: boolean;
  stream_interval_ms?: number | null;
  store_data?: boolean;
}

interface GatewayConnectionProviderProps {
  children: ReactNode;
  /** Whether to open the socket. False suspends connect attempts. */
  enabled: boolean;
  /** Build the auth handshake. Return null to abort the connection. */
  getAuthMessage: () => Promise<Record<string, unknown> | null>;
  /** Values that, when changed, force a reconnect (e.g. orgId, shareToken). */
  authDeps: ReadonlyArray<unknown>;
  /** Connection retries before giving up (user can still call reconnect). */
  maxAttempts?: number;
  /** Gateway host override; defaults to env var or production host. */
  host?: string;
}

function normalizeUnion(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

// The gateway sends source_id as either "slug" or "orgID:slug". The
// trailing segment is always the user-visible slug we care about for
// tombstone matching.
function slugOf(sourceId: string): string {
  const i = sourceId.lastIndexOf(":");
  return i >= 0 ? sourceId.slice(i + 1) : sourceId;
}

function GatewayConnectionProviderImpl({
  children,
  enabled,
  getAuthMessage,
  authDeps,
  maxAttempts = 2,
  host,
}: GatewayConnectionProviderProps) {
  // Stores — singletons for the lifetime of this provider mount. The lazy
  // useState initializer runs exactly once on mount, yielding a stable handle.
  const [store] = useState(() => createTelemetryStore(1000));
  const [videoStore] = useState(() => createVideoFrameStore());

  // Reactive connection state.
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected");
  const [error, setError] = useState<Error | null>(null);
  const [sources, setSources] = useState<SourceStatus[]>([]);
  // Reactive mirror of connectionAttemptRef for the context value. The ref
  // remains the synchronous source of truth used inside connect/reconnect.
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  // Recently-deleted slugs. The gateway server keeps emitting status
  // events for a slug for a brief window after the row is deleted from
  // Postgres; without this, the device flickers back as "unregistered"
  // until the gateway notices. Filter + WS short-circuit closes the gap.
  // Map<slug, expireAtMs>.
  // Map<slug, expireAtMs>. Held in state so `visibleSources` can filter as a
  // pure membership check, with a ref mirror so the async socket handlers can
  // read the live set without re-subscribing. Expired entries are pruned by a
  // timer (see markSourceDeleted) rather than lazily during render.
  const [tombstones, setTombstones] = useState<Map<string, number>>(
    () => new Map(),
  );
  const tombstonesRef = useRef(tombstones);
  useEffect(() => {
    tombstonesRef.current = tombstones;
  });
  const isTombstoned = useCallback((slug: string): boolean => {
    const expireAt = tombstonesRef.current.get(slug);
    return expireAt != null && Date.now() <= expireAt;
  }, []);
  const [streamConfigs, setStreamConfigs] = useState<
    Record<string, StreamConfig>
  >({});

  // Timestamps live in a ref — stale-checker reads them on its interval.
  const sourceTimestampsRef = useRef<
    Map<string, { lastDataAt: string; lastSeenAt: string }>
  >(new Map());

  // Subscription registry. Held in state (a fresh Map per mutation) so the
  // union below can be derived purely; the setState already drives the single
  // re-render that the subscribe-effect keys off of.
  const [subs, setSubs] = useState<Map<string, SubscriptionEntry>>(
    () => new Map(),
  );

  const unionRef = useRef<{ metrics: string[]; cameras: string[] }>({
    metrics: [],
    cameras: [],
  });

  // Recompute union whenever subs change — pure derivation, no ref access.
  const union = useMemo(() => {
    const metrics = new Set<string>();
    const cameras = new Set<string>();
    for (const entry of subs.values()) {
      for (const m of entry.metrics) metrics.add(m);
      for (const c of entry.cameras) cameras.add(c);
    }
    const nextMetrics = normalizeUnion(metrics);
    const nextCameras = normalizeUnion(cameras);
    return {
      metrics: nextMetrics,
      cameras: nextCameras,
      key: `${nextMetrics.join(",")}|${nextCameras.join(",")}`,
    };
  }, [subs]);
  const unionKey = union.key;

  // Mirror the union into a ref so async socket handlers (init/telemetry) can
  // read the latest subscription set without it being a dependency.
  useEffect(() => {
    unionRef.current = { metrics: union.metrics, cameras: union.cameras };
  }, [union]);

  // Track the previous metric union so we can detect 0 → 1 subscriber
  // transitions per metric. When a chart re-mounts after a gap (user
  // navigated away and came back), the metric appears in the union
  // again — but the store may still hold a frozen buffer from the
  // previous viewing session. Clearing it here means the new chart
  // starts with a clean slate instead of rendering stale points
  // alongside the live stream.
  const prevMetricsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const next = new Set(unionRef.current.metrics);
    const prev = prevMetricsRef.current;
    for (const metric of next) {
      if (!prev.has(metric)) store.clearMetric(metric);
    }
    prevMetricsRef.current = next;
    // Keep store slots populated so "subscribed but empty" panels render
    // "no data" instead of waiting on a metric that doesn't exist in the
    // snapshot yet.
    store.initMetrics(unionRef.current.metrics);
  }, [unionKey, store]);

  // Socket handle + reconnect bookkeeping.
  const socketRef = useRef<WebSocket | null>(null);
  const connectionAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isPageVisible = usePageVisibility();
  const isPageVisibleRef = useRef(isPageVisible);
  useEffect(() => {
    isPageVisibleRef.current = isPageVisible;
  });

  // Auth factory stored in a ref so the connect callback doesn't have to list
  // every auth dep to stay fresh — reconnects are driven by authDeps below.
  const getAuthMessageRef = useRef(getAuthMessage);
  useEffect(() => {
    getAuthMessageRef.current = getAuthMessage;
  });

  // ----- send() — stable function that safely no-ops when not open. ----------
  const send = useCallback((message: Record<string, unknown>) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(message));
    }
  }, []);

  // ----- Telemetry points — RAF-coalesced flush so we don't thrash React. ----
  const pendingPointsRef = useRef<TelemetryPoint[]>([]);
  const flushScheduledRef = useRef(false);
  const flushPendingPoints = useCallback(() => {
    flushScheduledRef.current = false;
    const points = pendingPointsRef.current;
    if (points.length === 0) return;
    pendingPointsRef.current = [];
    store.addPoints(points);
  }, [store]);

  const addPoints = useCallback(
    (newPoints: TelemetryPoint[]) => {
      pendingPointsRef.current.push(...newPoints);
      if (pendingPointsRef.current.length > MAX_PENDING_POINTS) {
        const overflow = pendingPointsRef.current.length - MAX_PENDING_POINTS;
        pendingPointsRef.current = pendingPointsRef.current.slice(overflow);
      }
      if (!isPageVisibleRef.current) return;
      // Coalesce: if multiple WS messages arrive in the same frame, they all
      // push into pendingPointsRef but only ONE rAF fires — saves 9+ wasted
      // scheduler trips per frame when streaming at 10 Hz × multiple metrics.
      if (flushScheduledRef.current) return;
      flushScheduledRef.current = true;
      requestAnimationFrame(flushPendingPoints);
    },
    [flushPendingPoints],
  );

  // Drain pending points when the tab becomes visible again.
  useEffect(() => {
    if (isPageVisible && pendingPointsRef.current.length > 0) {
      flushPendingPoints();
    }
  }, [isPageVisible, flushPendingPoints]);

  // ----- Video frames — RAF-coalesced flush keyed by camera. ----------------
  // Map keyed by "source_id:camera_id" so a later frame for the same camera
  // supersedes an earlier one in the same frame. Multiple cameras all flush
  // on one rAF. Only the newest frame per camera ever reaches React.
  const pendingFramesRef = useRef<Map<string, VideoFrame>>(new Map());
  const frameFlushScheduledRef = useRef(false);
  const flushPendingFrames = useCallback(() => {
    frameFlushScheduledRef.current = false;
    const pending = pendingFramesRef.current;
    if (pending.size === 0) return;
    for (const frame of pending.values()) {
      videoStore.setFrame(frame);
    }
    pending.clear();
  }, [videoStore]);

  // Drain pending frames when the tab becomes visible again.
  useEffect(() => {
    if (isPageVisible && pendingFramesRef.current.size > 0) {
      flushPendingFrames();
    }
  }, [isPageVisible, flushPendingFrames]);

  // ----- Message handler. Pulled into a ref so the socket onmessage always ---
  //       reads the current handler without needing to recreate connect().
  const handleMessage = useCallback(
    (message: Record<string, unknown>) => {
      const type = message.type as string;

      switch (type) {
        case "init": {
          const onlineSources =
            (message.online_sources as OnlineSourceInit[]) || [];

          setSources(
            onlineSources
              // Drop tombstoned slugs from the initial snapshot too —
              // otherwise a reconnect inside the tombstone window
              // re-inflates the deleted source.
              .filter((s) => !isTombstoned(slugOf(s.source_id)))
              .map((s) => ({
                source_id: s.source_id,
                status: "online" as const,
                platform: s.platform,
                sensors: s.sensors,
                cameras: s.cameras,
              })),
          );

          // Seed stream configs for devices that were already streaming when
          // we connected; otherwise consumers wouldn't know the device is live.
          const initialConfigs: Record<string, StreamConfig> = {};
          for (const s of onlineSources) {
            if (s.is_streaming) {
              initialConfigs[s.source_id] = {
                intervalMs: s.stream_interval_ms ?? 100,
                isStreaming: true,
                store: s.store_data ?? false,
              };
            }
          }
          if (Object.keys(initialConfigs).length > 0) {
            setStreamConfigs((prev) => ({ ...prev, ...initialConfigs }));
          }

          setConnectionState("connected");
          setError(null);
          connectionAttemptRef.current = 0;
          setReconnectAttempt(0);

          const { metrics, cameras } = unionRef.current;
          if (metrics.length > 0) {
            send({ type: "subscribe", metrics });
          }
          if (cameras.length > 0) {
            send({ type: "subscribe", cameras });
          }
          // Kick off the pull cycle — gateway will deliver the first telemetry
          // batch as soon as the next flush fires.
          send({ type: "ready" });
          break;
        }

        case "telemetry": {
          const points = message.points as TelemetryPoint[];
          const envelopeSourceId = message.source_id as string | undefined;
          if (!points || !Array.isArray(points)) break;

          const subscribed = new Set(unionRef.current.metrics);
          const relevant = points
            .filter((p) => {
              if (!p.metric) return false;
              if (subscribed.size === 0) return false;
              const pSourceId =
                (p as { source_id?: string }).source_id ?? envelopeSourceId;
              const prefixed = pSourceId
                ? `${pSourceId}:${p.metric}`
                : p.metric;
              return subscribed.has(p.metric) || subscribed.has(prefixed);
            })
            .map((p) => {
              const pSourceId =
                (p as { source_id?: string }).source_id ?? envelopeSourceId;
              return {
                ...p,
                metric: pSourceId ? `${pSourceId}:${p.metric}` : p.metric,
                source_id: pSourceId,
              };
            });

          if (relevant.length > 0) {
            addPoints(relevant);

            // Update per-source lastDataAt for the stale tracker.
            const now = new Date().toISOString();
            const seen = new Set<string>();
            for (const p of relevant) {
              const sid = (p as { source_id?: string }).source_id;
              if (sid && !seen.has(sid)) {
                seen.add(sid);
                sourceTimestampsRef.current.set(sid, {
                  lastDataAt: now,
                  lastSeenAt: now,
                });
              }
            }
          }
          // Signal readiness for the next batch regardless of whether any
          // points were relevant — the browser has processed this flush.
          send({ type: "ready" });
          break;
        }

        case "video_frame": {
          const frame = message as unknown as VideoFrame;
          if (!frame.source_id || !frame.camera_id) break;
          // Coalesce: stash latest frame per camera, flush once per rAF.
          // Superseded frames never reach React — keeps renders at display rate.
          pendingFramesRef.current.set(
            `${frame.source_id}:${frame.camera_id}`,
            frame,
          );
          if (!isPageVisibleRef.current) break;
          if (frameFlushScheduledRef.current) break;
          frameFlushScheduledRef.current = true;
          requestAnimationFrame(flushPendingFrames);
          break;
        }

        case "source_status": {
          const status = message as unknown as {
            source_id: string;
            status: SourceStatus["status"];
            platform?: string;
            sensors?: SensorInfo[];
            cameras?: CameraInfo[];
          };
          // Tombstoned slugs are intentionally hidden until the gateway
          // catches up with the row deletion. Drop the event entirely
          // rather than letting it re-create an entry in `sources`.
          if (isTombstoned(slugOf(status.source_id))) break;
          const now = new Date().toISOString();
          setSources((prev) => {
            const existing = prev.find((s) => s.source_id === status.source_id);
            if (status.status === "online") {
              const updated: SourceStatus = {
                source_id: status.source_id,
                status: "online",
                platform: status.platform ?? existing?.platform,
                sensors: status.sensors ?? existing?.sensors,
                cameras: status.cameras ?? existing?.cameras,
                lastSeenAt: now,
              };
              if (existing) {
                return prev.map((s) =>
                  s.source_id === status.source_id ? updated : s,
                );
              }
              return [...prev, updated];
            }
            return prev.map((s) =>
              s.source_id === status.source_id
                ? { ...s, status: "offline" as const, lastSeenAt: now }
                : s,
            );
          });
          break;
        }

        case "source_stream_state": {
          const sourceId = message.source_id as string;
          const isStreaming = message.is_streaming as boolean;
          const intervalMs = message.interval_ms as number | null;
          const storeFlag = message.store as boolean | undefined;
          setStreamConfigs((prev) => ({
            ...prev,
            [sourceId]: {
              intervalMs: intervalMs ?? prev[sourceId]?.intervalMs ?? 100,
              isStreaming,
              store: storeFlag ?? prev[sourceId]?.store ?? false,
            },
          }));
          break;
        }

        case "ping":
          send({ type: "pong" });
          break;

        case "error":
          setError(new Error(message.message as string));
          break;
      }
    },
    [addPoints, flushPendingFrames, isTombstoned, send],
  );

  // Stash the latest handler so socket.onmessage always calls the current fn.
  const handleMessageRef = useRef(handleMessage);
  useEffect(() => {
    handleMessageRef.current = handleMessage;
  });

  // ----- Reconnect / connect -------------------------------------------------
  // The reconnect timer bumps this nonce instead of calling `connect` directly;
  // a dedicated effect below performs the actual reconnect. This breaks the
  // connect ⇄ scheduleReconnect cycle so neither needs a forward ref.
  const [reconnectNonce, setReconnectNonce] = useState(0);

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimerRef.current) return;
    if (!isPageVisibleRef.current) return;
    if (connectionAttemptRef.current >= maxAttempts) {
      setConnectionState("error");
      return;
    }
    const delay = getBackoffDelay(connectionAttemptRef.current);
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      setReconnectNonce((n) => n + 1);
    }, delay);
  }, [maxAttempts]);

  const connect = useCallback(async () => {
    if (connectionAttemptRef.current >= maxAttempts) {
      setConnectionState("error");
      return;
    }
    connectionAttemptRef.current++;
    setReconnectAttempt(connectionAttemptRef.current);

    if (socketRef.current) socketRef.current.close();
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    setConnectionState("connecting");

    try {
      const authMessage = await getAuthMessageRef.current();
      if (!authMessage) {
        setError(new Error("Not authenticated"));
        setConnectionState("error");
        return;
      }

      const gwHost = host || getGatewayHost();
      const proto =
        gwHost.startsWith("localhost") || gwHost.startsWith("127.")
          ? "ws"
          : "wss";
      const socket = new WebSocket(`${proto}://${gwHost}/ws/browser`);
      socketRef.current = socket;

      let didConnect = false;

      socket.onopen = () => {
        didConnect = true;
        socket.send(JSON.stringify(authMessage));
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleMessageRef.current(msg);
        } catch (err) {
          console.error(
            "[gateway] failed to parse/handle message:",
            err,
            event.data,
          );
        }
      };

      socket.onerror = () => {
        setConnectionState("error");
        if (!didConnect && connectionAttemptRef.current >= maxAttempts) {
          setConnectionState("error");
        }
      };

      socket.onclose = (event) => {
        socketRef.current = null;
        if (event.code === 1000) {
          // Intentional close (unmount or server drain). Don't reconnect.
          setConnectionState("disconnected");
          return;
        }
        if (connectionAttemptRef.current < maxAttempts) {
          scheduleReconnect();
        } else {
          setConnectionState("error");
        }
      };
    } catch {
      setConnectionState("error");
      scheduleReconnect();
    }
  }, [host, maxAttempts, scheduleReconnect]);

  // Perform the actual reconnect when scheduleReconnect's timer bumps the nonce.
  // The processed-nonce guard means a change to `connect`'s identity alone never
  // re-triggers a connection — only a genuine nonce advance does.
  const processedNonceRef = useRef(0);
  useEffect(() => {
    if (reconnectNonce !== processedNonceRef.current) {
      processedNonceRef.current = reconnectNonce;
      connect();
    }
  }, [reconnectNonce, connect]);

  // Reset connection state to "disconnected" the moment the provider is
  // disabled. Done as the "adjust state during render" pattern (rather than in
  // the socket effect below) so it never fires setState synchronously inside an
  // effect; the socket teardown side-effects still live in that effect. Keeping
  // the reset here also avoids a stuck "error" state re-triggering a connect on
  // re-enable.
  const [prevEnabled, setPrevEnabled] = useState(enabled);
  if (prevEnabled !== enabled) {
    setPrevEnabled(enabled);
    if (!enabled) setConnectionState("disconnected");
  }

  // Mount/unmount the socket based on enabled + authDeps. When authDeps change
  // (e.g. org switch, share token change) we tear down and re-open with the
  // new handshake.
  useEffect(() => {
    if (!enabled) {
      if (socketRef.current) {
        socketRef.current.close(1000);
        socketRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      return;
    }

    connectionAttemptRef.current = 0;
    connect();

    return () => {
      if (socketRef.current) {
        socketRef.current.close(1000);
        socketRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, connect, ...authDeps]);

  // Auto-reconnect when the tab regains visibility if we're in "error" state.
  useEffect(() => {
    if (
      isPageVisible &&
      enabled &&
      connectionState === "error" &&
      !socketRef.current
    ) {
      connectionAttemptRef.current = 0;
      connect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPageVisible, enabled, connectionState]);

  // Send the current subscription union whenever it changes or we (re)connect.
  useEffect(() => {
    if (connectionState !== "connected") return;
    const { metrics, cameras } = unionRef.current;
    if (metrics.length > 0) {
      send({ type: "subscribe", metrics });
    }
    if (cameras.length > 0) {
      send({ type: "subscribe", cameras });
    }
  }, [connectionState, unionKey, send]);

  // Tell the gateway to throttle telemetry while the tab is hidden.
  // Debounced on the hidden transition so quick alt-tabs don't flap, fires
  // immediately on visible so returning users don't see added latency.
  useEffect(() => {
    if (connectionState !== "connected") return;
    if (isPageVisible) {
      send({ type: "set_throttle", enabled: false });
      return;
    }
    const t = setTimeout(
      () => send({ type: "set_throttle", enabled: true }),
      100,
    );
    return () => clearTimeout(t);
  }, [connectionState, isPageVisible, send]);

  // Stale tracker — move any source from online → idle (>30s) → stale (>60s)
  // based on the last telemetry point we received.
  useEffect(() => {
    if (connectionState !== "connected") return;

    const interval = setInterval(() => {
      const now = Date.now();
      const timestamps = sourceTimestampsRef.current;
      setSources((prev) => {
        let changed = false;
        const next = prev.map((s) => {
          if (
            s.status !== "online" &&
            s.status !== "idle" &&
            s.status !== "stale"
          )
            return s;

          const ts = timestamps.get(s.source_id);
          const lastDataStr = ts?.lastDataAt ?? s.lastDataAt;
          if (!lastDataStr) return s;

          const elapsed = now - new Date(lastDataStr).getTime();

          if (elapsed > MINUTE_MS && s.status === "online") {
            changed = true;
            return { ...s, status: "stale" as const };
          }
          if (
            elapsed > 30 * SECOND_MS &&
            elapsed <= MINUTE_MS &&
            s.status === "online"
          ) {
            changed = true;
            return { ...s, status: "idle" as const };
          }
          return s;
        });
        return changed ? next : prev;
      });
    }, 30 * SECOND_MS);

    return () => clearInterval(interval);
  }, [connectionState]);

  // ----- Subscription API exposed to consumers ------------------------------
  const subscribe = useCallback(
    (consumerId: string, entry: SubscriptionEntry) => {
      setSubs((prev) => {
        const next = new Map(prev);
        next.set(consumerId, entry);
        return next;
      });
      return () => {
        setSubs((prev) => {
          if (!prev.has(consumerId)) return prev;
          const next = new Map(prev);
          next.delete(consumerId);
          return next;
        });
      };
    },
    [],
  );

  const setStreamConfig = useCallback(
    (sourceId: string, patch: Partial<StreamConfig>) => {
      setStreamConfigs((prev) => ({
        ...prev,
        [sourceId]: {
          intervalMs: patch.intervalMs ?? prev[sourceId]?.intervalMs ?? 100,
          isStreaming:
            patch.isStreaming ?? prev[sourceId]?.isStreaming ?? false,
          store: patch.store ?? prev[sourceId]?.store ?? false,
        },
      }));
    },
    [],
  );

  const reconnect = useCallback(() => {
    connectionAttemptRef.current = 0;
    connect();
  }, [connect]);

  const markSourceDeleted = useCallback(
    (slug: string, ttlMs: number = 30_000) => {
      const expireAt = Date.now() + ttlMs;
      setTombstones((prev) => {
        const next = new Map(prev);
        next.set(slug, expireAt);
        return next;
      });
      // Drop any current entries matching this slug so the UI flips
      // instantly without waiting for the next render cycle.
      setSources((prev) => prev.filter((s) => slugOf(s.source_id) !== slug));
      // Prune the tombstone once the window elapses so the slug can reappear.
      setTimeout(() => {
        setTombstones((prev) => {
          const exp = prev.get(slug);
          if (exp == null || Date.now() < exp) return prev;
          const next = new Map(prev);
          next.delete(slug);
          return next;
        });
      }, ttlMs);
    },
    [],
  );

  // Filter `sources` through the tombstone set — pure membership check; the
  // map only contains live entries (expired ones are pruned by the timer).
  const visibleSources = useMemo(
    () => sources.filter((s) => !tombstones.has(slugOf(s.source_id))),
    [sources, tombstones],
  );

  // ----- Context value -------------------------------------------------------
  const value = useMemo<GatewayConnectionValue>(
    () => ({
      telemetryStore: store,
      videoFrameStore: videoStore,
      sources: visibleSources,
      connectionState,
      isConnected: connectionState === "connected",
      isPageVisible,
      error,
      streamConfigs,
      setStreamConfig,
      subscribe,
      send,
      reconnect,
      reconnectAttempt,
      maxReconnectAttempts: maxAttempts,
      markSourceDeleted,
    }),
    [
      store,
      videoStore,
      visibleSources,
      connectionState,
      isPageVisible,
      error,
      streamConfigs,
      setStreamConfig,
      subscribe,
      send,
      reconnect,
      reconnectAttempt,
      maxAttempts,
      markSourceDeleted,
    ],
  );

  return (
    <GatewayConnectionContext.Provider value={value}>
      {children}
    </GatewayConnectionContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Auth variants
// ---------------------------------------------------------------------------

export function AuthenticatedRealtimeProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { getGatewayToken, orgId, isSignedIn } = usePlexusSession();

  const getTokenRef = useRef(getGatewayToken);
  useEffect(() => {
    getTokenRef.current = getGatewayToken;
  });

  const getAuthMessage = useCallback(async () => {
    // Short-lived ws-token minted by /api/auth/ws-token; the gateway
    // resolves it via /api/auth/verify-session.
    const token = await getTokenRef.current();
    if (!token) return null;
    return { type: "browser_auth", token };
  }, []);

  return (
    <GatewayConnectionProviderImpl
      enabled={!!isSignedIn && !!orgId}
      getAuthMessage={getAuthMessage}
      authDeps={[orgId, isSignedIn]}
    >
      {children}
    </GatewayConnectionProviderImpl>
  );
}

export function SharedRealtimeProvider({
  children,
  shareToken,
  enabled = true,
}: {
  children: ReactNode;
  shareToken: string | null | undefined;
  /** Optional extra gate — e.g. wait until share-link data resolves. */
  enabled?: boolean;
}) {
  const shareTokenRef = useRef(shareToken);
  useEffect(() => {
    shareTokenRef.current = shareToken;
  });

  const getAuthMessage = useCallback(async () => {
    const token = shareTokenRef.current;
    if (!token) return null;
    return { type: "share_auth", token };
  }, []);

  return (
    <GatewayConnectionProviderImpl
      enabled={enabled && !!shareToken}
      getAuthMessage={getAuthMessage}
      authDeps={[shareToken]}
      maxAttempts={3}
    >
      {children}
    </GatewayConnectionProviderImpl>
  );
}
