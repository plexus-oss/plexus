package main

// Per-org Stream reader — port of org-pool.ts.
//
// One OrgReader per active org. Two goroutines:
//   - Poll: XREADGROUP from Redis, append telemetry points to per-key buffers,
//     forward heartbeats and events immediately.
//   - Flush: ticker-driven, drain all buffered points in arrival order and
//     broadcast as a single telemetry envelope.

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

type BufferEntry struct {
	Raw json.RawMessage
}

// Cap per-key buffer depth so a runaway-fast metric can't grow unbounded
// between flushes. At 1 kHz (SafetyConfig.MaxHzPerSource) and a 25 ms flush,
// a single metric produces at most ~25 points per window — 1024 leaves
// headroom for bursty batches while keeping memory bounded.
const maxBufferedPerKey = 1024

// streamMsg is the typed shape of an entry read from telemetry.stream.
// Two variants share the struct:
//   - Heartbeat: Type="heartbeat", Points empty, entry passes through whole.
//   - Telemetry envelope (v:2): Type empty, Points populated. The envelope
//     carries org/source/trace_id once for N points (big XADD reduction),
//     and the consumer re-hydrates each point into the flat single-point
//     wire format the browser expects.
type streamMsg struct {
	Type     string        `json:"type"`
	V        int           `json:"v"`
	TraceID  string        `json:"trace_id"`
	OrgID    string        `json:"org_id"`
	SourceID string        `json:"source_id"`
	Points   []streamPoint `json:"points"`
}

// streamPoint is one point inside a v:2 envelope. Value/Timestamp/Tags are
// held as json.RawMessage so we can copy them into the rehydrated wire
// bytes without parsing — the value may be any JSON type (number, string,
// bool, object, array), and Timestamp may arrive as int or float.
type streamPoint struct {
	Class     string          `json:"class"`
	Metric    string          `json:"metric"`
	Value     json.RawMessage `json:"value,omitempty"`
	Timestamp json.RawMessage `json:"timestamp,omitempty"`
	Tags      json.RawMessage `json:"tags,omitempty"`
}

// wireBytes reconstructs the flat single-point JSON that dashboard
// browsers expect (shape matches the pre-envelope v:1 entries). Envelope
// fields are inlined onto every point.
func (p streamPoint) wireBytes(env *streamMsg) ([]byte, error) {
	out := map[string]any{
		"v":         1,
		"org_id":    env.OrgID,
		"source_id": env.SourceID,
		"class":     p.Class,
		"metric":    p.Metric,
	}
	// Events are broadcast individually (bypassing the last-value-wins
	// buffer). Tag them with a top-level `type` so the browser can dispatch
	// every frame on `type` alone — metric batches get wrapped in a
	// telemetry envelope at flush time; events carry their own type here.
	if p.Class == "event" {
		out["type"] = "event"
	}
	if env.TraceID != "" {
		out["trace_id"] = env.TraceID
	}
	if len(p.Value) > 0 {
		out["value"] = p.Value
	}
	if len(p.Timestamp) > 0 {
		out["timestamp"] = p.Timestamp
	}
	if len(p.Tags) > 0 {
		out["tags"] = p.Tags
	}
	return json.Marshal(out)
}

type OrgReader struct {
	orgID string
	hub   *Hub
	redis *RedisClient
	cfg   DownsampleConfig

	mu     sync.Mutex
	buffer map[string][]*BufferEntry // "sourceID:metric" → ordered points since last flush

	// lastErrLog throttles poll-error Warn logs (only touched by pollLoop).
	lastErrLog time.Time

	stopCh chan struct{}
	wg     sync.WaitGroup
}

// pollErrLogInterval throttles repeated poll-error warnings so a persistent
// Redis problem doesn't flood the logs (the poll loop retries every 100ms).
const pollErrLogInterval = 30 * time.Second

func (or *OrgReader) logPollError(msg string, err error) {
	if time.Since(or.lastErrLog) < pollErrLogInterval {
		return
	}
	or.lastErrLog = time.Now()
	slog.Warn(msg, "org", or.orgID, "err", err)
}

func NewOrgReader(orgID string, hub *Hub, rc *RedisClient, cfg DownsampleConfig) *OrgReader {
	return &OrgReader{
		orgID:  orgID,
		hub:    hub,
		redis:  rc,
		cfg:    cfg,
		buffer: make(map[string][]*BufferEntry),
		stopCh: make(chan struct{}),
	}
}

func (or *OrgReader) Start() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Clean orphan, ensure group exists, then force cursor to live.
	// Three calls, but Start() is rare (once per org-activation) and each
	// covers a failure mode the previous one doesn't:
	//   1. DESTROY cleans the orphan in the happy path.
	//   2. CREATE MKSTREAM ensures the group exists if DESTROY no-oped
	//      (e.g. circuit was open, group already existed, BUSYGROUP no-op).
	//   3. SETID $ is unconditional insurance — "start live" regardless.
	or.redis.XGroupDestroy(ctx, or.orgID, or.cfg.ConsumerGroup)
	if err := or.redis.XGroupCreateMkStream(ctx, or.orgID, or.cfg.ConsumerGroup); err != nil {
		slog.Error("create consumer group", "org", or.orgID, "err", err)
	}
	if err := or.redis.XGroupSetID(ctx, or.orgID, or.cfg.ConsumerGroup); err != nil {
		slog.Error("set group id", "org", or.orgID, "err", err)
	}

	or.wg.Add(2)
	go or.pollLoop()
	go or.flushLoop()

	slog.Info("org reader started", "org", or.orgID, "group", or.cfg.ConsumerGroup, "flush", or.cfg.FlushInterval)
}

func (or *OrgReader) Stop() {
	close(or.stopCh)
	or.wg.Wait()
	slog.Info("org reader stopped", "org", or.orgID)
}

func (or *OrgReader) pollLoop() {
	defer or.wg.Done()

	for {
		select {
		case <-or.stopCh:
			return
		default:
		}

		block := or.cfg.PollBlock
		ctx, cancel := context.WithTimeout(context.Background(), block+time.Second)
		streams, err := or.redis.XReadGroup(ctx, or.orgID, or.cfg.ConsumerGroup, or.cfg.ConsumerName, or.cfg.PollCount, block, true)
		cancel()

		if err != nil {
			if err == redis.Nil {
				continue // no new messages, normal
			}
			// Don't log on context cancellation during shutdown
			select {
			case <-or.stopCh:
				return
			default:
			}
			// Stream key or group gone (Redis restart, flushed keyspace, or
			// a group create that failed at Start under an open circuit).
			// Without this, every subsequent poll errors instantly forever.
			// Same self-heal houston's consumers use (houston/stream.go).
			if isNoGroupErr(err) {
				cctx, ccancel := context.WithTimeout(context.Background(), 5*time.Second)
				cerr := or.redis.XGroupCreateMkStream(cctx, or.orgID, or.cfg.ConsumerGroup)
				ccancel()
				if cerr != nil {
					or.logPollError("consumer group recreate failed", cerr)
				} else {
					slog.Info("consumer group recreated", "org", or.orgID, "group", or.cfg.ConsumerGroup)
				}
				time.Sleep(time.Second)
				continue
			}
			or.logPollError("poll error", err)
			time.Sleep(100 * time.Millisecond)
			continue
		}

		// Collect all buffer updates from this poll, then apply under a single lock
		type bufUpdate struct {
			key string
			raw string
		}
		var bufUpdates []bufUpdate

		for _, stream := range streams {
			for _, msg := range stream.Messages {
				raw, ok := msg.Values["data"].(string)
				if !ok || raw == "" {
					continue
				}
				decompressed, err := DecompressEntry([]byte(raw))
				if err != nil {
					continue
				}

				var parsed streamMsg
				if err := json.Unmarshal(decompressed, &parsed); err != nil {
					continue
				}

				// Heartbeats: forward the whole entry as-is.
				if parsed.Type == "heartbeat" {
					or.hub.BroadcastToOrg(or.orgID, decompressed)
					continue
				}

				// Telemetry envelope (v:2): iterate points and dispatch
				// each individually. Events broadcast immediately; metric
				// points are appended to the per-key flush buffer.
				if len(parsed.Points) == 0 {
					continue
				}
				for _, pt := range parsed.Points {
					wire, err := pt.wireBytes(&parsed)
					if err != nil {
						continue
					}

					// Events (logs, state changes, structured occurrences):
					// forward immediately rather than batching — events are
					// latency-sensitive and typically infrequent, so a 25 ms
					// flush delay is unwanted overhead. BroadcastEventToOrg
					// filters by logsDeviceID for data_api subscribers.
					if pt.Class == "event" {
						or.hub.BroadcastEventToOrg(or.orgID, parsed.SourceID, wire)
						continue
					}

					// Metric telemetry: queue for buffer update
					if parsed.SourceID == "" || pt.Metric == "" {
						continue
					}
					bufUpdates = append(bufUpdates, bufUpdate{
						key: parsed.SourceID + ":" + pt.Metric,
						raw: string(wire),
					})
				}
			}
		}

		// Apply all buffer updates under a single lock. Append in arrival
		// order — every point reaches the browser, preserving intra-envelope
		// batches (e.g. a device sending 20 samples per XADD) and bursts
		// across envelopes within one flush window.
		if len(bufUpdates) > 0 {
			or.mu.Lock()
			for _, u := range bufUpdates {
				entry := &BufferEntry{Raw: json.RawMessage(u.raw)}
				existing := or.buffer[u.key]
				if len(existing) >= maxBufferedPerKey {
					// Drop-oldest eviction (newest points win) — the newest
					// point is the one the chart cares about most for a "live"
					// view, so drop the head rather than the tail.
					existing = existing[1:]
				}
				or.buffer[u.key] = append(existing, entry)
			}
			or.mu.Unlock()
		}
	}
}

func (or *OrgReader) flushLoop() {
	defer or.wg.Done()

	ticker := time.NewTicker(or.cfg.FlushInterval)
	defer ticker.Stop()

	for {
		select {
		case <-or.stopCh:
			// Final flush before stopping
			or.flush()
			return
		case <-ticker.C:
			or.flush()
		}
	}
}

func (or *OrgReader) flush() {
	or.mu.Lock()
	if len(or.buffer) == 0 {
		or.mu.Unlock()
		return
	}

	// Snapshot and reset in one step so DeliverMetricsBatch can use the
	// same snapshot without a second lock acquisition.
	bufSnapshot := or.buffer
	or.buffer = make(map[string][]*BufferEntry, len(or.buffer))
	or.mu.Unlock()

	total := 0
	for _, entries := range bufSnapshot {
		total += len(entries)
	}
	batch := make([]json.RawMessage, 0, total)
	for _, entries := range bufSnapshot {
		for _, entry := range entries {
			batch = append(batch, entry.Raw)
		}
	}

	payload, err := json.Marshal(map[string]any{
		"type":   "telemetry",
		"points": batch,
	})
	if err != nil {
		return
	}

	or.hub.DeliverBatch(or.orgID, payload)
	or.hub.DeliverMetricsBatch(or.orgID, bufSnapshot)
}
