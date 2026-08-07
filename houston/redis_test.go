package main

// Circuit-breaker error classification. The June/July 2026 incident: a
// NOGROUP reply (consumer group lost after a Redis restart) was counted as
// a connectivity failure, opening the SHARED circuit every few seconds and
// starving every org's evaluation — alerts delivered ~1 hour late.

import (
	"context"
	"errors"
	"net"
	"testing"

	"github.com/redis/go-redis/v9"
)

func TestIsConnectivityFailure(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"redis.Nil (empty read)", redis.Nil, false},
		{"context canceled (shutdown)", context.Canceled, false},
		{"NOGROUP reply", redisReplyErr("NOGROUP No such key 'telemetry.stream:org_x' or consumer group 'alerts'"), false},
		{"BUSYGROUP reply", redisReplyErr("BUSYGROUP Consumer Group name already exists"), false},
		{"WRONGTYPE reply", redisReplyErr("WRONGTYPE Operation against a key holding the wrong kind of value"), false},
		{"deadline exceeded (slow/dead redis)", context.DeadlineExceeded, true},
		{"dial error", &net.OpError{Op: "dial", Err: errors.New("connection refused")}, true},
		{"generic transport error", errors.New("EOF"), true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isConnectivityFailure(tc.err); got != tc.want {
				t.Errorf("isConnectivityFailure(%v) = %v, want %v", tc.err, got, tc.want)
			}
		})
	}
}

func TestIsNoGroupErr(t *testing.T) {
	if !isNoGroupErr(redisReplyErr("NOGROUP No such key 'telemetry.stream:org_x' or consumer group 'alerts' in XREADGROUP with GROUP option")) {
		t.Error("NOGROUP reply not detected")
	}
	if isNoGroupErr(redis.Nil) {
		t.Error("redis.Nil must not be treated as NOGROUP")
	}
	if isNoGroupErr(nil) {
		t.Error("nil must not be treated as NOGROUP")
	}
}

// redisReplyErr builds an error that satisfies the redis.Error interface,
// the same shape go-redis returns for -ERR style replies.
func redisReplyErr(msg string) error {
	return replyError(msg)
}

type replyError string

func (e replyError) Error() string { return string(e) }
func (e replyError) RedisError()   {}
