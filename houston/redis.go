package main

// Redis client wrapper — XREADGROUP, XACK, circuit breaker.
//
// Adapted from the gateway's redis.go. The alert service only reads from
// streams (no XADD), so write operations are omitted.

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// circuitState represents the breaker's current mode.
type circuitState int

const (
	circuitClosed circuitState = iota // normal operation
	circuitOpen                       // Redis unreachable, fast-fail
)

// Circuit breaker tuning — same values as gateway.
const (
	circuitFailThreshold = 5
	circuitProbeInterval = 5 * time.Second
	circuitProbeTimeout  = 1 * time.Second
)

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
		Addr:     cfg.Addr,
		PoolSize: cfg.PoolSize,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		return nil, err
	}

	return &RedisClient{client: client, cfg: cfg}, nil
}

// =========================================================================
// Circuit breaker
// =========================================================================

func (rc *RedisClient) Healthy() bool {
	rc.mu.RLock()
	defer rc.mu.RUnlock()
	return rc.state == circuitClosed
}

// isConnectivityFailure reports whether err indicates Redis is unreachable,
// as opposed to a command-level error reply (NOGROUP, BUSYGROUP, WRONGTYPE…).
// An error REPLY proves the connection works — counting those as failures
// lets a single broken consumer group open the shared circuit and starve
// every other org's evaluation.
func isConnectivityFailure(err error) bool {
	if err == nil || errors.Is(err, redis.Nil) || errors.Is(err, context.Canceled) {
		return false
	}
	var replyErr redis.Error
	return !errors.As(err, &replyErr)
}

func (rc *RedisClient) recordResult(err error) {
	rc.mu.Lock()
	defer rc.mu.Unlock()

	if !isConnectivityFailure(err) {
		wasOpen := rc.state == circuitOpen
		rc.consecutiveFails = 0
		rc.state = circuitClosed
		if wasOpen {
			slog.Info("redis circuit recovered", "addr", rc.cfg.Addr)
		}
		return
	}

	rc.consecutiveFails++
	if rc.consecutiveFails >= circuitFailThreshold && rc.state == circuitClosed {
		rc.state = circuitOpen
		slog.Error("redis circuit opened", "addr", rc.cfg.Addr, "consecutive_fails", rc.consecutiveFails)
	}
}

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
			rc.recordResult(err)
		}
	}
}

// =========================================================================
// Key builders
// =========================================================================

func streamKey(orgID string) string {
	return "telemetry.stream:" + orgID
}

// =========================================================================
// Read operations
// =========================================================================

func (rc *RedisClient) XReadGroup(ctx context.Context, orgID, group, consumer string, count int64, block time.Duration) ([]redis.XStream, error) {
	if !rc.Healthy() {
		return nil, ErrRedisCircuitOpen
	}
	result, err := rc.client.XReadGroup(ctx, &redis.XReadGroupArgs{
		Group:    group,
		Consumer: consumer,
		Streams:  []string{streamKey(orgID), ">"},
		Count:    count,
		Block:    block,
	}).Result()
	rc.recordResult(err)
	return result, err
}

func (rc *RedisClient) XAck(ctx context.Context, orgID, group string, ids ...string) error {
	if !rc.Healthy() {
		return ErrRedisCircuitOpen
	}
	err := rc.client.XAck(ctx, streamKey(orgID), group, ids...).Err()
	rc.recordResult(err)
	return err
}

// XAutoClaim reclaims pending entries idle longer than minIdle from any
// consumer in the group, reassigning them to `consumer`. Returns the
// claimed messages so the caller can reprocess them. `start` is the
// cursor from the previous call, or "0-0" to begin.
func (rc *RedisClient) XAutoClaim(ctx context.Context, orgID, group, consumer string, minIdle time.Duration, start string, count int64) ([]redis.XMessage, string, error) {
	if !rc.Healthy() {
		return nil, start, ErrRedisCircuitOpen
	}
	msgs, nextStart, err := rc.client.XAutoClaim(ctx, &redis.XAutoClaimArgs{
		Stream:   streamKey(orgID),
		Group:    group,
		Consumer: consumer,
		MinIdle:  minIdle,
		Start:    start,
		Count:    count,
	}).Result()
	rc.recordResult(err)
	return msgs, nextStart, err
}

func (rc *RedisClient) XGroupCreateMkStream(ctx context.Context, orgID, group string) error {
	if !rc.Healthy() {
		return ErrRedisCircuitOpen
	}
	err := rc.client.XGroupCreateMkStream(ctx, streamKey(orgID), group, "$").Err()
	if err != nil && isBusyGroupErr(err) {
		rc.recordResult(nil)
		return nil
	}
	rc.recordResult(err)
	return err
}

func isBusyGroupErr(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "BUSYGROUP")
}

func (rc *RedisClient) Ping(ctx context.Context) error {
	return rc.client.Ping(ctx).Err()
}

func (rc *RedisClient) Close() error {
	return rc.client.Close()
}
