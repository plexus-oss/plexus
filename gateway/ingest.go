package main

// HTTP ingest handler — POST /ingest.
//
// Mirrors the WS device path in device.go: auth → validate → v:2 envelope →
// XADD telemetry. Exists so HTTP-only clients (ESP32 firmware, agents) land
// in the same Redis stream as WebSocket devices, letting a single set of
// consumers (ch-loader, the alert service, browser fan-out) handle all
// telemetry regardless of ingress protocol.
//
// Intentionally thin: no billing, no ClickHouse writes, no alert evaluation —
// those stay in dedicated consumers downstream.

import (
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

const (
	ingestMaxBodyBytes int64 = 5 * 1024 * 1024
)

// ingestRequest is the HTTP body shape. source_id is optional at the envelope
// level; per-point source_id overrides it. points is required.
type ingestRequest struct {
	SourceID string           `json:"source_id,omitempty"`
	Points   []map[string]any `json:"points"`
}

// ingestResponse is returned on success. count is the number of points accepted
// and queued to Redis. source_id echoes the source that was written.
type ingestResponse struct {
	Success  bool   `json:"success"`
	Count    int    `json:"count"`
	SourceID string `json:"source_id,omitempty"`
}

func serveIngest(w http.ResponseWriter, r *http.Request, hub *Hub) {
	setIngestCORS(w)

	// Fast-fail if Redis is unreachable — same semantics as serveDevice.
	// Clients should retry on 503; the Next.js proxy returns 502 to its
	// caller when this happens.
	if !hub.redis.Healthy() {
		writeIngestError(w, http.StatusServiceUnavailable, "gateway degraded: redis unavailable")
		return
	}

	apiKey := r.Header.Get("x-api-key")
	if apiKey == "" {
		writeIngestError(w, http.StatusUnauthorized, "missing x-api-key")
		return
	}

	ctx := r.Context()
	authResult, err := hub.auth.VerifyAPIKey(ctx, apiKey)
	if err != nil {
		writeIngestError(w, http.StatusUnauthorized, "invalid API key")
		return
	}
	// /ingest writes telemetry — reject a read-only key.
	if !authResult.HasScope("write") {
		writeIngestError(w, http.StatusForbidden, "API key lacks write scope")
		return
	}
	orgID := authResult.OrgID

	// Cap body size at the HTTP layer. MaxBytesReader returns an error on
	// Read once the limit is exceeded, which json.Decode surfaces as a
	// generic error — we translate it to 413 below.
	r.Body = http.MaxBytesReader(w, r.Body, ingestMaxBodyBytes)
	defer r.Body.Close()

	// Transparent gzip: plexus-python has compressed >1KB bodies since 0.x,
	// so this path must work. The decompressed stream gets its own cap —
	// MaxBytesReader above only bounds the compressed bytes.
	body, err := ingestBodyReader(r)
	if err != nil {
		writeIngestError(w, http.StatusBadRequest, "invalid gzip body")
		return
	}
	defer body.Close()

	var req ingestRequest
	if err := json.NewDecoder(body).Decode(&req); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) || errors.Is(err, errDecompressedTooLarge) {
			writeIngestError(w, http.StatusRequestEntityTooLarge,
				fmt.Sprintf("payload too large (max %d bytes)", ingestMaxBodyBytes))
			return
		}
		writeIngestError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	if req.Points == nil {
		writeIngestError(w, http.StatusBadRequest, "'points' array is required")
		return
	}
	// Empty points array is a valid no-op — existing SDKs use it as an
	// auth-validation heartbeat.
	if len(req.Points) == 0 {
		writeIngestJSON(w, http.StatusOK, ingestResponse{Success: true, Count: 0})
		return
	}
	if len(req.Points) > hub.limits.MaxPointsPerBatch {
		writeIngestError(w, http.StatusBadRequest,
			fmt.Sprintf("too many points: %d (max %d)", len(req.Points), hub.limits.MaxPointsPerBatch))
		return
	}

	// Normalize + validate every point in a single pass, grouping by
	// source_id as we go. We mutate points in place so the validator sees
	// the same map objects we'll ultimately marshal into the envelope.
	//
	// Fusing normalize and validate means each point is walked once instead
	// of twice, and validator errors carry the request-wide index (not a
	// per-group index) so the caller can find the bad point directly.
	//
	// Compatibility notes vs. the strict WS validator:
	//   - class is inferred from value type if missing (numbers → metric,
	//     everything else → event). HTTP SDKs predate the explicit class
	//     field and would otherwise all fail validation.
	//   - timestamps in seconds (< 1e12) are scaled to milliseconds.
	bySource := make(map[string][]any, 1)
	for i, pt := range req.Points {
		if pt == nil {
			writeIngestError(w, http.StatusBadRequest, fmt.Sprintf("points[%d] is null", i))
			return
		}

		// Resolve source_id: per-point overrides envelope-level default.
		sid, _ := pt["source_id"].(string)
		if sid == "" {
			sid = req.SourceID
		}
		if sid == "" {
			writeIngestError(w, http.StatusBadRequest,
				fmt.Sprintf("points[%d] missing source_id (set top-level source_id or per-point source_id)", i))
			return
		}
		if err := hub.validator.ValidateSourceID(sid); err != nil {
			writeIngestError(w, http.StatusBadRequest,
				fmt.Sprintf("points[%d] %s", i, err.Error()))
			return
		}

		// source_id is envelope-level in v:2 — strip it so the validator
		// doesn't see a stray field and so the marshaled point matches the
		// shape emitted by device.go.
		delete(pt, "source_id")

		// Infer class if absent.
		if _, hasClass := pt["class"].(string); !hasClass {
			if isIngestNumeric(pt["value"]) {
				pt["class"] = "metric"
			} else {
				pt["class"] = "event"
			}
		}

		// Normalize timestamp: seconds → milliseconds. Leave non-numeric
		// timestamps alone; the validator will reject them.
		if ts, ok := pt["timestamp"]; ok {
			if f, ok := toFloat(ts); ok && f > 0 && f < 1e12 {
				pt["timestamp"] = f * 1000
			}
		}

		// Validate inline with the request-wide index. Per-request
		// MaxPointsPerBatch is already enforced above, so we skip
		// ValidatePoints (which would re-check the ceiling per group).
		if err := hub.validator.ValidatePoint(i, pt); err != nil {
			hub.metrics.IncDropped(dropReasonValidation)
			writeIngestError(w, http.StatusBadRequest, err.Error())
			return
		}

		bySource[sid] = append(bySource[sid], pt)

		// Tee (source, metric) discovery to the frontend so live-only
		// sources still show up in the metric selector / device page.
		// Kept inline with validation; Observe itself is non-blocking.
		if hub.announcer != nil && hub.announcer.Enabled() {
			if class, _ := pt["class"].(string); class == "" || class == "metric" {
				if m, _ := pt["metric"].(string); m != "" {
					hub.announcer.Observe(orgID, sid, m, pt["value"])
				}
			}
		}
	}

	// One envelope per source_id, one XADD per envelope — matches
	// handleTelemetry in device.go so downstream consumers see an identical
	// shape regardless of whether the batch came from WS or HTTP.
	ingestedAt := time.Now().UnixMilli()
	totalAccepted := 0
	for sid, pts := range bySource {
		if !hub.sourceLimit.Allow(orgID, sid) {
			hub.metrics.IncDropped(dropReasonSourceLimit)
			// Safety ceiling drops are silent for WS; for HTTP we drop the
			// affected group but continue other sources. Count remains the
			// number actually queued.
			continue
		}

		envelope := map[string]any{
			"v":           2,
			"trace_id":    newUUID(),
			"org_id":      orgID,
			"source_id":   sid,
			"points":      pts,
			"ingested_at": ingestedAt,
		}

		data, err := json.Marshal(envelope)
		if err != nil {
			slog.Error("marshal ingest envelope", "err", err, "org", orgID, "source", sid)
			writeIngestError(w, http.StatusInternalServerError, "internal error")
			return
		}

		start := time.Now()
		if err := hub.redis.XAddTelemetry(ctx, orgID, data); err != nil {
			hub.metrics.ObserveRedisXAdd(time.Since(start).Seconds())
			slog.Error("redis xadd ingest", "err", err, "org", orgID, "source", sid, "points", len(pts))
			writeIngestError(w, http.StatusBadGateway, "failed to queue telemetry")
			return
		}
		hub.metrics.ObserveRedisXAdd(time.Since(start).Seconds())
		hub.metrics.IncTelemetryMessages(orgID)
		totalAccepted += len(pts)
	}

	resp := ingestResponse{Success: true, Count: totalAccepted}
	// Echo the source_id back for the single-source case so clients can
	// confirm what landed. The gateway passes the declared source_id through
	// unchanged (no auto-suffixing — that was removed), so this always mirrors
	// what the client sent. Multi-source batches omit the field — callers with
	// multiple sources shouldn't be mixing claims into one POST anyway.
	if len(bySource) == 1 {
		for sid := range bySource {
			resp.SourceID = sid
		}
	}
	writeIngestJSON(w, http.StatusOK, resp)
}

// serveIngestOptions responds to CORS preflight for POST /ingest.
func serveIngestOptions(w http.ResponseWriter, _ *http.Request) {
	setIngestCORS(w)
	w.WriteHeader(http.StatusNoContent)
}

// =========================================================================
// Helpers
// =========================================================================

func setIngestCORS(w http.ResponseWriter) {
	h := w.Header()
	// Devices come from arbitrary origins (ESP32 firmware, embedded Python,
	// browser-side snippets). Same posture as the legacy Next.js route.
	h.Set("Access-Control-Allow-Origin", "*")
	h.Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	h.Set("Access-Control-Allow-Headers", "Content-Type, x-api-key")
	h.Set("Access-Control-Max-Age", "86400")
}

func writeIngestJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeIngestError(w http.ResponseWriter, status int, message string) {
	writeIngestJSON(w, status, map[string]any{"error": message})
}

// errDecompressedTooLarge signals that a gzip body expanded past the ingest
// cap. Distinct from http.MaxBytesError so the 413 branch catches both.
var errDecompressedTooLarge = errors.New("decompressed body too large")

// ingestBodyReader returns the request body, transparently decompressing
// Content-Encoding: gzip. The decompressed stream is capped at
// ingestMaxBodyBytes too — MaxBytesReader upstream only bounds the
// compressed bytes, so a gzip bomb would otherwise bypass the limit.
func ingestBodyReader(r *http.Request) (io.ReadCloser, error) {
	if !strings.EqualFold(r.Header.Get("Content-Encoding"), "gzip") {
		return r.Body, nil
	}
	gz, err := gzip.NewReader(r.Body)
	if err != nil {
		return nil, err
	}
	return struct {
		io.Reader
		io.Closer
	}{&cappedReader{r: gz, remaining: ingestMaxBodyBytes}, gz}, nil
}

// cappedReader errors (rather than silently truncating, as io.LimitReader
// would) once more than `remaining` bytes have been read.
type cappedReader struct {
	r         io.Reader
	remaining int64
}

func (c *cappedReader) Read(p []byte) (int, error) {
	if c.remaining < 0 {
		return 0, errDecompressedTooLarge
	}
	n, err := c.r.Read(p)
	c.remaining -= int64(n)
	if c.remaining < 0 {
		return n, errDecompressedTooLarge
	}
	return n, err
}

// isIngestNumeric returns true if v decodes as a JSON number. Used only for
// class inference — actual numeric validation happens in the shared validator.
func isIngestNumeric(v any) bool {
	switch v.(type) {
	case float64, float32, int, int32, int64:
		return true
	case json.Number:
		return true
	}
	return false
}

// toFloat coerces JSON-decoded numeric types to float64. Returns ok=false for
// non-numeric values so callers can skip normalization without erroring.
func toFloat(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case float32:
		return float64(x), true
	case int:
		return float64(x), true
	case int64:
		return float64(x), true
	case int32:
		return float64(x), true
	}
	return 0, false
}
