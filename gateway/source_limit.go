package main

// SourceRateLimiter enforces a hard ceiling on telemetry message frequency
// per (org, source) pair. Messages arriving faster than the ceiling are
// dropped.
//
// This is a safety net, not a tuning knob. It protects Redis and downstream
// consumers from misbehaving or malicious devices. Per-sensor rate control
// happens on the device (BaseSensor.sample_rate); per-metric downsampling
// and importance-based policies are handled downstream.
//
// Implementation: one time.Time per source tracking the last accepted
// telemetry message. On each arrival, compute the minimum interval
// (1/maxHz) and drop if too soon.

import (
	"sync"
	"time"
)

type SourceRateLimiter struct {
	minInterval time.Duration
	mu          sync.Mutex
	lastSeen    map[string]time.Time
	// ops counts Allow calls since the last stale-entry sweep. Guarded by mu.
	ops int
}

// Sweep tuning. HTTP /ingest sources are never Forgotten (only WS disconnect
// calls Forget), so without a sweep the map grows one entry per source ever
// seen. An entry only influences rate limiting within minInterval (~1ms), so
// evicting anything idle for sweepIdleAfter is behaviorally harmless — worst
// case a returning source gets its first message accepted unconditionally,
// which is true for brand-new sources anyway.
const (
	sweepEveryOps  = 4096
	sweepIdleAfter = time.Minute
)

func NewSourceRateLimiter(maxHz float64) *SourceRateLimiter {
	if maxHz <= 0 {
		maxHz = 1000
	}
	interval := time.Duration(float64(time.Second) / maxHz)
	return &SourceRateLimiter{
		minInterval: interval,
		lastSeen:    make(map[string]time.Time),
	}
}

// Allow returns true if a telemetry message from this source should be
// accepted, false if it should be dropped for exceeding the rate ceiling.
func (s *SourceRateLimiter) Allow(orgID, sourceID string) bool {
	key := orgID + ":" + sourceID
	now := time.Now()

	s.mu.Lock()
	defer s.mu.Unlock()

	s.ops++
	if s.ops >= sweepEveryOps {
		s.ops = 0
		for k, t := range s.lastSeen {
			if now.Sub(t) > sweepIdleAfter {
				delete(s.lastSeen, k)
			}
		}
	}

	last, ok := s.lastSeen[key]
	if ok && now.Sub(last) < s.minInterval {
		return false
	}
	s.lastSeen[key] = now
	return true
}

// Forget removes a source from the tracking map. Called when a device
// disconnects to prevent unbounded growth for short-lived devices.
func (s *SourceRateLimiter) Forget(orgID, sourceID string) {
	key := orgID + ":" + sourceID
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.lastSeen, key)
}
