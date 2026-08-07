package main

import (
	"testing"
	"time"
)

func testRateLimitConfig() RateLimitConfig {
	return RateLimitConfig{
		ControlBurst:    5,
		ControlPerSec:   2,
		TelemetryBurst:  10,
		TelemetryPerSec: 5,
	}
}

func TestRateLimiter_BurstAllowed(t *testing.T) {
	rl := NewRateLimiter(testRateLimitConfig())

	// Burst up to capacity should all pass.
	for i := 0; i < 10; i++ {
		if !rl.Consume(tierTelemetry) {
			t.Fatalf("telemetry message %d dropped within burst", i)
		}
	}
}

func TestRateLimiter_OverBurstDropped(t *testing.T) {
	rl := NewRateLimiter(testRateLimitConfig())

	// Drain the bucket.
	for i := 0; i < 10; i++ {
		rl.Consume(tierTelemetry)
	}
	// Next call should fail (no tokens, no time for refill).
	if rl.Consume(tierTelemetry) {
		t.Fatal("expected drop after burst exhausted")
	}
}

func TestRateLimiter_Refill(t *testing.T) {
	rl := NewRateLimiter(testRateLimitConfig())

	// Drain.
	for i := 0; i < 10; i++ {
		rl.Consume(tierTelemetry)
	}
	// At 5 tokens/sec, 500ms should refill ~2.5 tokens.
	time.Sleep(500 * time.Millisecond)

	allowed := 0
	for i := 0; i < 5; i++ {
		if rl.Consume(tierTelemetry) {
			allowed++
		}
	}
	// We expect 2 or 3 tokens available after 500ms.
	if allowed < 2 || allowed > 3 {
		t.Errorf("expected 2-3 tokens after refill, got %d", allowed)
	}
}

func TestRateLimiter_TiersIndependent(t *testing.T) {
	rl := NewRateLimiter(testRateLimitConfig())

	// Drain telemetry.
	for i := 0; i < 10; i++ {
		rl.Consume(tierTelemetry)
	}
	// Control should still have its full burst.
	allowed := 0
	for i := 0; i < 5; i++ {
		if rl.Consume(tierControl) {
			allowed++
		}
	}
	if allowed != 5 {
		t.Errorf("expected 5 control tokens unaffected by telemetry drain, got %d", allowed)
	}
}

func TestRateLimiter_ControlBurst(t *testing.T) {
	rl := NewRateLimiter(testRateLimitConfig())

	// Control burst is 5. 6th should drop.
	for i := 0; i < 5; i++ {
		if !rl.Consume(tierControl) {
			t.Fatalf("control message %d dropped within burst", i)
		}
	}
	if rl.Consume(tierControl) {
		t.Fatal("expected control drop after 5 in burst")
	}
}

func TestTierForType(t *testing.T) {
	tests := map[string]rateTier{
		"telemetry":    tierTelemetry,
		"video_frame":  tierTelemetry,
		"device_auth":  tierControl,
		"heartbeat":    tierControl,
		"browser_auth": tierControl,
		"start_stream": tierControl,
		"stop_stream":  tierControl,
		"configure":    tierControl,
		"ping":         tierControl,
		"pong":         tierControl,
		"unknown":      tierControl, // unknown → control (safer default)
	}

	for msgType, want := range tests {
		got := tierForType(msgType)
		if got != want {
			t.Errorf("tierForType(%q): got %v, want %v", msgType, got, want)
		}
	}
}
