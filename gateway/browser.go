package main

// Browser WebSocket handler — auth, subscription, command relay to devices.

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
)

// BrowserSubs controls which data streams are delivered to a browser connection.
// Set once at auth time; read-only thereafter (no lock needed).
type BrowserSubs struct {
	Telemetry bool // receive telemetry batch flushes via batchCh
	Video     bool // receive video frames via sendCh
}

type BrowserConn struct {
	ws     *websocket.Conn
	orgID  string
	userID string
	subs   BrowserSubs

	// Share-link viewer restriction. Set for share_auth connections, which are
	// anonymous shared-dashboard viewers and MUST be read-only: they may never
	// relay device commands. dashboardID/accessLevel carry the shared
	// dashboard's identity from verify-share so the connection is a known
	// restricted viewer (full per-source telemetry scoping is not yet possible
	// — see the note in browserReadLoop and serveBrowser). Set at auth time,
	// read-only thereafter (no lock needed).
	shareViewer   bool
	dashboardID   string
	accessLevel   string
	sendCh        chan []byte // non-telemetry push: source_status, heartbeat, events
	batchCh       chan []byte // telemetry pull: size-1, written by setBatch, read by writeLoop
	throttleUntil int64       // Unix nano; 0 = unthrottled, send everything

	// mu guards the video-throttle fields (cameras, maxFps, lastSentNs),
	// the pull-flow fields (pendingBatch, hungry), and the stream
	// subscription fields below. One mutex covers all groups — contention
	// is per-connection and never nested.
	// Invariant: hungry=true implies batchCh is empty.
	mu           sync.Mutex
	cameras      map[string]struct{} // subscribed camera IDs; empty = all
	maxFps       int                 // requested max fps per camera; 0 = no limit
	lastSentNs   map[string]int64    // per-camera last-sent timestamp for video throttling
	pendingBatch []byte
	hungry       bool

	// Stream subscriptions for data_api_auth connections.
	metricsDeviceID string
	metricsFilter   map[string]struct{} // nil = all metrics for this device
	logsDeviceID    string
	videoSourceID   string // camera subscribe scope; "" = org-wide (dashboard browsers)

	// Video session metering. registeredAt is set at auth time; lastEmittedAt
	// advances on each periodic sweep and final disconnect emit so each record
	// covers only the elapsed chunk rather than the full session duration.
	registeredAt  time.Time
	lastEmittedAt time.Time
}

// Commands the browser can relay to devices. Explicit allowlist.
var deviceCommandTypes = map[string]bool{
	"start_stream":     true,
	"stop_stream":      true,
	"start_camera":     true,
	"stop_camera":      true,
	"start_can":        true,
	"stop_can":         true,
	"start_mavlink":    true,
	"stop_mavlink":     true,
	"mavlink_command":  true,
	"configure":        true,
	"configure_camera": true,
}

func serveBrowser(w http.ResponseWriter, r *http.Request, hub *Hub) {
	if !hub.redis.Healthy() {
		http.Error(w, "gateway degraded: redis unavailable", http.StatusServiceUnavailable)
		return
	}
	ws, err := websocket.Accept(w, r, browserAcceptOptions(hub.allowedOrigins))
	if err != nil {
		slog.Error("browser websocket accept failed", "err", err)
		return
	}
	defer ws.CloseNow()

	ws.SetReadLimit(hub.limits.MaxMessageSize)

	ctx := r.Context()

	conn, err := handleBrowserAuth(ctx, ws, hub)
	if err != nil {
		slog.Warn("browser auth failed", "err", err)
		ws.Close(websocket.StatusPolicyViolation, "auth failed")
		return
	}

	hub.RegisterBrowser(conn)
	defer func() {
		hub.UnregisterBrowser(conn)
		go emitVideoSession(conn, hub)
	}()

	writeJSON(ctx, ws, map[string]any{
		"type":           "init",
		"online_sources": hub.GetOnlineSources(conn.orgID),
	})

	go browserWriteLoop(ctx, conn)
	browserReadLoop(ctx, conn, hub)
}

func handleBrowserAuth(ctx context.Context, ws *websocket.Conn, hub *Hub) (*BrowserConn, error) {
	authCtx, cancel := context.WithTimeout(ctx, hub.connCfg.BrowserAuthTimeout)
	defer cancel()

	_, data, err := ws.Read(authCtx)
	if err != nil {
		return nil, fmt.Errorf("read auth message: %w", err)
	}

	var msg map[string]any
	if err := json.Unmarshal(data, &msg); err != nil {
		writeJSON(ctx, ws, map[string]any{"type": "error", "message": "invalid JSON"})
		return nil, err
	}

	msgType, _ := msg["type"].(string)

	var auth *AuthResult
	var subs BrowserSubs
	var shareViewer bool
	switch msgType {
	case "browser_auth":
		token, _ := msg["token"].(string)
		if token == "" {
			writeJSON(ctx, ws, map[string]any{"type": "error", "message": "token required"})
			return nil, fmt.Errorf("token required")
		}
		auth, err = hub.auth.VerifySession(ctx, token)
		if err != nil {
			writeJSON(ctx, ws, map[string]any{"type": "error", "message": "Invalid session"})
			return nil, err
		}
		subs = BrowserSubs{Telemetry: true, Video: true}
	case "share_auth":
		token, _ := msg["token"].(string)
		if token == "" {
			writeJSON(ctx, ws, map[string]any{"type": "error", "message": "token required"})
			return nil, fmt.Errorf("token required")
		}
		auth, err = hub.auth.VerifyShareToken(ctx, token)
		if err != nil {
			writeJSON(ctx, ws, map[string]any{"type": "error", "message": "Invalid share token"})
			return nil, err
		}
		// Anonymous shared-dashboard viewer: read-only, restricted. Telemetry
		// is currently org-wide because verify-share does not return the shared
		// dashboard's source_ids (see TODO below).
		subs = BrowserSubs{Telemetry: true, Video: true}
		shareViewer = true
	case "data_api_auth":
		apiKey, _ := msg["api_key"].(string)
		if apiKey == "" {
			writeJSON(ctx, ws, map[string]any{"type": "error", "message": "api_key required"})
			return nil, fmt.Errorf("api_key required")
		}
		auth, err = hub.auth.VerifyAPIKey(ctx, apiKey)
		if err != nil {
			writeJSON(ctx, ws, map[string]any{"type": "error", "message": "Invalid API key"})
			return nil, err
		}
		subs = BrowserSubs{Telemetry: false, Video: true}
	default:
		writeJSON(ctx, ws, map[string]any{"type": "error", "message": "first message must be browser_auth, share_auth, or data_api_auth"})
		return nil, fmt.Errorf("expected browser_auth, share_auth, or data_api_auth, got %s", msgType)
	}

	return &BrowserConn{
		ws:            ws,
		orgID:         auth.OrgID,
		userID:        auth.UserID,
		subs:          subs,
		shareViewer:   shareViewer,
		dashboardID:   auth.DashboardID,
		accessLevel:   auth.AccessLevel,
		sendCh:        make(chan []byte, hub.connCfg.BrowserSendBuffer),
		batchCh:       make(chan []byte, 1),
		cameras:       make(map[string]struct{}),
		lastSentNs:    make(map[string]int64),
		hungry:        true, // start hungry so first flush delivers immediately
		registeredAt:  time.Now(),
		lastEmittedAt: time.Now(),
	}, nil
}

func browserReadLoop(ctx context.Context, conn *BrowserConn, hub *Hub) {
	for {
		_, data, err := conn.ws.Read(ctx)
		if err != nil {
			return
		}

		var msg map[string]any
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}

		msgType, _ := msg["type"].(string)

		switch msgType {
		case "subscribe":
			stream, _ := msg["stream"].(string)
			switch stream {
			case "metrics":
				deviceID, _ := msg["source_id"].(string)
				metricsList, _ := msg["metrics"].([]any)
				var filter map[string]struct{}
				if len(metricsList) > 0 {
					filter = make(map[string]struct{}, len(metricsList))
					for _, m := range metricsList {
						if ms, ok := m.(string); ok {
							filter[ms] = struct{}{}
						}
					}
				}
				conn.mu.Lock()
				conn.metricsDeviceID = deviceID
				conn.metricsFilter = filter
				conn.mu.Unlock()

			case "logs":
				deviceID, _ := msg["source_id"].(string)
				conn.mu.Lock()
				conn.logsDeviceID = deviceID
				conn.mu.Unlock()

			default:
				// Camera subscribe — snapshot old cameras under the lock,
				// then run hub updates outside it (hub takes its own lock).
				conn.mu.Lock()
				oldCameras := conn.cameras
				conn.mu.Unlock()
				for cid := range oldCameras {
					hub.UnsubscribeCamera(conn, cid)
				}

				cameraList, _ := msg["cameras"].([]any)
				newCameras := make(map[string]struct{}, len(cameraList))
				for _, c := range cameraList {
					if cid, ok := c.(string); ok {
						newCameras[cid] = struct{}{}
						hub.SubscribeCamera(conn, cid)
					}
				}

				// Optional source scope: when present, only frames from this
				// source's cameras are relayed (data-api proxy sets it; the
				// dashboard omits it and stays org-wide). Same field name as
				// the metrics/logs subscribe frames.
				sourceID, _ := msg["source_id"].(string)

				fps, _ := msg["max_fps"].(float64)
				conn.mu.Lock()
				conn.cameras = newCameras
				conn.maxFps = int(fps)
				conn.lastSentNs = make(map[string]int64)
				conn.videoSourceID = sourceID
				conn.mu.Unlock()
			}

		case "set_throttle":
			// Browser signals tab visibility. When throttled, skip sending telemetry
			// to reduce CPU/network for hidden tabs. Auto-expires after 10s if
			// the message is never cleared (handles disconnect without cleanup).
			enabled, _ := msg["enabled"].(bool)
			if enabled {
				atomic.StoreInt64(&conn.throttleUntil, time.Now().Add(10*time.Second).UnixNano())
			} else {
				atomic.StoreInt64(&conn.throttleUntil, 0)
			}

		case "ready":
			conn.deliverReady()

		case "ping":
			writeJSON(ctx, conn.ws, map[string]any{"type": "pong"})

		case "pong":
			// no-op

		default:
			if deviceCommandTypes[msgType] {
				// Shared-dashboard viewers (share_auth) are read-only: never
				// relay device-directed control frames from them.
				if conn.shareViewer {
					writeJSON(ctx, conn.ws, map[string]any{"type": "error", "message": "shared view is read-only"})
				} else {
					handleDeviceCommand(ctx, conn, hub, msgType, msg)
				}
			}
			// Silently ignore unknown types
		}
	}
}

// handleDeviceCommand relays a browser command to a device as a typed_command frame.
// Rebuilds params from validated fields — never forwards raw browser JSON.
func handleDeviceCommand(ctx context.Context, conn *BrowserConn, hub *Hub, msgType string, msg map[string]any) {
	sourceID, _ := msg["source_id"].(string)
	if sourceID == "" {
		writeJSON(ctx, conn.ws, map[string]any{"type": "error", "message": "source_id required"})
		return
	}

	params := buildCommandParams(msgType, sourceID, msg)
	if !sendTypedCommand(hub, conn.orgID, sourceID, msgType, params) {
		writeJSON(ctx, conn.ws, map[string]any{"type": "error", "message": "device not connected"})
	}
}

// buildCommandParams extracts the allowed fields for a given command type into
// a params map. source_id is always included so the device knows the intended target.
func buildCommandParams(msgType, sourceID string, msg map[string]any) map[string]any {
	params := map[string]any{"source_id": sourceID}
	switch msgType {
	case "start_stream":
		copyFields(msg, params, "metrics", "interval_ms", "store")
	case "stop_stream":
		copyFields(msg, params, "stream_id")
	case "start_camera":
		copyFields(msg, params, "camera_id", "frame_rate", "resolution", "quality")
	case "stop_camera":
		copyFields(msg, params, "camera_id")
	case "start_can", "stop_can":
		copyFields(msg, params, "channel", "dbc_path", "interval_ms")
	case "start_mavlink", "stop_mavlink":
		copyFields(msg, params, "connection_string", "interval_ms")
	case "mavlink_command":
		copyFields(msg, params, "connection_string", "command", "mode", "force")
	case "configure":
		copyFields(msg, params, "sensor", "config")
	case "configure_camera":
		copyFields(msg, params, "camera_id", "config")
	}
	return params
}

// sendTypedCommand wraps a command in the typed_command envelope the SDK expects
// and delivers it to the device via hub.SendToDevice. Returns false if the device
// is not connected.
func sendTypedCommand(hub *Hub, orgID, sourceID, command string, params map[string]any) bool {
	frame := map[string]any{
		"type":    "typed_command",
		"id":      newUUID(),
		"command": command,
		"params":  params,
	}
	payload, err := json.Marshal(frame)
	if err != nil {
		slog.Error("marshal typed_command", "err", err)
		return false
	}
	return hub.SendToDevice(orgID, sourceID, payload)
}

// copyFields copies named keys from src to dst if they exist in src.
func copyFields(src, dst map[string]any, keys ...string) {
	for _, k := range keys {
		if v, ok := src[k]; ok {
			dst[k] = v
		}
	}
}

// setThrottledBatch is called by hub.DeliverBatch for throttled (hidden-tab)
// browsers. It updates pendingBatch so the browser always has the latest state
// ready the moment it un-throttles and sends { type: "ready" }, but it never
// delivers to batchCh — bandwidth is not spent on a hidden tab.
func (bc *BrowserConn) setThrottledBatch(batch []byte) {
	bc.mu.Lock()
	bc.pendingBatch = batch
	bc.mu.Unlock()
}

// setBatch is called by hub.DeliverBatch for each browser. If the browser is
// hungry (waiting for data) the batch is sent immediately via batchCh.
// Otherwise it is stored as pendingBatch, replacing any unread prior batch so
// the browser always receives the latest accumulated state when it next sends
// { type: "ready" }.
func (bc *BrowserConn) setBatch(batch []byte) {
	bc.mu.Lock()
	if bc.hungry {
		bc.hungry = false
		bc.mu.Unlock()
		select {
		case bc.batchCh <- batch:
		default:
		}
		return
	}
	bc.pendingBatch = batch
	bc.mu.Unlock()
}

// deliverReady is called when the browser sends { type: "ready" }. If a batch
// is pending it is dispatched immediately; otherwise the browser is marked
// hungry so the next flush delivers without waiting.
func (bc *BrowserConn) deliverReady() {
	bc.mu.Lock()
	if bc.pendingBatch != nil {
		batch := bc.pendingBatch
		bc.pendingBatch = nil
		bc.mu.Unlock()
		select {
		case bc.batchCh <- batch:
		default:
		}
		return
	}
	bc.hungry = true
	bc.mu.Unlock()
}

func browserWriteLoop(ctx context.Context, conn *BrowserConn) {
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-conn.sendCh:
			if !ok {
				return
			}
			if err := conn.ws.Write(ctx, websocket.MessageText, msg); err != nil {
				return
			}
		case batch := <-conn.batchCh:
			if err := conn.ws.Write(ctx, websocket.MessageText, batch); err != nil {
				return
			}
		}
	}
}

// emitVideoSession writes a video session record to Redis when a browser
// disconnects after subscribing to at least one camera. Sessions under 1s
// are skipped (noise from probes and failed connections).
func emitVideoSession(conn *BrowserConn, hub *Hub) {
	now := time.Now()

	conn.mu.Lock()
	cameraCount := len(conn.cameras)
	startedAt := conn.lastEmittedAt
	conn.lastEmittedAt = now // always advance — prevents double-emit on sweep/disconnect race
	conn.mu.Unlock()

	if cameraCount == 0 {
		return
	}

	duration := now.Sub(startedAt)
	if duration < time.Second {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := hub.redis.XAddVideoSession(ctx, conn.orgID, cameraCount, startedAt, duration.Seconds()); err != nil {
		slog.Warn("video session emit failed", "org", conn.orgID, "err", err)
	}
}

// browserAcceptOptions returns the WebSocket accept options for browser
// connections based on the configured allowed origins. A list containing
// exactly "*" disables origin checking (dev mode). Any other list is passed
// through as OriginPatterns for glob-based matching.
func browserAcceptOptions(allowed []string) *websocket.AcceptOptions {
	for _, o := range allowed {
		if o == "*" {
			return &websocket.AcceptOptions{
				InsecureSkipVerify: true,
				CompressionMode:    websocket.CompressionDisabled,
			}
		}
	}
	return &websocket.AcceptOptions{
		OriginPatterns:  allowed,
		CompressionMode: websocket.CompressionDisabled,
	}
}
