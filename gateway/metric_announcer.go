package main

// Metric schema announcer.
//
// Observes every (org, source, metric) tuple that flows through the
// gateway and, on first sight, POSTs a one-line "points" payload back to
// the Next.js app's internal /api/sources/register endpoint. The frontend
// captures the schema into the `device_schemas` table, making the metric
// discoverable in the UI (metric selector, device page) regardless of
// whether the source has `config.recording=true`.
//
// Design:
//   - In-memory LRU-ish set of already-announced (org, source, metric)
//     tuples. Bounded so a misbehaving client can't OOM the gateway.
//   - Non-blocking Observe() — drops silently under backpressure, which
//     is fine: eventually the same metric will show up again and retry.
//   - One background worker that batches and POSTs, so the ingest hot
//     path never waits on the frontend.
//   - Silently no-ops when InternalSecret or APIURL are unset (dev mode
//     without a frontend to announce to).

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

const (
	announcerQueueSize    = 4096
	announcerMaxBatch     = 200
	announcerFlushEvery   = 500 * time.Millisecond
	announcerMaxKnownKeys = 100_000
	announcerHTTPTimeout  = 3 * time.Second
)

// MetricAnnouncer tees new (source, metric) sightings to the Next.js
// /api/sources/register endpoint for schema capture.
type MetricAnnouncer struct {
	apiURL         string
	internalSecret string
	client         *http.Client

	mu    sync.Mutex
	known map[string]announceEntry // key = "org\x00source\x00metric"
	queue chan announceEntry

	stopCh chan struct{}
	stopWG sync.WaitGroup
}

type announceEntry struct {
	orgID     string
	sourceID  string
	metric    string
	valueType string // "number" | "string" | "boolean" | "object" | "array"
	value     any    // sample value — gives the frontend a min/max seed
}

// NewMetricAnnouncer returns an announcer that POSTs discovered metrics
// to `apiURL + /api/sources/register`. If apiURL or internalSecret is
// empty, Observe() is a no-op and Start() returns immediately.
func NewMetricAnnouncer(apiURL, internalSecret string) *MetricAnnouncer {
	return &MetricAnnouncer{
		apiURL:         apiURL,
		internalSecret: internalSecret,
		client:         &http.Client{Timeout: announcerHTTPTimeout},
		known:          make(map[string]announceEntry, 1024),
		queue:          make(chan announceEntry, announcerQueueSize),
		stopCh:         make(chan struct{}),
	}
}

// Enabled returns true if the announcer is configured to talk to a frontend.
func (a *MetricAnnouncer) Enabled() bool {
	return a.apiURL != "" && a.internalSecret != ""
}

// Start spins up the background worker. Safe to call when Enabled()==false.
func (a *MetricAnnouncer) Start(ctx context.Context) {
	if !a.Enabled() {
		return
	}
	a.stopWG.Add(1)
	go a.run(ctx)
}

// Stop drains the in-flight queue and shuts down the worker.
func (a *MetricAnnouncer) Stop() {
	close(a.stopCh)
	a.stopWG.Wait()
}

// Observe records a (org, source, metric) sighting. Drops silently if
// already known, if the queue is full, or if the announcer is disabled.
// The `value` is a sample used to populate value_type / min / max at the
// frontend.
func (a *MetricAnnouncer) Observe(orgID, sourceID, metric string, value any) {
	if !a.Enabled() {
		return
	}
	if orgID == "" || sourceID == "" || metric == "" {
		return
	}

	key := orgID + "\x00" + sourceID + "\x00" + metric

	a.mu.Lock()
	if _, ok := a.known[key]; ok {
		a.mu.Unlock()
		return
	}
	// Bound the known set. This is a dumb cap — under extreme churn the
	// oldest entries will get re-announced on wrap-around, which is fine.
	if len(a.known) >= announcerMaxKnownKeys {
		for k := range a.known {
			delete(a.known, k)
			break
		}
	}
	entry := announceEntry{
		orgID:     orgID,
		sourceID:  sourceID,
		metric:    metric,
		valueType: inferValueType(value),
		value:     value,
	}
	a.known[key] = entry
	a.mu.Unlock()

	select {
	case a.queue <- entry:
	default:
		// Queue full — forget and retry next time the metric is seen.
		a.mu.Lock()
		delete(a.known, key)
		a.mu.Unlock()
	}
}

// PostForSource POSTs all known metrics for (orgID, sourceID) to
// /api/sources/register. Called on device heartbeat to refresh schemas
// and surface metrics added after initial registration.
// Uses its own context so it completes even if the device connection closes.
func (a *MetricAnnouncer) PostForSource(orgID, sourceID string) {
	if !a.Enabled() {
		return
	}

	prefix := orgID + "\x00" + sourceID + "\x00"
	a.mu.Lock()
	var points []map[string]any
	for k, e := range a.known {
		if len(k) > len(prefix) && k[:len(prefix)] == prefix {
			points = append(points, map[string]any{
				"metric": e.metric,
				"value":  e.value,
			})
		}
	}
	a.mu.Unlock()

	if len(points) == 0 {
		return
	}

	a.post(context.Background(), orgID, sourceID, points)
}

func (a *MetricAnnouncer) run(ctx context.Context) {
	defer a.stopWG.Done()

	ticker := time.NewTicker(announcerFlushEvery)
	defer ticker.Stop()

	// Accumulate by (org, source) so we POST one request per source per
	// flush cycle. Structure: orgID → sourceID → points[].
	batch := make(map[string]map[string][]map[string]any)
	count := 0

	flush := func() {
		if count == 0 {
			return
		}
		for orgID, bySource := range batch {
			for sourceID, points := range bySource {
				a.post(ctx, orgID, sourceID, points)
			}
		}
		batch = make(map[string]map[string][]map[string]any)
		count = 0
	}

	for {
		select {
		case <-ctx.Done():
			flush()
			return
		case <-a.stopCh:
			flush()
			return
		case <-ticker.C:
			flush()
		case e := <-a.queue:
			if batch[e.orgID] == nil {
				batch[e.orgID] = make(map[string][]map[string]any)
			}
			point := map[string]any{
				"metric": e.metric,
				"value":  e.value,
			}
			batch[e.orgID][e.sourceID] = append(batch[e.orgID][e.sourceID], point)
			count++
			if count >= announcerMaxBatch {
				flush()
			}
		}
	}
}

func (a *MetricAnnouncer) post(parent context.Context, orgID, sourceID string, points []map[string]any) {
	body, err := json.Marshal(map[string]any{
		"org_id": orgID,
		"slug":   sourceID,
		"points": points,
	})
	if err != nil {
		slog.Warn("announcer marshal failed", "err", err)
		return
	}

	ctx, cancel := context.WithTimeout(parent, announcerHTTPTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "POST",
		a.apiURL+"/api/sources/register", bytes.NewReader(body))
	if err != nil {
		slog.Warn("announcer build request failed", "err", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-internal-secret", a.internalSecret)

	resp, err := a.client.Do(req)
	if err != nil {
		slog.Warn("announcer POST failed", "err", err, "org", orgID, "source", sourceID)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		slog.Warn("announcer POST rejected",
			"status", resp.StatusCode, "org", orgID, "source", sourceID)
	}
}

// inferValueType mirrors the allowed value_type values on device_schemas.
func inferValueType(v any) string {
	switch v.(type) {
	case float64, float32, int, int32, int64, uint, uint32, uint64:
		return "number"
	case string:
		return "string"
	case bool:
		return "boolean"
	case []any:
		return "array"
	case map[string]any:
		return "object"
	default:
		if v == nil {
			return "string"
		}
		return "string"
	}
}
