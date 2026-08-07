//go:build integration

package main

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

// Integration test — requires a real Redis at localhost:6379.
// Run with: go test -run TestRedisCompression -v -tags integration

func TestRedisCompression(t *testing.T) {
	cfg := RedisConfig{
		Addr:         "localhost:6379",
		PoolSize:     5,
		StreamMaxLen: 1000,
		CallTimeout:  2 * time.Second,
		PingTimeout:  500 * time.Millisecond,
	}

	rc, err := NewRedisClient(cfg)
	if err != nil {
		t.Fatalf("connect to Redis: %v", err)
	}
	defer rc.Close()

	// Build a realistic telemetry payload
	payload := map[string]any{
		"v": 2,
		"points": []map[string]any{
			{"name": "cpu.usage", "value": 42.7, "ts": time.Now().UnixMilli()},
			{"name": "mem.rss", "value": 1234567, "ts": time.Now().UnixMilli()},
		},
	}
	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	orgID := "test-compress-org"
	ctx := context.Background()

	// Write compressed entry
	if err := rc.XAddTelemetry(ctx, orgID, data); err != nil {
		t.Fatalf("XAddTelemetry: %v", err)
	}
	t.Logf("wrote %d bytes (uncompressed)", len(data))

	// Read it back directly
	raw, err := rc.client.XRange(ctx, streamKey(orgID), "-", "+").Result()
	if err != nil {
		t.Fatalf("XRANGE: %v", err)
	}
	if len(raw) == 0 {
		t.Fatal("no entries in stream after XAdd")
	}

	entry := raw[len(raw)-1]
	compressed, ok := entry.Values["data"].(string)
	if !ok {
		t.Fatalf("data field missing or wrong type: %T", entry.Values["data"])
	}
	t.Logf("stored %d bytes (compressed)", len(compressed))

	// Decompress and verify round-trip
	got, err := DecompressEntry([]byte(compressed))
	if err != nil {
		t.Fatalf("DecompressEntry: %v", err)
	}
	if string(got) != string(data) {
		t.Fatalf("round-trip mismatch\nwant: %s\ngot:  %s", data, got)
	}
	t.Logf("decompressed back to %d bytes — round-trip OK (%.1f%% compression)",
		len(got), 100*(1-float64(len(compressed))/float64(len(data))))

	// Cleanup
	rc.client.Del(ctx, streamKey(orgID))
}
