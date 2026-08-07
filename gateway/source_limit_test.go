package main

import (
	"sync"
	"testing"
	"time"
)

func TestSourceRateLimiter_UnderLimit(t *testing.T) {
	// 100 Hz ceiling → 10ms minimum interval.
	// Messages 15ms apart should all pass.
	rl := NewSourceRateLimiter(100)

	for i := 0; i < 5; i++ {
		if !rl.Allow("org", "device-a") {
			t.Fatalf("message %d dropped unexpectedly", i)
		}
		time.Sleep(15 * time.Millisecond)
	}
}

func TestSourceRateLimiter_OverLimit(t *testing.T) {
	// 10 Hz ceiling → 100ms minimum interval.
	// Hammer with 20 messages back-to-back; only the first should pass.
	rl := NewSourceRateLimiter(10)

	allowed := 0
	for i := 0; i < 20; i++ {
		if rl.Allow("org", "device-a") {
			allowed++
		}
	}
	if allowed != 1 {
		t.Fatalf("expected 1 allowed, got %d", allowed)
	}
}

func TestSourceRateLimiter_RefillAfterInterval(t *testing.T) {
	// 100 Hz ceiling → 10ms minimum interval.
	rl := NewSourceRateLimiter(100)

	if !rl.Allow("org", "device-a") {
		t.Fatal("first message should pass")
	}
	// Immediate second message should drop.
	if rl.Allow("org", "device-a") {
		t.Fatal("immediate second message should drop")
	}
	// After 15ms (>10ms interval), should pass again.
	time.Sleep(15 * time.Millisecond)
	if !rl.Allow("org", "device-a") {
		t.Fatal("message after interval should pass")
	}
}

func TestSourceRateLimiter_PerSourceIndependence(t *testing.T) {
	// Two sources should not interfere with each other.
	rl := NewSourceRateLimiter(10) // 100ms interval

	if !rl.Allow("org", "device-a") {
		t.Fatal("device-a first message should pass")
	}
	if !rl.Allow("org", "device-b") {
		t.Fatal("device-b first message should pass (independent of device-a)")
	}
	// Immediate retry for both should drop.
	if rl.Allow("org", "device-a") {
		t.Fatal("device-a second message should drop")
	}
	if rl.Allow("org", "device-b") {
		t.Fatal("device-b second message should drop")
	}
}

func TestSourceRateLimiter_PerOrgIndependence(t *testing.T) {
	// Same source ID in different orgs should not interfere.
	rl := NewSourceRateLimiter(10)

	if !rl.Allow("org-a", "device-1") {
		t.Fatal("org-a/device-1 should pass")
	}
	if !rl.Allow("org-b", "device-1") {
		t.Fatal("org-b/device-1 should pass (different org)")
	}
}

func TestSourceRateLimiter_Forget(t *testing.T) {
	// After Forget, a previously rate-limited source gets a fresh slate.
	rl := NewSourceRateLimiter(10) // 100ms interval

	rl.Allow("org", "device-a")
	if rl.Allow("org", "device-a") {
		t.Fatal("immediate second should drop")
	}

	rl.Forget("org", "device-a")

	// After forgetting, next message should pass without waiting.
	if !rl.Allow("org", "device-a") {
		t.Fatal("message after Forget should pass")
	}
}

func TestSourceRateLimiter_ZeroOrNegativeMaxHz(t *testing.T) {
	// Constructor defaults to 1000 Hz for invalid input, so it shouldn't
	// panic or permanently block. A tight loop should allow ~1/ms.
	rl := NewSourceRateLimiter(0)

	allowed := 0
	for i := 0; i < 10; i++ {
		if rl.Allow("org", "device-a") {
			allowed++
		}
	}
	// At 1000 Hz with ~0ms gaps, most drops. At least one should pass.
	if allowed < 1 {
		t.Fatalf("expected at least 1 allowed with default fallback, got %d", allowed)
	}
}

// Concurrent access. Run with `go test -race`.
func TestSourceRateLimiter_ConcurrentAccess(t *testing.T) {
	rl := NewSourceRateLimiter(1000)
	const goroutines = 50
	const perGoroutine = 100

	var wg sync.WaitGroup
	wg.Add(goroutines)
	for g := 0; g < goroutines; g++ {
		go func(gid int) {
			defer wg.Done()
			sourceID := "src-" + string(rune('a'+gid))
			for i := 0; i < perGoroutine; i++ {
				rl.Allow("org", sourceID)
			}
		}(g)
	}
	wg.Wait()
	// No assertion beyond "didn't panic / no data race".
}

func TestSourceRateLimiter_ForgetUnknownSource(t *testing.T) {
	// Forgetting a source that was never seen should not panic.
	rl := NewSourceRateLimiter(100)
	rl.Forget("org", "never-existed")
}
