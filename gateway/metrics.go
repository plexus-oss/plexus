package main

// Prometheus metrics for the gateway.
//
// Exposed on a separate HTTP server (default :9090) so metrics traffic stays
// off the public WebSocket port. On Fly.io this is automatically scraped by
// Fly Metrics if you add a [[metrics]] block to fly.toml pointing at the
// metrics port.
//
// Cardinality discipline:
//   - org_id is labeled on counters where per-tenant breakdown is useful
//   - reason/result/kind labels use small fixed enums
//   - source_id and metric name are never labels (cardinality explosion)
//
// All label-bearing counters are accessed via helper methods that cache the
// concrete labeled metric per-org to avoid hash lookups on the hot path.

import (
	"sync"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
)

// Drop reasons (fixed enum to keep cardinality bounded).
const (
	dropReasonRateLimit           = "rate_limit"            // per-connection token bucket
	dropReasonSourceLimit         = "source_limit"          // per-source safety ceiling
	dropReasonValidation          = "validation"            // failed validator
	dropReasonInvalidJSON         = "invalid_json"          // couldn't parse
	dropReasonInvalidUTF8         = "invalid_utf8"          // text video_frame carried non-UTF-8 bytes
	dropReasonBufferFullVideo     = "buffer_full_video"     // RelayVideoFrame: browser send channel full
	dropReasonBufferFullCommand   = "buffer_full_command"   // SendToDevice: device send channel full
	dropReasonBufferFullBroadcast = "buffer_full_broadcast" // BroadcastToOrg: browser send channel full
	dropReasonBufferFullEvent     = "buffer_full_event"     // BroadcastEventToOrg: browser send channel full
	dropReasonThrottle            = "throttle"              // browser tab throttled
)

// Auth cache results.
const (
	authResultHit         = "hit"
	authResultMiss        = "miss"
	authResultNegativeHit = "negative_hit"
)

// Auth cache types.
const (
	authTypeKey     = "key"
	authTypeSession = "session"
	authTypeShare   = "share"
)

// Metrics holds all Prometheus collectors used by the gateway.
//
// A nil *Metrics is safe to use — all recording methods check for nil and
// no-op. This lets tests and dev mode skip metrics wiring entirely without
// sprinkling nil checks across every call site.
type Metrics struct {
	registry *prometheus.Registry

	// Connection gauges
	devicesConnected  prometheus.Gauge
	browsersConnected prometheus.Gauge

	// Traffic counters
	telemetryMessages *prometheus.CounterVec // labeled by org_id
	videoFrames       *prometheus.CounterVec // labeled by org_id
	heartbeats        *prometheus.CounterVec // labeled by org_id

	// Drop counters
	messagesDropped *prometheus.CounterVec // labeled by reason

	// Redis histograms
	redisXAddDuration prometheus.Histogram

	// Auth cache
	authCache *prometheus.CounterVec // labeled by type, result

	// Per-org counter cache to avoid hash lookups on the hot path
	orgCacheMu   sync.RWMutex
	telemHot     map[string]prometheus.Counter
	videoHot     map[string]prometheus.Counter
	heartbeatHot map[string]prometheus.Counter
}

// NewMetrics constructs and registers all collectors. Returns a ready-to-use
// Metrics and the registry (for serving /metrics).
func NewMetrics() *Metrics {
	reg := prometheus.NewRegistry()

	m := &Metrics{
		registry:     reg,
		telemHot:     make(map[string]prometheus.Counter),
		videoHot:     make(map[string]prometheus.Counter),
		heartbeatHot: make(map[string]prometheus.Counter),
	}

	m.devicesConnected = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "plexus_gateway_devices_connected",
		Help: "Number of currently-connected devices across all orgs.",
	})

	m.browsersConnected = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "plexus_gateway_browsers_connected",
		Help: "Number of currently-connected browsers across all orgs.",
	})

	m.telemetryMessages = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "plexus_gateway_telemetry_messages_total",
		Help: "Telemetry messages accepted and forwarded to Redis.",
	}, []string{"org_id"})

	m.videoFrames = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "plexus_gateway_video_frames_total",
		Help: "Video frames relayed from devices to browsers.",
	}, []string{"org_id"})

	m.heartbeats = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "plexus_gateway_heartbeats_total",
		Help: "Heartbeat messages written to Redis.",
	}, []string{"org_id"})

	m.messagesDropped = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "plexus_gateway_messages_dropped_total",
		Help: "Messages dropped by the gateway, labeled by reason.",
	}, []string{"reason"})

	m.redisXAddDuration = prometheus.NewHistogram(prometheus.HistogramOpts{
		Name: "plexus_gateway_redis_xadd_duration_seconds",
		Help: "Duration of Redis XADD calls (telemetry batch writes).",
		// Buckets tuned for localhost Redis: 0.1ms to 100ms
		Buckets: []float64{0.0001, 0.00025, 0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1},
	})

	m.authCache = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "plexus_gateway_auth_cache_total",
		Help: "Auth cache lookups, labeled by type (key|session) and result (hit|miss|negative_hit).",
	}, []string{"type", "result"})

	reg.MustRegister(
		m.devicesConnected,
		m.browsersConnected,
		m.telemetryMessages,
		m.videoFrames,
		m.heartbeats,
		m.messagesDropped,
		m.redisXAddDuration,
		m.authCache,
	)

	// Register Go process collectors so /metrics exposes standard
	// process_* and go_* metrics (RSS, CPU, goroutines, GC, etc).
	// Required for the plexus-admin Machine Basics card to render
	// anything for the gateway; without this they show as "—".
	reg.MustRegister(
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
		collectors.NewGoCollector(),
	)

	return m
}

// Registry returns the underlying Prometheus registry for exposing via HTTP.
func (m *Metrics) Registry() *prometheus.Registry {
	if m == nil {
		return nil
	}
	return m.registry
}

// =========================================================================
// Recording methods — all nil-safe
// =========================================================================

// DevicesConnected is updated on device register/unregister.
func (m *Metrics) IncDevices()  { nilSafeGaugeInc(m, m.devicesConnected) }
func (m *Metrics) DecDevices()  { nilSafeGaugeDec(m, m.devicesConnected) }
func (m *Metrics) IncBrowsers() { nilSafeGaugeInc(m, m.browsersConnected) }
func (m *Metrics) DecBrowsers() { nilSafeGaugeDec(m, m.browsersConnected) }

// IncTelemetryMessages records one accepted telemetry message from an org.
// Hot-path: uses a cached labeled counter per org to avoid label lookups.
func (m *Metrics) IncTelemetryMessages(orgID string) {
	if m == nil {
		return
	}
	m.orgCacheMu.RLock()
	c, ok := m.telemHot[orgID]
	m.orgCacheMu.RUnlock()
	if !ok {
		c = m.telemetryMessages.WithLabelValues(orgID)
		m.orgCacheMu.Lock()
		m.telemHot[orgID] = c
		m.orgCacheMu.Unlock()
	}
	c.Inc()
}

// IncVideoFrames records one relayed video frame from an org.
func (m *Metrics) IncVideoFrames(orgID string) {
	if m == nil {
		return
	}
	m.orgCacheMu.RLock()
	c, ok := m.videoHot[orgID]
	m.orgCacheMu.RUnlock()
	if !ok {
		c = m.videoFrames.WithLabelValues(orgID)
		m.orgCacheMu.Lock()
		m.videoHot[orgID] = c
		m.orgCacheMu.Unlock()
	}
	c.Inc()
}

// IncHeartbeats records one heartbeat written to Redis.
func (m *Metrics) IncHeartbeats(orgID string) {
	if m == nil {
		return
	}
	m.orgCacheMu.RLock()
	c, ok := m.heartbeatHot[orgID]
	m.orgCacheMu.RUnlock()
	if !ok {
		c = m.heartbeats.WithLabelValues(orgID)
		m.orgCacheMu.Lock()
		m.heartbeatHot[orgID] = c
		m.orgCacheMu.Unlock()
	}
	c.Inc()
}

// IncDropped records a message drop with a bounded reason enum.
func (m *Metrics) IncDropped(reason string) {
	if m == nil {
		return
	}
	m.messagesDropped.WithLabelValues(reason).Inc()
}

// ObserveRedisXAdd records the duration of a Redis XADD (or pipelined batch).
func (m *Metrics) ObserveRedisXAdd(seconds float64) {
	if m == nil {
		return
	}
	m.redisXAddDuration.Observe(seconds)
}

// IncAuthCache records an auth cache lookup.
func (m *Metrics) IncAuthCache(authType, result string) {
	if m == nil {
		return
	}
	m.authCache.WithLabelValues(authType, result).Inc()
}

// =========================================================================
// nil-safe gauge helpers
// =========================================================================

func nilSafeGaugeInc(m *Metrics, g prometheus.Gauge) {
	if m == nil {
		return
	}
	g.Inc()
}

func nilSafeGaugeDec(m *Metrics, g prometheus.Gauge) {
	if m == nil {
		return
	}
	g.Dec()
}
