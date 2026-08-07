package main

// Micro-benchmarks for the downsample hot path.
//
// Run with:
//   go test -bench=. -benchmem -run=^$ ./...
//
// Goal: find the (FlushInterval, PollBlock) pair that keeps origination-
// to-pixel latency under ~70ms gateway-internal (leaving ~30ms for network +
// render inside the 100ms SLO) while minimizing CPU load on the gateway box.
//
// These benchmarks exclude Redis round-trips — on a co-located Redis those
// are dominated by the network, not our code. What we measure here is the
// pure Go cost of the flush cycle and message processing.

import (
	"encoding/json"
	"fmt"
	"strconv"
	"testing"
	"time"
)

// realisticTelemetryMsg returns the JSON shape device.go actually XADDs
// to Redis — a v:2 envelope with one point. Production envelopes usually
// contain more points per message, but the per-point parse cost is what
// we care about here.
func realisticTelemetryMsg(sourceID, metric string, value float64, ts int64) []byte {
	msg := map[string]any{
		"v":         2,
		"trace_id":  "abcd-1234-efgh-5678",
		"org_id":    "org-bench",
		"source_id": sourceID,
		"points": []map[string]any{{
			"class":     "metric",
			"metric":    metric,
			"value":     value,
			"timestamp": ts,
		}},
	}
	data, _ := json.Marshal(msg)
	return data
}

// benchHub creates a Hub suitable for flush benchmarks — no Redis, no auth,
// just enough state for BroadcastToOrg to reach N fake browser connections.
func benchHub(nBrowsers int, orgID string) *Hub {
	h := &Hub{
		deviceConns:  make(map[string]map[string]*DeviceConn),
		browserConns: make(map[string]map[*BrowserConn]struct{}),
		orgReaders:   make(map[string]*OrgReader),
	}
	h.browserConns[orgID] = make(map[*BrowserConn]struct{}, nBrowsers)
	for i := 0; i < nBrowsers; i++ {
		bc := &BrowserConn{
			orgID:  orgID,
			sendCh: make(chan []byte, 256),
		}
		h.browserConns[orgID][bc] = struct{}{}
	}
	return h
}

// drainBrowsers empties all browser sendCh channels so iterative benchmarks
// don't accumulate backpressure across iterations.
func drainBrowsers(h *Hub, orgID string) {
	for bc := range h.browserConns[orgID] {
	drain:
		for {
			select {
			case <-bc.sendCh:
			default:
				break drain
			}
		}
	}
}

// BenchmarkFlush measures the full flush path: marshal + broadcast to N
// browser sendCh channels, at various buffer fill levels.
//
// Each iteration re-populates the buffer (flush drains it), then times
// the flush call itself via StopTimer/StartTimer.
func BenchmarkFlush(b *testing.B) {
	cases := []struct {
		entries  int
		browsers int
	}{
		{1, 1},
		{10, 1},
		{100, 1},
		{1000, 1},
		{10, 10},
		{100, 10},
		{100, 100},
		{1000, 100},
	}

	for _, tc := range cases {
		name := fmt.Sprintf("entries=%d/browsers=%d", tc.entries, tc.browsers)
		b.Run(name, func(b *testing.B) {
			orgID := "org-bench"
			hub := benchHub(tc.browsers, orgID)
			or := NewOrgReader(orgID, hub, nil, DownsampleConfig{
				FlushInterval: 25 * time.Millisecond,
				PollBlock:     5 * time.Millisecond,
			})

			// Pre-build the realistic messages and keys once
			msgs := make([]json.RawMessage, tc.entries)
			keys := make([]string, tc.entries)
			for i := 0; i < tc.entries; i++ {
				src := "src" + strconv.Itoa(i%10)
				metric := "m" + strconv.Itoa(i%20)
				msgs[i] = realisticTelemetryMsg(src, metric, float64(i)*1.5, int64(i))
				keys[i] = src + ":" + metric
			}

			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				b.StopTimer()
				// Repopulate buffer (flush resets it)
				or.mu.Lock()
				for j := 0; j < tc.entries; j++ {
					or.buffer[keys[j]] = append(or.buffer[keys[j]], &BufferEntry{Raw: msgs[j]})
				}
				or.mu.Unlock()
				drainBrowsers(hub, orgID)
				b.StartTimer()

				or.flush()
			}
		})
	}
}

// BenchmarkMessageParse measures the per-message cost the poll loop pays:
// json.Unmarshal + the field access the loop does to decide what to do
// with the message.
//
// Two variants:
//   - "map"    — old approach: unmarshal into map[string]any, read fields via type assertion
//   - "struct" — current approach: unmarshal into the minimal typed streamMsg
func BenchmarkMessageParse(b *testing.B) {
	msg := realisticTelemetryMsg("source-001", "accel_x", 9.81, time.Now().UnixMilli())

	b.Run("map", func(b *testing.B) {
		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			var parsed map[string]any
			_ = json.Unmarshal(msg, &parsed)
			_, _ = parsed["source_id"].(string)
			_, _ = parsed["type"].(string)
			if pts, ok := parsed["points"].([]any); ok && len(pts) > 0 {
				if pt, ok := pts[0].(map[string]any); ok {
					_, _ = pt["metric"].(string)
					_, _ = pt["class"].(string)
				}
			}
		}
	})

	b.Run("struct", func(b *testing.B) {
		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			var parsed streamMsg
			_ = json.Unmarshal(msg, &parsed)
			_ = parsed.SourceID
			_ = parsed.Type
			if len(parsed.Points) > 0 {
				_ = parsed.Points[0].Metric
				_ = parsed.Points[0].Class
			}
		}
	})
}

// BenchmarkBufferApply measures the cost of the poll loop's batched
// buffer write — N map inserts under a single lock.
func BenchmarkBufferApply(b *testing.B) {
	sizes := []int{1, 10, 100, 500}
	for _, n := range sizes {
		b.Run(fmt.Sprintf("n=%d", n), func(b *testing.B) {
			or := &OrgReader{
				buffer: make(map[string][]*BufferEntry),
			}

			type upd struct {
				key string
				raw json.RawMessage
			}
			updates := make([]upd, n)
			for i := 0; i < n; i++ {
				src := "src" + strconv.Itoa(i%10)
				metric := "m" + strconv.Itoa(i%20)
				updates[i] = upd{
					key: src + ":" + metric,
					raw: realisticTelemetryMsg(src, metric, float64(i), int64(i)),
				}
			}

			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				or.mu.Lock()
				for _, u := range updates {
					or.buffer[u.key] = append(or.buffer[u.key], &BufferEntry{Raw: u.raw})
				}
				or.mu.Unlock()
			}
		})
	}
}
