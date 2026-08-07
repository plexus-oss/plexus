package main

// Redis client wrapper — XADD, XREADGROUP, config reads.
//
// Includes a simple circuit breaker: after N consecutive failures, the
// client flips to "open" state and fast-fails all writes/reads until a
// background probe (Ping) succeeds. This prevents the gateway from silently
// dropping messages under a Redis outage while keeping latency low for
// incoming traffic (no waiting on dial timeouts).
//
// Devices have their own SQLite store-and-forward buffer on the other side
// of the WebSocket, so circuit-open handling is graceful: new device
// connections and HTTP /ingest are rejected with 503, and an already-
// connected WS device whose telemetry XADD hits the open circuit gets an
// error frame + close (handleTelemetry in device.go) so its SDK reconnects,
// buffers locally, and drains when Redis recovers.

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/klauspost/compress/zstd"
	"github.com/redis/go-redis/v9"
)

var (
	zstdEnc *zstd.Encoder
	zstdDec *zstd.Decoder
)

func init() {
	var err error
	if zstdEnc, err = zstd.NewWriter(nil, zstd.WithEncoderLevel(zstd.SpeedFastest)); err != nil {
		panic(err)
	}
	if zstdDec, err = zstd.NewReader(nil); err != nil {
		panic(err)
	}
}

// circuitState represents the breaker's current mode.
type circuitState int

const (
	circuitClosed circuitState = iota // normal operation, writes go through
	circuitOpen                       // Redis unreachable, fast-fail writes
)

// Circuit breaker tuning. These are not user-configurable — they're
// protection-from-bad-days defaults, not tunables.
const (
	// Consecutive failures before opening the circuit.
	circuitFailThreshold = 5

	// How often the probe goroutine attempts Ping while the circuit is open.
	circuitProbeInterval = 5 * time.Second

	// Per-probe Ping timeout (shorter than regular calls — we want fast feedback).
	circuitProbeTimeout = 1 * time.Second
)

// ErrRedisCircuitOpen is returned by write methods when the circuit is open.
var ErrRedisCircuitOpen = errors.New("redis circuit open")

type RedisClient struct {
	client *redis.Client
	cfg    RedisConfig

	mu               sync.RWMutex
	state            circuitState
	consecutiveFails int
}

func NewRedisClient(cfg RedisConfig) (*RedisClient, error) {
	client := redis.NewClient(&redis.Options{
		Addr:            cfg.Addr,
		PoolSize:        cfg.PoolSize,
		ConnMaxLifetime: 30 * time.Minute,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		return nil, err
	}

	return &RedisClient{client: client, cfg: cfg}, nil
}

// =========================================================================
// Circuit breaker state management
// =========================================================================

// Healthy returns true if the circuit is closed (Redis is reachable).
// Cheap read — uses an RLock.
func (rc *RedisClient) Healthy() bool {
	rc.mu.RLock()
	defer rc.mu.RUnlock()
	return rc.state == circuitClosed
}

// isConnectivityFailure reports whether err indicates Redis is unreachable,
// as opposed to a command-level error reply (BUSYGROUP, NOGROUP, WRONGTYPE…).
// An error REPLY proves the connection works — counting replies as failures
// let a single persistent command error open the shared circuit and fast-fail
// every producer and consumer on this client (the July 2026 alert-latency
// incident, fixed first in the alert service).
func isConnectivityFailure(err error) bool {
	if err == nil || errors.Is(err, redis.Nil) || errors.Is(err, context.Canceled) {
		return false
	}
	var replyErr redis.Error
	return !errors.As(err, &replyErr)
}

// recordResult updates the circuit breaker state based on an operation outcome.
// On success (or a command-error reply, which proves connectivity), resets the
// failure count and closes the circuit if it was open. On connectivity failure,
// increments the failure count and opens the circuit at the threshold.
func (rc *RedisClient) recordResult(err error) {
	rc.mu.Lock()
	defer rc.mu.Unlock()

	if !isConnectivityFailure(err) {
		rc.consecutiveFails = 0
		rc.state = circuitClosed
		return
	}

	rc.consecutiveFails++
	if rc.consecutiveFails >= circuitFailThreshold && rc.state == circuitClosed {
		rc.state = circuitOpen
	}
}

// RunProbe runs a background Ping loop that closes the circuit when Redis
// recovers. Called from main() with a long-lived context. Exits when the
// context is cancelled.
func (rc *RedisClient) RunProbe(ctx context.Context) {
	ticker := time.NewTicker(circuitProbeInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if rc.Healthy() {
				continue
			}

			probeCtx, cancel := context.WithTimeout(ctx, circuitProbeTimeout)
			err := rc.client.Ping(probeCtx).Err()
			cancel()

			if err != nil {
				slog.Warn("redis circuit probe failed", "addr", rc.cfg.Addr, "err", err)
			}

			wasOpen := !rc.Healthy()
			rc.recordResult(err)
			if wasOpen && rc.Healthy() {
				// State transition from open → closed. Log it.
				slog.Info("redis circuit recovered", "addr", rc.cfg.Addr)
			}
		}
	}
}

// =========================================================================
// Key builders
// =========================================================================

func streamKey(orgID string) string {
	return "telemetry.stream:" + orgID
}

const videoSessionsStream = "video_sessions.stream"

// DecompressEntry decompresses a zstd-compressed stream entry value.
// The data field is stored as []byte in Redis; go-redis surfaces it as a
// string, so callers cast msg.Values["data"].(string) then pass []byte(s).
func DecompressEntry(compressed []byte) ([]byte, error) {
	return zstdDec.DecodeAll(compressed, nil)
}

// =========================================================================
// Write operations (circuit-aware)
// =========================================================================

// XAddVideoSession writes a browser video session record to the shared video
// sessions stream. Called once per browser disconnect (connection-level metering).
func (rc *RedisClient) XAddVideoSession(ctx context.Context, orgID string, cameraCount int, startedAt time.Time, durationS float64) error {
	if !rc.Healthy() {
		return ErrRedisCircuitOpen
	}
	err := rc.client.XAdd(ctx, &redis.XAddArgs{
		Stream: videoSessionsStream,
		MaxLen: 10_000,
		Approx: true,
		Values: map[string]any{
			"org_id":        orgID,
			"camera_count":  cameraCount,
			"started_at_ms": startedAt.UnixMilli(),
			"duration_s":    durationS,
		},
	}).Err()
	rc.recordResult(err)
	return err
}

// XAddTelemetry writes a single entry to the org's telemetry stream.
// Telemetry messages are batched into a v:2 envelope at the caller, so
// this is one XADD per telemetry message (not per point) and one XADD per
// heartbeat / device_error.
// Returns ErrRedisCircuitOpen if the circuit breaker is open.
func (rc *RedisClient) XAddTelemetry(ctx context.Context, orgID string, data []byte) error {
	if !rc.Healthy() {
		return ErrRedisCircuitOpen
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	err := rc.client.XAdd(ctx, &redis.XAddArgs{
		Stream: streamKey(orgID),
		MaxLen: rc.cfg.StreamMaxLen,
		Approx: true,
		Values: map[string]any{"data": zstdEnc.EncodeAll(data, nil)},
	}).Err()
	rc.recordResult(err)
	return err
}

// =========================================================================
// Read operations (circuit-aware)
// =========================================================================

// XReadGroup reads from a consumer group. Honors the circuit breaker —
// returns ErrRedisCircuitOpen instead of dialing a dead Redis.
// When noAck is true, entries are not added to the PEL — suitable for
// live broadcast groups where replay is never needed.
func (rc *RedisClient) XReadGroup(ctx context.Context, orgID, group, consumer string, count int64, block time.Duration, noAck bool) ([]redis.XStream, error) {
	if !rc.Healthy() {
		return nil, ErrRedisCircuitOpen
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	result, err := rc.client.XReadGroup(ctx, &redis.XReadGroupArgs{
		Group:    group,
		Consumer: consumer,
		Streams:  []string{streamKey(orgID), ">"},
		Count:    count,
		Block:    block,
		NoAck:    noAck,
	}).Result()
	rc.recordResult(err)
	return result, err
}

// XGroupCreateMkStream creates a consumer group idempotently.
func (rc *RedisClient) XGroupCreateMkStream(ctx context.Context, orgID, group string) error {
	if !rc.Healthy() {
		return ErrRedisCircuitOpen
	}
	err := rc.client.XGroupCreateMkStream(ctx, streamKey(orgID), group, "$").Err()
	if err != nil && isBusyGroupErr(err) {
		rc.recordResult(nil) // group-already-exists is not a failure
		return nil
	}
	rc.recordResult(err)
	return err
}

// XGroupDestroy removes a consumer group from the stream.
// Used on reader start to clean this instance's own prior group (the one
// named "dashboard:<thisInstanceID>") before recreating it — it does NOT
// sweep orphaned groups left by other/replaced instances.
// Redis returns 0 (no error) if the group doesn't exist, so this is
// safe to call unconditionally.
func (rc *RedisClient) XGroupDestroy(ctx context.Context, orgID, group string) error {
	if !rc.Healthy() {
		return ErrRedisCircuitOpen
	}
	err := rc.client.XGroupDestroy(ctx, streamKey(orgID), group).Err()
	rc.recordResult(err)
	return err
}

// XGroupSetID resets a consumer group cursor to "$" (newest entry).
// Used on reader start so a live dashboard never replays stale backlog.
func (rc *RedisClient) XGroupSetID(ctx context.Context, orgID, group string) error {
	if !rc.Healthy() {
		return ErrRedisCircuitOpen
	}
	err := rc.client.XGroupSetID(ctx, streamKey(orgID), group, "$").Err()
	rc.recordResult(err)
	return err
}

func isBusyGroupErr(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "BUSYGROUP")
}

// isNoGroupErr reports whether err is Redis's NOGROUP reply — the stream key
// or consumer group is gone (Redis restart, flushed keyspace, or a group
// create that failed at reader start under an open circuit). Same detection
// houston uses for its self-healing consumers.
func isNoGroupErr(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "NOGROUP")
}

// Ping verifies Redis connectivity. Bypasses the circuit breaker — used by
// /health and the probe goroutine.
func (rc *RedisClient) Ping(ctx context.Context) error {
	return rc.client.Ping(ctx).Err()
}

func (rc *RedisClient) Close() error {
	return rc.client.Close()
}
