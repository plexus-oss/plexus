package main

// Hub — central connection registry and per-org coordination.

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type Hub struct {
	mu sync.RWMutex
	// deviceConns indexed by org → sourceID → conn for O(1) per-org lookups
	deviceConns  map[string]map[string]*DeviceConn
	browserConns map[string]map[*BrowserConn]struct{}
	orgReaders   map[string]*OrgReader

	// cameraSubs maps cameraID → browsers subscribed to that camera.
	// Enables O(1) relay instead of iterating all browsers.
	cameraSubs map[string]map[*BrowserConn]struct{}

	redis       *RedisClient
	auth        *AuthClient
	validator   *Validator
	sourceLimit *SourceRateLimiter
	announcer   *MetricAnnouncer
	metrics     *Metrics
	startedAt   time.Time

	// Sub-configs passed to connections/readers at creation time
	connCfg        ConnectionsConfig
	rateCfg        RateLimitConfig
	downsampleCfg  DownsampleConfig
	redisCfg       RedisConfig
	limits         LimitsConfig
	allowedOrigins []string
}

func NewHub(cfg *GatewayConfig, redis *RedisClient, auth *AuthClient, validator *Validator, metrics *Metrics) *Hub {
	return &Hub{
		deviceConns:    make(map[string]map[string]*DeviceConn),
		browserConns:   make(map[string]map[*BrowserConn]struct{}),
		orgReaders:     make(map[string]*OrgReader),
		cameraSubs:     make(map[string]map[*BrowserConn]struct{}),
		redis:          redis,
		auth:           auth,
		validator:      validator,
		sourceLimit:    NewSourceRateLimiter(cfg.Safety.MaxHzPerSource),
		announcer:      NewMetricAnnouncer(cfg.Auth.APIURL, cfg.Auth.InternalSecret),
		metrics:        metrics,
		startedAt:      time.Now(),
		connCfg:        cfg.Connections,
		rateCfg:        cfg.RateLimit,
		downsampleCfg:  cfg.Downsample,
		redisCfg:       cfg.Redis,
		limits:         cfg.Limits,
		allowedOrigins: cfg.AllowedOrigins,
	}
}

// Announcer exposes the metric-schema announcer so the main goroutine
// can start/stop it alongside the rest of the gateway lifecycle.
func (h *Hub) Announcer() *MetricAnnouncer { return h.announcer }

// =========================================================================
// Device connections
// =========================================================================

func (h *Hub) RegisterDevice(conn *DeviceConn) {
	h.mu.Lock()
	if h.deviceConns[conn.orgID] == nil {
		h.deviceConns[conn.orgID] = make(map[string]*DeviceConn)
	}
	old := h.deviceConns[conn.orgID][conn.sourceID]
	h.deviceConns[conn.orgID][conn.sourceID] = conn
	h.mu.Unlock()

	if old != nil {
		// Evict the displaced connection so its read-loop goroutine exits
		// instead of blocking on ws.Read() until the OS TCP keepalive fires.
		// UnregisterDevice will see orgMap[sourceID] != old and skip the
		// map delete and metric decrement, so the new conn is unaffected.
		old.ws.CloseNow()
	} else {
		// Only count new device slots; reconnects don't change the device count.
		h.metrics.IncDevices()
	}

	slog.Info("device registered", "org", conn.orgID, "source", conn.sourceID)

	h.broadcastToBrowsers(conn.orgID, map[string]any{
		"type":      "source_status",
		"source_id": conn.sourceID,
		"status":    "online",
		"platform":  conn.platform,
		"sensors":   conn.sensors,
		"cameras":   conn.cameras,
	})
}

func (h *Hub) UnregisterDevice(conn *DeviceConn) {
	h.mu.Lock()
	removed := false
	if orgMap, ok := h.deviceConns[conn.orgID]; ok {
		if orgMap[conn.sourceID] == conn {
			delete(orgMap, conn.sourceID)
			removed = true
			if len(orgMap) == 0 {
				delete(h.deviceConns, conn.orgID)
			}
		}
	}
	h.mu.Unlock()

	if !removed {
		// This conn was already superseded by a new registration; the new
		// conn owns the slot and its metrics. Nothing to clean up here.
		return
	}

	h.sourceLimit.Forget(conn.orgID, conn.sourceID)
	h.metrics.DecDevices()

	slog.Info("device disconnected", "org", conn.orgID, "source", conn.sourceID)

	h.broadcastToBrowsers(conn.orgID, map[string]any{
		"type":      "source_status",
		"source_id": conn.sourceID,
		"status":    "offline",
	})
}

// AnnounceCamera records a newly-seen camera ID on a device connection and
// broadcasts an updated source_status to all browsers for the org.
// Safe to call from the device read-loop goroutine; acquires h.mu internally.
func (h *Hub) AnnounceCamera(conn *DeviceConn, cameraID, videoType string) {
	h.mu.Lock()
	cameras := normalizeCameras(conn.cameras)
	for _, c := range cameras {
		if c["camera_id"] == cameraID {
			h.mu.Unlock()
			return // already registered
		}
	}
	cameras = append(cameras, map[string]any{"camera_id": cameraID, "video_type": videoType})
	conn.cameras = cameras
	h.mu.Unlock()

	h.broadcastToBrowsers(conn.orgID, map[string]any{
		"type":      "source_status",
		"source_id": conn.sourceID,
		"status":    "online",
		"platform":  conn.platform,
		"sensors":   conn.sensors,
		"cameras":   cameras,
	})
}

// normalizeCameras coerces conn.cameras into []map[string]any. The field holds
// two shapes: []any of objects straight from the device_auth JSON decode, or
// []map[string]any written by a prior AnnounceCamera. Non-object entries are
// dropped so auth-declared cameras merge cleanly with announce-discovered ones.
func normalizeCameras(v any) []map[string]any {
	switch cams := v.(type) {
	case []map[string]any:
		return cams
	case []any:
		out := make([]map[string]any, 0, len(cams))
		for _, c := range cams {
			if m, ok := c.(map[string]any); ok {
				out = append(out, m)
			}
		}
		return out
	}
	return nil
}

func (h *Hub) SendToDevice(orgID, sourceID string, msg []byte) bool {
	h.mu.RLock()
	orgMap, ok := h.deviceConns[orgID]
	if !ok {
		h.mu.RUnlock()
		return false
	}
	conn, ok := orgMap[sourceID]
	h.mu.RUnlock()
	if !ok {
		return false
	}

	select {
	case conn.sendCh <- msg:
		return true
	default:
		// Device send channel full — drop the command rather than block.
		// Caller (browser command relay) reports the failure to the user.
		h.metrics.IncDropped(dropReasonBufferFullCommand)
		slog.Debug("device send buffer full", "org", orgID, "source", sourceID)
		return false
	}
}

// GetOnlineSources returns a snapshot of devices for an org. O(org devices).
func (h *Hub) GetOnlineSources(orgID string) []map[string]any {
	h.mu.RLock()
	defer h.mu.RUnlock()

	orgMap, ok := h.deviceConns[orgID]
	if !ok {
		return nil
	}

	sources := make([]map[string]any, 0, len(orgMap))
	for _, conn := range orgMap {
		sources = append(sources, map[string]any{
			"source_id": conn.sourceID,
			"platform":  conn.platform,
			"sensors":   conn.sensors,
			"cameras":   conn.cameras,
		})
	}
	return sources
}

// =========================================================================
// Browser connections
// =========================================================================

func (h *Hub) RegisterBrowser(conn *BrowserConn) {
	h.mu.Lock()
	if h.browserConns[conn.orgID] == nil {
		h.browserConns[conn.orgID] = make(map[*BrowserConn]struct{})
	}
	h.browserConns[conn.orgID][conn] = struct{}{}
	count := len(h.browserConns[conn.orgID])

	var newReader *OrgReader
	if _, exists := h.orgReaders[conn.orgID]; !exists {
		newReader = NewOrgReader(conn.orgID, h, h.redis, h.downsampleCfg)
		h.orgReaders[conn.orgID] = newReader
	}
	h.mu.Unlock()

	if newReader != nil {
		newReader.Start()
	}

	h.metrics.IncBrowsers()
	slog.Info("browser connected", "org", conn.orgID, "viewers", count)
}

func (h *Hub) UnregisterBrowser(conn *BrowserConn) {
	h.mu.Lock()
	var stopReader *OrgReader
	if browsers, ok := h.browserConns[conn.orgID]; ok {
		delete(browsers, conn)
		// Clean up camera subscriptions for this browser. Delete emptied
		// sets too (matching UnsubscribeCamera) so keys don't accumulate.
		for cameraID, subs := range h.cameraSubs {
			delete(subs, conn)
			if len(subs) == 0 {
				delete(h.cameraSubs, cameraID)
			}
		}
		if len(browsers) == 0 {
			delete(h.browserConns, conn.orgID)
			if reader, exists := h.orgReaders[conn.orgID]; exists {
				stopReader = reader
				delete(h.orgReaders, conn.orgID)
			}
		}
	}
	h.mu.Unlock()

	if stopReader != nil {
		stopReader.Stop()
	}

	h.metrics.DecBrowsers()
	slog.Info("browser disconnected", "org", conn.orgID)
}

// =========================================================================
// Broadcasting
// =========================================================================

// snapshotAllBrowsers returns a stable slice of all browser connections across
// every org. Used by the video session sweep to emit periodic billing records.
func (h *Hub) snapshotAllBrowsers() []*BrowserConn {
	h.mu.RLock()
	defer h.mu.RUnlock()
	var all []*BrowserConn
	for _, browsers := range h.browserConns {
		for bc := range browsers {
			all = append(all, bc)
		}
	}
	return all
}

// snapshotBrowsers returns a stable slice of browser connections for an org.
// Iterating over this slice is safe even if the underlying map changes.
func (h *Hub) snapshotBrowsers(orgID string) []*BrowserConn {
	h.mu.RLock()
	defer h.mu.RUnlock()
	browsers := h.browserConns[orgID]
	if len(browsers) == 0 {
		return nil
	}
	snapshot := make([]*BrowserConn, 0, len(browsers))
	for bc := range browsers {
		snapshot = append(snapshot, bc)
	}
	return snapshot
}

// RelayVideoFrame sends a video frame from a device to browsers for that org.
// Frames are ephemeral; slow browsers drop them rather than blocking the relay.
// Only relays to browsers subscribed to this camera_id (or all if subscription is empty).
// sourceID is the originating device; browsers whose camera subscribe carried a
// source_id scope only receive frames from that source (camera IDs are not
// unique across an org — every device defaults to "default").
// Uses camera subscription registry for O(1) lookup when available.
func (h *Hub) RelayVideoFrame(orgID string, sourceID string, cameraID string, frame []byte) {
	// Snapshot the subscriber set while still holding the lock —
	// Subscribe/UnsubscribeCamera mutate the same map under h.mu.Lock, so
	// iterating it after RUnlock is a fatal concurrent map iteration.
	h.mu.RLock()
	subs := h.cameraSubs[orgID+":"+cameraID]
	var targets []*BrowserConn
	if len(subs) > 0 {
		// O(1) lookup: only browsers subscribed to this camera
		targets = make([]*BrowserConn, 0, len(subs))
		for bc := range subs {
			targets = append(targets, bc)
		}
	}
	h.mu.RUnlock()
	if targets == nil {
		// No subscriptions yet: relay to all browsers in org (backwards compatible)
		targets = h.snapshotBrowsers(orgID)
	}

	now := time.Now().UnixNano()
	for _, bc := range targets {
		if !bc.subs.Video {
			continue
		}
		// Source scope: subscriptions made with a source_id only receive
		// frames originating from that source.
		bc.mu.Lock()
		videoSourceID := bc.videoSourceID
		bc.mu.Unlock()
		if videoSourceID != "" && videoSourceID != sourceID {
			continue
		}
		// Check throttle (hidden tab)
		if tu := atomic.LoadInt64(&bc.throttleUntil); tu > 0 && now < tu {
			h.metrics.IncDropped(dropReasonThrottle)
			continue
		}

		// Time-based rate limit. Works regardless of device send rate:
		// drop the frame if less than 1/maxFps seconds have passed since
		// the last forwarded frame for this camera.
		bc.mu.Lock()
		if bc.maxFps > 0 {
			minGap := int64(time.Second) / int64(bc.maxFps)
			if now-bc.lastSentNs[cameraID] < minGap {
				bc.mu.Unlock()
				continue
			}
			bc.lastSentNs[cameraID] = now
		}
		bc.mu.Unlock()

		select {
		case bc.sendCh <- frame:
		default:
			h.metrics.IncDropped(dropReasonBufferFullVideo)
		}
	}
	h.metrics.IncVideoFrames(orgID)
}

// SubscribeCamera adds a browser to a camera's subscription set.
func (h *Hub) SubscribeCamera(conn *BrowserConn, cameraID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	key := conn.orgID + ":" + cameraID
	if h.cameraSubs[key] == nil {
		h.cameraSubs[key] = make(map[*BrowserConn]struct{})
	}
	h.cameraSubs[key][conn] = struct{}{}
}

// UnsubscribeCamera removes a browser from a camera's subscription set.
func (h *Hub) UnsubscribeCamera(conn *BrowserConn, cameraID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	key := conn.orgID + ":" + cameraID
	if subs, ok := h.cameraSubs[key]; ok {
		delete(subs, conn)
		if len(subs) == 0 {
			delete(h.cameraSubs, key)
		}
	}
}

// BroadcastToOrg sends a control message to all browser connections for an org.
// Used for low-volume system events: source_status, heartbeats, events.
// Telemetry batches use DeliverBatch instead.
// Throttled connections (hidden tabs) are skipped entirely.
func (h *Hub) BroadcastToOrg(orgID string, data []byte) {
	now := time.Now().UnixNano()
	for _, bc := range h.snapshotBrowsers(orgID) {
		if tu := atomic.LoadInt64(&bc.throttleUntil); tu > 0 && now < tu {
			h.metrics.IncDropped(dropReasonThrottle)
			continue
		}
		select {
		case bc.sendCh <- data:
		default:
			h.metrics.IncDropped(dropReasonBufferFullBroadcast)
		}
	}
}

// DeliverBatch distributes a telemetry flush batch to all browsers for an org
// using the pull-flow model. Each browser receives the batch when it signals
// readiness via { type: "ready" }, so the gateway never blocks or drops due to
// a slow browser on the telemetry path.
//
// Throttled browsers (hidden tabs) have their pendingBatch updated so they
// always have the latest state ready the moment they un-throttle — no flush
// wait, no data gap — but nothing is delivered to batchCh while hidden.
func (h *Hub) DeliverBatch(orgID string, data []byte) {
	now := time.Now().UnixNano()
	for _, bc := range h.snapshotBrowsers(orgID) {
		if !bc.subs.Telemetry {
			continue
		}
		if tu := atomic.LoadInt64(&bc.throttleUntil); tu > 0 && now < tu {
			bc.setThrottledBatch(data)
			continue
		}
		bc.setBatch(data)
	}
}

// BroadcastEventToOrg sends an event point to browsers for an org.
// Connections with a logsDeviceID subscription only receive events for
// that device; unfiltered connections (browser/share auth) receive all.
func (h *Hub) BroadcastEventToOrg(orgID, sourceID string, data []byte) {
	now := time.Now().UnixNano()
	for _, bc := range h.snapshotBrowsers(orgID) {
		if tu := atomic.LoadInt64(&bc.throttleUntil); tu > 0 && now < tu {
			h.metrics.IncDropped(dropReasonThrottle)
			continue
		}
		bc.mu.Lock()
		logsDeviceID := bc.logsDeviceID
		bc.mu.Unlock()
		if logsDeviceID != "" && logsDeviceID != sourceID {
			continue
		}
		select {
		case bc.sendCh <- data:
		default:
			h.metrics.IncDropped(dropReasonBufferFullEvent)
		}
	}
}

// DeliverMetricsBatch delivers a filtered telemetry batch to data_api
// connections that have a metrics stream subscription. Each subscriber
// only receives points for its subscribed device and metric names.
func (h *Hub) DeliverMetricsBatch(orgID string, buffer map[string][]*BufferEntry) {
	for _, bc := range h.snapshotBrowsers(orgID) {
		bc.mu.Lock()
		deviceID := bc.metricsDeviceID
		filter := bc.metricsFilter
		bc.mu.Unlock()

		if deviceID == "" {
			continue
		}

		prefix := deviceID + ":"
		var points []json.RawMessage
		for key, entries := range buffer {
			if !strings.HasPrefix(key, prefix) {
				continue
			}
			if filter != nil {
				metric := key[len(prefix):]
				if _, ok := filter[metric]; !ok {
					continue
				}
			}
			for _, entry := range entries {
				points = append(points, entry.Raw)
			}
		}

		if len(points) == 0 {
			continue
		}

		payload, err := json.Marshal(map[string]any{
			"type":   "telemetry",
			"points": points,
		})
		if err != nil {
			continue
		}

		select {
		case bc.sendCh <- payload:
		default:
		}
	}
}

func (h *Hub) broadcastToBrowsers(orgID string, msg map[string]any) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	h.BroadcastToOrg(orgID, data)
}

// =========================================================================
// Status
// =========================================================================

// Status returns the FULL gateway status, including per-connection identifiers
// (source_id / org / platform). This is sensitive: serve it only to
// authenticated internal callers, never on the unauthenticated /health edge.
// The public /health path uses HealthSummary instead.
func (h *Hub) Status() map[string]any {
	h.mu.RLock()

	orgs := make([]string, 0, len(h.orgReaders))
	for org := range h.orgReaders {
		orgs = append(orgs, org)
	}

	browserCount := 0
	for _, browsers := range h.browserConns {
		browserCount += len(browsers)
	}

	deviceCount := 0
	devices := make([]map[string]any, 0)
	for orgID, orgMap := range h.deviceConns {
		deviceCount += len(orgMap)
		for _, conn := range orgMap {
			devices = append(devices, map[string]any{
				"source_id": conn.sourceID,
				"org":       orgID,
				"platform":  conn.platform,
			})
		}
	}
	h.mu.RUnlock()

	// Check Redis liveness (bypasses the circuit breaker — we want the
	// actual state right now, not the last-seen state).
	redisStatus := "connected"
	pingCtx, cancel := context.WithTimeout(context.Background(), h.redisCfg.PingTimeout)
	defer cancel()
	if err := h.redis.Ping(pingCtx); err != nil {
		redisStatus = "error: " + err.Error()
	} else if !h.redis.Healthy() {
		// Ping succeeded but the circuit hasn't closed yet (probe hasn't run).
		redisStatus = "degraded (circuit open)"
	}

	overall := "ok"
	if !h.redis.Healthy() {
		overall = "degraded"
	}

	return map[string]any{
		"status":      overall,
		"devices":     deviceCount,
		"browsers":    browserCount,
		"orgs":        orgs,
		"device_list": devices,
		"redis":       redisStatus,
		"uptime_s":    int(time.Since(h.startedAt).Seconds()),
	}
}

// HealthSummary is the PUBLIC payload served at the unauthenticated
// GET /health edge. It exposes only aggregate counts and liveness — never the
// per-connection identifiers (source_id / org / platform) that Status()
// carries, which would leak customer topology. Keys are allow-listed from
// Status() so a new field added there can't silently leak through /health.
func (h *Hub) HealthSummary() map[string]any {
	full := h.Status()
	return map[string]any{
		"status":   full["status"],
		"devices":  full["devices"],
		"browsers": full["browsers"],
		"redis":    full["redis"],
		"uptime_s": full["uptime_s"],
	}
}

// =========================================================================
// Video session sweep
// =========================================================================

const videoSessionSweepInterval = 5 * time.Minute

// StartVideoSessionSweep periodically emits partial video session records for
// all connected browsers. This ensures long-running sessions (dashboards that
// never disconnect) are billed on a regular cadence rather than only at
// disconnect time. Each sweep emits one record per active browser covering the
// elapsed chunk since the last emit.
func (h *Hub) StartVideoSessionSweep(ctx context.Context) {
	ticker := time.NewTicker(videoSessionSweepInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			for _, bc := range h.snapshotAllBrowsers() {
				go emitVideoSession(bc, h)
			}
		}
	}
}

// =========================================================================
// Shutdown
// =========================================================================

func (h *Hub) StopAllReaders() {
	h.mu.Lock()
	readers := make([]*OrgReader, 0, len(h.orgReaders))
	for _, r := range h.orgReaders {
		readers = append(readers, r)
	}
	h.orgReaders = make(map[string]*OrgReader)
	h.mu.Unlock()

	for _, r := range readers {
		r.Stop()
	}
}
