package main

import (
	"errors"
	"testing"

	"github.com/redis/go-redis/v9"
)

// These tests exercise the circuit breaker state machine directly, without
// needing a live Redis. We're testing recordResult's state transitions.

func newTestRedisClient() *RedisClient {
	// Client is never dialed; we just need a value to call recordResult on.
	return &RedisClient{}
}

func TestCircuit_StartsClosed(t *testing.T) {
	rc := newTestRedisClient()
	if !rc.Healthy() {
		t.Fatal("circuit should start closed (healthy)")
	}
}

func TestCircuit_OpensAfterConsecutiveFailures(t *testing.T) {
	rc := newTestRedisClient()
	err := errors.New("dial tcp: connection refused")

	// Below threshold: should stay closed
	for i := 0; i < circuitFailThreshold-1; i++ {
		rc.recordResult(err)
		if !rc.Healthy() {
			t.Fatalf("circuit opened prematurely at failure %d", i+1)
		}
	}

	// At threshold: should open
	rc.recordResult(err)
	if rc.Healthy() {
		t.Fatal("circuit should be open at fail threshold")
	}
}

func TestCircuit_ClosesOnSuccessAfterOpen(t *testing.T) {
	rc := newTestRedisClient()
	err := errors.New("dial tcp: connection refused")

	// Drive to open.
	for i := 0; i < circuitFailThreshold; i++ {
		rc.recordResult(err)
	}
	if rc.Healthy() {
		t.Fatal("circuit should be open")
	}

	// Success closes it.
	rc.recordResult(nil)
	if !rc.Healthy() {
		t.Fatal("circuit should close after success")
	}
}

func TestCircuit_SuccessResetsFailCount(t *testing.T) {
	rc := newTestRedisClient()
	err := errors.New("dial tcp: connection refused")

	// Accumulate some failures (below threshold).
	for i := 0; i < circuitFailThreshold-1; i++ {
		rc.recordResult(err)
	}
	// Success in the middle should reset the counter.
	rc.recordResult(nil)

	// Now one more failure shouldn't open the circuit.
	rc.recordResult(err)
	if !rc.Healthy() {
		t.Fatal("circuit should stay closed because success reset the counter")
	}
}

// commandReplyErr mimics the redis.Error interface go-redis uses for -ERR
// style replies (NOGROUP, BUSYGROUP, WRONGTYPE…).
type commandReplyErr string

func (e commandReplyErr) Error() string { return string(e) }
func (e commandReplyErr) RedisError()   {}

func TestCircuit_CommandReplyNotAFailure(t *testing.T) {
	// A command-error reply proves Redis answered — it must never open the
	// circuit. A persistent NOGROUP from one consumer starving every other
	// caller on the shared client is exactly the incident this guards against.
	rc := newTestRedisClient()

	replyErr := commandReplyErr("NOGROUP No such key 'telemetry.stream:org_x' or consumer group 'g'")
	for i := 0; i < circuitFailThreshold*2; i++ {
		rc.recordResult(replyErr)
	}
	if !rc.Healthy() {
		t.Fatal("command-error replies should not open the circuit")
	}

	// And a reply arriving while the circuit is open proves recovery.
	dial := errors.New("dial tcp: connection refused")
	for i := 0; i < circuitFailThreshold; i++ {
		rc.recordResult(dial)
	}
	if rc.Healthy() {
		t.Fatal("circuit should be open after dial failures")
	}
	rc.recordResult(replyErr)
	if !rc.Healthy() {
		t.Fatal("a command reply proves connectivity and should close the circuit")
	}
}

func TestCircuit_RedisNilNotAFailure(t *testing.T) {
	// redis.Nil (key missing or empty result) is a normal outcome, not a
	// connection failure. It should not count toward the failure threshold.
	rc := newTestRedisClient()

	// Hammer with redis.Nil responses.
	for i := 0; i < circuitFailThreshold*2; i++ {
		rc.recordResult(redis.Nil)
	}
	if !rc.Healthy() {
		t.Fatal("redis.Nil should not open the circuit")
	}
}
