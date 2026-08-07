package main

// Device WebSocket handler — auth, message routing, telemetry → Redis XADD.

import (
	"context"
	crand "crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"
	"unicode/utf8"

	"github.com/coder/websocket"
)

type DeviceConn struct {
	ws       *websocket.Conn
	orgID    string
	sourceID string
	platform string
	sensors  any
	cameras  any
	sendCh   chan []byte
	limiter  *RateLimiter
}

func serveDevice(w http.ResponseWriter, r *http.Request, hub *Hub) {
	// Fast-fail if Redis is unreachable — devices will reconnect when the
	// circuit closes, and their local SQLite buffer preserves data in the
	// meantime.
	if !hub.redis.Healthy() {
		http.Error(w, "gateway degraded: redis unavailable", http.StatusServiceUnavailable)
		return
	}
	// Devices are native clients (Python SDK, Go binaries) that don't send
	// an Origin header. Origin checking is meaningless here; API key auth
	// is the real gate. See browser.go for the origin-checked path.
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})
	if err != nil {
		slog.Error("device websocket accept failed", "err", err)
		return
	}
	defer ws.CloseNow()

	// SetReadLimit enforces max message size at the WebSocket layer
	ws.SetReadLimit(hub.limits.MaxMessageSize)

	ctx := r.Context()

	conn, err := handleDeviceAuth(ctx, ws, hub)
	if err != nil {
		slog.Warn("device auth failed", "err", err)
		ws.Close(websocket.StatusPolicyViolation, "auth failed")
		return
	}

	hub.RegisterDevice(conn)
	defer hub.UnregisterDevice(conn)

	go deviceWriteLoop(ctx, conn)
	deviceReadLoop(ctx, conn, hub)
}

func handleDeviceAuth(ctx context.Context, ws *websocket.Conn, hub *Hub) (*DeviceConn, error) {
	authCtx, cancel := context.WithTimeout(ctx, hub.connCfg.DeviceAuthTimeout)
	defer cancel()

	_, data, err := ws.Read(authCtx)
	if err != nil {
		return nil, fmt.Errorf("read auth message: %w", err)
	}

	var msg map[string]any
	if err := json.Unmarshal(data, &msg); err != nil {
		return nil, fmt.Errorf("invalid JSON")
	}

	msgType, err := hub.validator.ValidateMessage(msg)
	if err != nil || msgType != "device_auth" {
		writeJSON(ctx, ws, map[string]any{"type": "error", "message": "first message must be device_auth"})
		return nil, fmt.Errorf("expected device_auth, got %s", msgType)
	}

	apiKey, _ := msg["api_key"].(string)
	sourceID, _ := msg["source_id"].(string)

	auth, err := hub.auth.VerifyAPIKey(ctx, apiKey)
	if err != nil {
		writeJSON(ctx, ws, map[string]any{"type": "error", "message": "Invalid API key"})
		return nil, fmt.Errorf("verify key: %w", err)
	}
	// Devices ingest telemetry — a read-only key must not connect.
	if !auth.HasScope("write") {
		writeJSON(ctx, ws, map[string]any{"type": "error", "message": "API key lacks write scope"})
		return nil, fmt.Errorf("api key lacks write scope for device ingest")
	}

	writeJSON(ctx, ws, map[string]any{"type": "authenticated", "source_id": sourceID, "server_time_ms": time.Now().UnixMilli()})

	return &DeviceConn{
		ws:       ws,
		orgID:    auth.OrgID,
		sourceID: sourceID,
		platform: strOrEmpty(msg, "platform"),
		sensors:  msg["sensors"],
		cameras:  msg["cameras"],
		sendCh:   make(chan []byte, hub.connCfg.DeviceSendBuffer),
		limiter:  NewRateLimiter(hub.rateCfg),
	}, nil
}

func deviceReadLoop(ctx context.Context, conn *DeviceConn, hub *Hub) {
	seenCameras := make(map[string]bool)
	for {
		opcode, data, err := conn.ws.Read(ctx)
		if err != nil {
			return // connection closed (includes MaxMessageSize exceeded)
		}

		// Binary frames are video_frame messages from SDK >= 0.6.
		// Parse the compact binary header, re-encode as JSON+base64 for
		// browser relay so the frontend requires no changes.
		if opcode == websocket.MessageBinary {
			if !conn.limiter.Consume(tierForType("video_frame")) {
				hub.metrics.IncDropped(dropReasonRateLimit)
				continue
			}
			camID, width, height, tsMs, jpeg, err := parseBinaryVideoFrame(data)
			if err != nil {
				hub.metrics.IncDropped(dropReasonInvalidJSON)
				continue
			}
			relayData, err := json.Marshal(map[string]any{
				"type":      "video_frame",
				"source_id": conn.sourceID,
				"camera_id": camID,
				"width":     width,
				"height":    height,
				"timestamp": tsMs,
				"frame":     base64.StdEncoding.EncodeToString(jpeg),
			})
			if err != nil {
				continue
			}
			hub.RelayVideoFrame(conn.orgID, camID, relayData)
			if camID != "" && !seenCameras[camID] {
				seenCameras[camID] = true
				hub.AnnounceCamera(conn, camID, "normal")
			}
			continue
		}

		var msg map[string]any
		if err := json.Unmarshal(data, &msg); err != nil {
			hub.metrics.IncDropped(dropReasonInvalidJSON)
			writeJSON(ctx, conn.ws, map[string]any{"type": "error", "code": "INVALID_JSON"})
			continue
		}

		// Legacy WS clients (the C SDK serializer, plexus_json.c) emit
		// telemetry points without a "class" field, which the validator
		// requires. Infer it exactly like HTTP /ingest does (numbers →
		// metric, everything else → event) BEFORE validation so shipped
		// firmware keeps working. Invalid explicit class values are still
		// rejected by the validator.
		if t, _ := msg["type"].(string); t == "telemetry" {
			inferTelemetryPointClasses(msg)
		}

		msgType, err := hub.validator.ValidateMessage(msg)
		if err != nil {
			hub.metrics.IncDropped(dropReasonValidation)
			writeJSON(ctx, conn.ws, map[string]any{"type": "error", "code": "INVALID_MESSAGE", "detail": err.Error()})
			continue
		}

		if !conn.limiter.Consume(tierForType(msgType)) {
			hub.metrics.IncDropped(dropReasonRateLimit)
			writeJSON(ctx, conn.ws, map[string]any{"type": "error", "code": "RATE_LIMITED"})
			continue
		}

		switch msgType {
		case "telemetry":
			handleTelemetry(ctx, conn, hub, msg)
		case "heartbeat":
			handleHeartbeat(ctx, conn, hub, msg)
		case "video_frame":
			// This payload is relayed to browsers verbatim as a TEXT frame.
			// Go's json.Unmarshal tolerates invalid UTF-8 (it substitutes
			// U+FFFD in the decoded value but leaves the source bytes intact),
			// so a producer that stuffs raw bytes into the "frame" string would
			// otherwise be forwarded unchanged — and every strict RFC-6455
			// consumer (browsers, the recorder's websockets client) would close
			// with 1007. Validate UTF-8 here so one bad producer can't take down
			// the relay for the whole org. Cheap: no re-marshal, no copy.
			if !utf8.Valid(data) {
				hub.metrics.IncDropped(dropReasonInvalidUTF8)
				writeJSON(ctx, conn.ws, map[string]any{"type": "error", "code": "INVALID_FRAME_ENCODING"})
				continue
			}
			cameraID, _ := msg["camera_id"].(string)
			hub.RelayVideoFrame(conn.orgID, cameraID, data)
			if cameraID != "" && !seenCameras[cameraID] {
				seenCameras[cameraID] = true
				videoType, _ := msg["video_type"].(string)
				if videoType == "" {
					videoType = "normal"
				}
				hub.AnnounceCamera(conn, cameraID, videoType)
			}
		case "device_error":
			handleDeviceError(ctx, conn, hub, msg)
		case "command_result":
			hub.BroadcastToOrg(conn.orgID, data)
		case "pong":
			// no-op
		}
	}
}

func handleTelemetry(ctx context.Context, conn *DeviceConn, hub *Hub, msg map[string]any) {
	// Safety ceiling: drop the entire batch if the source is sending too fast.
	// This is a protective drop, not per-metric rate limiting.
	if !hub.sourceLimit.Allow(conn.orgID, conn.sourceID) {
		hub.metrics.IncDropped(dropReasonSourceLimit)
		return
	}

	points, ok := msg["points"].([]any)
	if !ok || len(points) == 0 {
		return
	}

	// Tee (source, metric) discovery to the frontend so live-only sources
	// still show up in the metric selector / device page. Cheap + bounded;
	// skipped after first sight of each tuple. Only numeric/metric points
	// are announced — events are not a user-pickable metric.
	if hub.announcer != nil && hub.announcer.Enabled() {
		for _, p := range points {
			if pt, _ := p.(map[string]any); pt != nil {
				if class, _ := pt["class"].(string); class == "" || class == "metric" {
					if m, _ := pt["metric"].(string); m != "" {
						hub.announcer.Observe(conn.orgID, conn.sourceID, m, pt["value"])
					}
				}
			}
		}
	}

	traceID, _ := msg["trace_id"].(string)
	if traceID == "" {
		traceID = newUUID()
	}

	// v:2 envelope — one XADD per telemetry message instead of one per
	// point. Consumers iterate envelope.points and re-hydrate each point
	// with envelope-level fields (org_id, source_id, trace_id). This
	// collapses XADD command count by the batch size (typically 5-20x).
	envelope := map[string]any{
		"v":           2,
		"trace_id":    traceID,
		"org_id":      conn.orgID,
		"source_id":   conn.sourceID,
		"points":      points,
		"ingested_at": time.Now().UnixMilli(),
	}

	data, err := json.Marshal(envelope)
	if err != nil {
		slog.Error("marshal telemetry envelope", "err", err, "org", conn.orgID)
		return
	}

	start := time.Now()
	err = hub.redis.XAddTelemetry(ctx, conn.orgID, data)
	hub.metrics.ObserveRedisXAdd(time.Since(start).Seconds())
	if err != nil {
		slog.Error("redis xadd envelope", "err", err, "org", conn.orgID, "points", len(points))
		if errors.Is(err, ErrRedisCircuitOpen) {
			// Redis is down and this batch was not queued. Tell the device
			// and close so its SDK reconnect loop engages local buffering —
			// silently dropping here contradicts the store-and-forward model
			// (see redis.go). Reconnect attempts are rejected with 503 in
			// serveDevice until the circuit closes.
			writeJSON(ctx, conn.ws, map[string]any{"type": "error", "code": "REDIS_UNAVAILABLE", "detail": "gateway degraded: redis unavailable, batch not queued"})
			conn.ws.Close(websocket.StatusTryAgainLater, "redis unavailable")
		}
		return
	}
	hub.metrics.IncTelemetryMessages(conn.orgID)
}

func handleHeartbeat(ctx context.Context, conn *DeviceConn, hub *Hub, msg map[string]any) {
	// Heartbeats carry both `type: "heartbeat"` (used by the dashboard
	// consumer to bypass the downsample buffer and forward immediately)
	// and `class: "heartbeat"` (for consumers that dispatch on class).
	entry := map[string]any{
		"type":      "heartbeat",
		"class":     "heartbeat",
		"org_id":    conn.orgID,
		"source_id": conn.sourceID,
		"status":    "running",
		"timestamp": time.Now().UnixMilli(),
	}
	if uptime, ok := msg["uptime_s"]; ok {
		entry["uptime_s"] = uptime
	}

	data, err := json.Marshal(entry)
	if err != nil {
		return
	}
	if err := hub.redis.XAddTelemetry(ctx, conn.orgID, data); err != nil {
		slog.Error("redis xadd heartbeat", "err", err, "org", conn.orgID)
		return
	}
	hub.metrics.IncHeartbeats(conn.orgID)

	go hub.announcer.PostForSource(conn.orgID, conn.sourceID)
}

func handleDeviceError(ctx context.Context, conn *DeviceConn, hub *Hub, msg map[string]any) {
	// Same v:2 envelope shape as handleTelemetry so downsample has a
	// single telemetry format to parse.
	point := map[string]any{
		"class":     "event",
		"metric":    "device.error",
		"value":     msg["error"],
		"timestamp": time.Now().UnixMilli(),
	}
	if source, ok := msg["source"]; ok {
		point["tags"] = map[string]any{"error_source": source}
	}

	envelope := map[string]any{
		"v":           2,
		"org_id":      conn.orgID,
		"source_id":   conn.sourceID,
		"points":      []any{point},
		"ingested_at": time.Now().UnixMilli(),
	}

	data, err := json.Marshal(envelope)
	if err != nil {
		return
	}
	if err := hub.redis.XAddTelemetry(ctx, conn.orgID, data); err != nil {
		slog.Debug("redis xadd device_error", "err", err, "org", conn.orgID)
	}
}

func deviceWriteLoop(ctx context.Context, conn *DeviceConn) {
	ping := time.NewTicker(30 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ping.C:
			if err := conn.ws.Ping(ctx); err != nil {
				return
			}
		case msg, ok := <-conn.sendCh:
			if !ok {
				return
			}
			if err := conn.ws.Write(ctx, websocket.MessageText, msg); err != nil {
				return
			}
		}
	}
}

// =========================================================================
// Helpers
// =========================================================================

// inferTelemetryPointClasses fills in a missing per-point "class" on a WS
// telemetry message, mirroring the HTTP /ingest inference (ingest.go):
// numbers → metric, everything else → event. Mutates the point maps in place
// so the validator and the XADD envelope see the same objects. Malformed
// shapes (non-object points, points array of the wrong type) are left
// untouched for the validator to reject.
func inferTelemetryPointClasses(msg map[string]any) {
	points, _ := msg["points"].([]any)
	for _, p := range points {
		pt, ok := p.(map[string]any)
		if !ok {
			continue
		}
		if _, hasClass := pt["class"].(string); hasClass {
			continue
		}
		if isIngestNumeric(pt["value"]) {
			pt["class"] = "metric"
		} else {
			pt["class"] = "event"
		}
	}
}

// parseBinaryVideoFrame decodes the compact binary wire format sent by SDK >= 0.6.
//
// Wire layout (mirrors _encode_binary_video_frame in ws.py):
//
//	[0x01]          1 byte   version
//	[src_len]       1 byte   source_id byte length
//	[source_id]     N bytes
//	[cam_len]       1 byte   camera_id byte length
//	[camera_id]     M bytes
//	[width]         4 bytes  uint32 big-endian
//	[height]        4 bytes  uint32 big-endian
//	[timestamp_ms]  8 bytes  int64  big-endian
//	[jpeg]          rest
func parseBinaryVideoFrame(data []byte) (cameraID string, width, height uint32, tsMs int64, jpeg []byte, err error) {
	if len(data) < 2 || data[0] != 0x01 {
		return "", 0, 0, 0, nil, fmt.Errorf("invalid binary video frame")
	}
	i := 1
	srcLen := int(data[i])
	i++
	if len(data) < i+srcLen {
		return "", 0, 0, 0, nil, fmt.Errorf("truncated source_id")
	}
	i += srcLen // source_id is authenticated via conn.sourceID; skip it

	if len(data) < i+1 {
		return "", 0, 0, 0, nil, fmt.Errorf("truncated camera_id length")
	}
	camLen := int(data[i])
	i++
	if len(data) < i+camLen {
		return "", 0, 0, 0, nil, fmt.Errorf("truncated camera_id")
	}
	cameraID = string(data[i : i+camLen])
	i += camLen

	if len(data) < i+16 {
		return "", 0, 0, 0, nil, fmt.Errorf("truncated header fields")
	}
	width = binary.BigEndian.Uint32(data[i:])
	i += 4
	height = binary.BigEndian.Uint32(data[i:])
	i += 4
	tsMs = int64(binary.BigEndian.Uint64(data[i:]))
	i += 8

	jpeg = data[i:]
	return
}

func writeJSON(ctx context.Context, ws *websocket.Conn, msg map[string]any) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	if err := ws.Write(ctx, websocket.MessageText, data); err != nil {
		slog.Debug("ws write", "err", err)
	}
}

func strOrEmpty(msg map[string]any, key string) string {
	s, _ := msg[key].(string)
	return s
}

// newUUID generates a version 4 UUID using crypto/rand.
func newUUID() string {
	var buf [16]byte
	_, _ = crand.Read(buf[:])
	buf[6] = (buf[6] & 0x0f) | 0x40 // version 4
	buf[8] = (buf[8] & 0x3f) | 0x80 // variant 10
	return fmt.Sprintf("%x-%x-%x-%x-%x", buf[0:4], buf[4:6], buf[6:8], buf[8:10], buf[10:16])
}
