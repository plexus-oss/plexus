package main

// Per-connection token bucket rate limiter.
//
// Two tiers:
//   - "control": commands (subscribe, start/stop, configure)
//   - "telemetry": high-frequency data (telemetry, video_frame)

import (
	"sync"
	"time"
)

type rateTier int

const (
	tierControl rateTier = iota
	tierTelemetry
)

type bucket struct {
	tokens     float64
	lastRefill time.Time
	capacity   float64
	refillRate float64 // tokens per second
}

type RateLimiter struct {
	mu        sync.Mutex
	control   bucket
	telemetry bucket
}

// NewRateLimiter creates a new per-connection rate limiter using the given config.
func NewRateLimiter(cfg RateLimitConfig) *RateLimiter {
	now := time.Now()
	return &RateLimiter{
		control: bucket{
			tokens:     float64(cfg.ControlBurst),
			lastRefill: now,
			capacity:   float64(cfg.ControlBurst),
			refillRate: float64(cfg.ControlPerSec),
		},
		telemetry: bucket{
			tokens:     float64(cfg.TelemetryBurst),
			lastRefill: now,
			capacity:   float64(cfg.TelemetryBurst),
			refillRate: float64(cfg.TelemetryPerSec),
		},
	}
}

func (rl *RateLimiter) Consume(tier rateTier) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	var b *bucket
	if tier == tierControl {
		b = &rl.control
	} else {
		b = &rl.telemetry
	}

	now := time.Now()
	elapsed := now.Sub(b.lastRefill).Seconds()
	if elapsed > 0 {
		b.tokens = min(b.capacity, b.tokens+elapsed*b.refillRate)
		b.lastRefill = now
	}

	if b.tokens >= 1 {
		b.tokens--
		return true
	}
	return false
}

func tierForType(msgType string) rateTier {
	switch msgType {
	case "telemetry", "video_frame":
		return tierTelemetry
	default:
		return tierControl
	}
}
