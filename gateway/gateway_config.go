package main

// GatewayConfig — single source of truth for all gateway configuration.
//
// Defaults are hardcoded for local dev. Production (auth=api) pulls values
// from environment variables that Fly.io or similar sets.
//
// Precedence: flags > env vars > mode defaults (dev or prod).

import (
	"flag"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"
)

// =========================================================================
// Top-level config
// =========================================================================

type GatewayConfig struct {
	// Listen address for the HTTP/WebSocket server (e.g. ":8080").
	Addr string

	// Listen address for the Prometheus /metrics endpoint. Separate from
	// Addr so metrics traffic stays off the public WebSocket port.
	// Empty string disables metrics entirely (zero overhead).
	MetricsAddr string

	// Auth mode. "dev" skips external auth and uses DefaultOrg for everything.
	// "api" calls the Next.js app to verify API keys and session tokens.
	AuthMode string

	// LogLevel: debug | info | warn | error. Default: info.
	LogLevel string

	// AllowedOrigins restricts browser WebSocket connections by Origin header.
	// Glob patterns supported per github.com/coder/websocket OriginPatterns
	// (e.g. "app.plexus.company", "*.plexus.company", "localhost:*").
	//
	// Dev mode: defaults to ["*"] (allow all). Prod mode: required — must be
	// populated via GATEWAY_ALLOWED_ORIGINS env var (comma-separated).
	//
	// Not applied to the device WebSocket. Native device clients do not
	// send an Origin header, and API key auth is the real gate.
	AllowedOrigins []string

	// Redis connection + stream behavior.
	Redis RedisConfig

	// Auth verification and caching behavior.
	Auth AuthConfig

	// Per-connection rate limiting.
	RateLimit RateLimitConfig

	// Message size and validation limits.
	Limits LimitsConfig

	// Downsample / browser fan-out tuning.
	Downsample DownsampleConfig

	// Connection timeouts and buffer sizes.
	Connections ConnectionsConfig

	// Hard safety limits the gateway enforces on all devices.
	Safety SafetyConfig

	// Dev-mode defaults (the --org fallback). No per-org config is read
	// from Redis.
	Defaults DefaultsConfig
}

// =========================================================================
// Sub-configs
// =========================================================================

// RedisConfig controls how the gateway talks to Redis.
type RedisConfig struct {
	Addr         string        // host:port for Redis connection
	PoolSize     int           // connection pool size; 10 is fine for co-located Redis
	StreamMaxLen int64         // per-org stream trim threshold; 100k × ~300B ≈ 30MB
	CallTimeout  time.Duration // timeout for SET/GET/XGROUP calls
	PingTimeout  time.Duration // timeout for health-check ping
}

// AuthConfig controls auth verification and caching.
type AuthConfig struct {
	// Next.js API URL for verifying keys and sessions (auth=api only).
	APIURL string

	// Shared secret used for server-to-server POSTs back to the Next.js app
	// (e.g. schema announcement). Matches the PLEXUS_INTERNAL_SECRET value
	// the Next.js app expects in its x-internal-secret header. Empty in
	// dev mode disables schema announcement.
	InternalSecret string

	// HTTP client timeout for auth calls to the Next.js app.
	HTTPTimeout time.Duration

	// How long to cache successful auth results.
	CacheTTL time.Duration

	// How long to cache failed auth results. Shorter than CacheTTL so a
	// legitimate key that temporarily failed can recover quickly, but
	// long enough to prevent DDoS from repeated bad-key attempts.
	NegativeCacheTTL time.Duration

	// Max bytes to read from the auth response body. Prevents OOM from
	// a malicious or buggy auth server returning a huge response.
	MaxResponseBytes int64
}

// RateLimitConfig controls per-connection token bucket rate limits.
// Two tiers: "control" for commands, "telemetry" for data.
type RateLimitConfig struct {
	ControlBurst    int // max queued browser commands before limiting
	ControlPerSec   int // sustained browser commands per second
	TelemetryBurst  int // max queued telemetry messages before limiting
	TelemetryPerSec int // sustained telemetry messages per second — binding limit
}

// LimitsConfig controls message size and validation limits.
type LimitsConfig struct {
	MaxMessageSize    int64 // max WebSocket message bytes; connection closed if exceeded
	MaxPointsPerBatch int   // max data points per telemetry message
	MaxStringLen      int   // max chars for metric names, source_id, tag keys/values
	MaxValueBytes     int   // max JSON bytes for event value field; blocks payload smuggling
	MaxTagsPerPoint   int   // max key/value pairs in a point's tags object
}

// DownsampleConfig tunes the per-org Redis reader and browser flush cadence.
type DownsampleConfig struct {
	ConsumerGroup string        // Redis consumer group; must not clash with ch-loader/alerts
	ConsumerName  string        // unique per gateway instance for XREADGROUP tracking
	PollCount     int64         // messages read per XREADGROUP round-trip
	PollBlock     time.Duration // Redis idle wait before returning empty
	FlushInterval time.Duration // browser telemetry refresh cadence; cost is O(unique metrics)
}

// SafetyConfig is the gateway's hard ceiling on device behavior.
// Protective limits only — not customer-facing tuning knobs.
type SafetyConfig struct {
	MaxHzPerSource float64 // hard drop ceiling per (org, source); counts messages not points
}

// ConnectionsConfig controls WebSocket connection timeouts and buffer sizes.
type ConnectionsConfig struct {
	DeviceAuthTimeout  time.Duration // timeout waiting for first device_auth message
	BrowserAuthTimeout time.Duration // timeout waiting for browser_auth or share_auth
	DeviceSendBuffer   int           // command slots queued toward device; commands are infrequent
	BrowserSendBuffer  int           // video + control slots toward browser; telemetry uses batchCh
}

// DefaultsConfig holds dev-only defaults.
type DefaultsConfig struct {
	// Default org ID used in dev mode (auth=dev). All devices and browsers
	// resolve to this org regardless of credentials. Not used in prod mode.
	DevOrg string
}

// =========================================================================
// Defaults — dev vs prod
// =========================================================================

// devDefaults returns a config tuned for local development.
// Everything points at localhost, no external dependencies.
func devDefaults() *GatewayConfig {
	return &GatewayConfig{
		Addr:           ":8080",
		MetricsAddr:    ":9090",
		AuthMode:       "dev",
		LogLevel:       "info",
		AllowedOrigins: []string{"*"}, // allow any origin in dev
		Redis: RedisConfig{
			Addr:         "localhost:6379",
			PoolSize:     10, // fine for dev; prod overrides via REDIS_POOL_SIZE
			StreamMaxLen: 100_000,
			CallTimeout:  2 * time.Second,
			PingTimeout:  500 * time.Millisecond,
		},
		Auth: AuthConfig{
			APIURL:           "", // not used in dev
			HTTPTimeout:      5 * time.Second,
			CacheTTL:         60 * time.Second,
			NegativeCacheTTL: 10 * time.Second,
			MaxResponseBytes: 4096,
		},
		RateLimit: RateLimitConfig{
			ControlBurst:    60,
			ControlPerSec:   20,
			TelemetryBurst:  2000,
			TelemetryPerSec: 500,
		},
		Limits: LimitsConfig{
			MaxMessageSize:    1_048_576, // 1 MB
			MaxPointsPerBatch: 10_000,
			MaxStringLen:      256,
			MaxValueBytes:     4_096, // event values (structured JSON allowed)
			MaxTagsPerPoint:   16,
		},
		Downsample: DownsampleConfig{
			// These two are always overwritten in LoadGatewayConfig with the
			// per-instance "dashboard:<instanceID>" group / "<instanceID>"
			// consumer (see resolveInstanceID) — the shared names below never run.
			ConsumerGroup: "dashboard",
			ConsumerName:  "dashboard-01",
			PollCount:     500,
			// 15ms block: ~3x fewer idle XREADGROUP commands than the
			// prior 5ms block. Worst-case dashboard latency impact is
			// ~10ms on idle streams; near-zero on busy ones.
			PollBlock:     15 * time.Millisecond,
			FlushInterval: 25 * time.Millisecond,
		},
		Connections: ConnectionsConfig{
			DeviceAuthTimeout:  10 * time.Second,
			BrowserAuthTimeout: 10 * time.Second,
			DeviceSendBuffer:   64,
			BrowserSendBuffer:  128, // sendCh carries video frames + control messages
		},
		Safety: SafetyConfig{
			MaxHzPerSource: 2000,
		},
		Defaults: DefaultsConfig{},
	}
}

// prodDefaults returns a config tuned for production deployment.
// Critical values come from env vars (set by Fly.io or similar).
// Tuning values fall back to the same defaults as dev unless overridden.
func prodDefaults() *GatewayConfig {
	cfg := devDefaults()
	cfg.AuthMode = "api"
	cfg.LogLevel = "info"
	cfg.AllowedOrigins = nil // must be set via env var; validation enforces this

	// Required env vars in prod
	cfg.Redis.Addr = os.Getenv("REDIS_URL")       // e.g. "plexus-redis.internal:6379"
	cfg.Auth.APIURL = os.Getenv("PLEXUS_API_URL") // e.g. "https://app.plexus.company"
	cfg.Auth.InternalSecret = os.Getenv("PLEXUS_INTERNAL_SECRET")

	if v := os.Getenv("GATEWAY_ALLOWED_ORIGINS"); v != "" {
		for _, origin := range strings.Split(v, ",") {
			origin = strings.TrimSpace(origin)
			if origin != "" {
				cfg.AllowedOrigins = append(cfg.AllowedOrigins, origin)
			}
		}
	}

	if v := os.Getenv("REDIS_POOL_SIZE"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			cfg.Redis.PoolSize = n
		}
	}

	// All tuning values (rate limits, buffer sizes, flush intervals) are
	// set in devDefaults() and shared across all modes. Change them in
	// code and redeploy — no env var overrides.

	return cfg
}

// =========================================================================
// Loader
// =========================================================================

// LoadGatewayConfig determines dev/prod mode, applies defaults, overlays env
// vars and flags, and validates the result.
//
// Mode is determined by the GATEWAY_MODE env var or --mode flag:
//   - "dev" (default): local defaults
//   - "prod": env-var driven
func LoadGatewayConfig() (*GatewayConfig, error) {
	// Determine mode first. Check env var and bare flag manually so we can
	// pick the right defaults before calling flag.Parse.
	mode := os.Getenv("GATEWAY_MODE")
	if mode == "" {
		mode = "dev"
	}
	for i, arg := range os.Args[1:] {
		if arg == "--mode" || arg == "-mode" {
			if i+1 < len(os.Args[1:]) {
				mode = os.Args[i+2]
			}
		} else if len(arg) > 7 && arg[:7] == "--mode=" {
			mode = arg[7:]
		} else if len(arg) > 6 && arg[:6] == "-mode=" {
			mode = arg[6:]
		}
	}

	var cfg *GatewayConfig
	switch mode {
	case "prod":
		cfg = prodDefaults()
	case "dev", "":
		cfg = devDefaults()
	default:
		return nil, fmt.Errorf("invalid mode %q (must be 'dev' or 'prod')", mode)
	}

	// Shared flags that can override any mode's defaults.
	flag.String("mode", mode, "deployment mode: dev (local) or prod (env-var driven)")
	flag.StringVar(&cfg.Addr, "addr", cfg.Addr, "listen address")
	flag.StringVar(&cfg.MetricsAddr, "metrics-addr", cfg.MetricsAddr, "Prometheus metrics listen address (empty disables)")
	flag.StringVar(&cfg.Redis.Addr, "redis", cfg.Redis.Addr, "Redis address")
	flag.StringVar(&cfg.AuthMode, "auth", cfg.AuthMode, "auth mode: dev or api")
	flag.StringVar(&cfg.Auth.APIURL, "api-url", cfg.Auth.APIURL, "Next.js API URL (for auth=api)")
	flag.StringVar(&cfg.LogLevel, "log-level", cfg.LogLevel, "log level: debug, info, warn, error")
	flag.IntVar(&cfg.Redis.PoolSize, "redis-pool-size", cfg.Redis.PoolSize, "Redis connection pool size")

	// Org flag is only meaningful in dev mode (auth=dev uses it as the
	// default org for all devices).
	var devOrg string
	flag.StringVar(&devOrg, "org", "default", "default org ID (dev mode only)")

	flag.Parse()

	if cfg.AuthMode == "dev" {
		cfg.Defaults.DevOrg = devOrg
	}

	// InternalSecret is optional. Respect it in either mode so a dev
	// gateway can announce discovered metrics back to its local frontend.
	if cfg.Auth.InternalSecret == "" {
		cfg.Auth.InternalSecret = os.Getenv("PLEXUS_INTERNAL_SECRET")
	}

	// Override group name with per-instance group for broadcast semantics.
	// Was the shared "dashboard" / "dashboard-01", which causes work-sharing
	// partition across nodes.
	id, fromHostname := resolveInstanceID()
	cfg.Downsample.ConsumerGroup = "dashboard:" + id
	cfg.Downsample.ConsumerName = id

	// The instance id must be (1) distinct per node — two nodes sharing an id
	// share a consumer group, which silently reintroduces work-sharing
	// partition (the bug per-instance groups exist to prevent) — and (2)
	// stable across restarts, or each restart orphans a group. On Fly both
	// are free via FLY_MACHINE_ID. A hostname fallback in prod satisfies
	// neither reliably (container hostnames change on recreate), so warn
	// loudly rather than fail — failing would break non-Fly single-box
	// deploys where the hostname is in fact stable.
	if fromHostname && cfg.AuthMode == "api" {
		slog.Warn("GATEWAY_INSTANCE_ID unset; derived from hostname — set it explicitly for stable, distinct consumer groups across restarts and nodes", "instance_id", id)
	}

	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

// resolveInstanceID returns the gateway's instance id and whether it had to
// fall back to the hostname. Precedence: GATEWAY_INSTANCE_ID > FLY_MACHINE_ID >
// hostname. The boolean lets the caller warn when neither explicit source is
// set (see LoadGatewayConfig), since a hostname-derived id is neither stable
// across container recreate nor guaranteed distinct across nodes.
func resolveInstanceID() (string, bool) {
	if v := os.Getenv("GATEWAY_INSTANCE_ID"); v != "" {
		return v, false
	}
	if v := os.Getenv("FLY_MACHINE_ID"); v != "" {
		return v, false
	}
	h, _ := os.Hostname()
	return h, true
}

// =========================================================================
// Validation
// =========================================================================

// Validate returns an error if the config is invalid.
func (c *GatewayConfig) Validate() error {
	if c.Addr == "" {
		return fmt.Errorf("addr is required")
	}
	if c.Redis.Addr == "" {
		return fmt.Errorf("redis address is required (set REDIS_URL in prod or --redis)")
	}
	if c.AuthMode != "dev" && c.AuthMode != "api" {
		return fmt.Errorf("auth must be 'dev' or 'api', got %q", c.AuthMode)
	}
	if c.AuthMode == "api" && c.Auth.APIURL == "" {
		return fmt.Errorf("api-url is required when auth=api (set PLEXUS_API_URL)")
	}
	// Fail closed: /internal/command relays device commands and is guarded only
	// by x-internal-secret. If the secret is unset in prod the handler would
	// wave every request through, so refuse to boot instead.
	if c.AuthMode == "api" && c.Auth.InternalSecret == "" {
		return fmt.Errorf("internal secret is required in prod mode (set PLEXUS_INTERNAL_SECRET); /internal/command must not be reachable without it")
	}
	if c.AuthMode == "api" && len(c.AllowedOrigins) == 0 {
		return fmt.Errorf("allowed origins required in prod mode (set GATEWAY_ALLOWED_ORIGINS)")
	}
	if c.AuthMode == "dev" && c.Defaults.DevOrg == "" {
		return fmt.Errorf("org is required when auth=dev")
	}
	if c.Downsample.FlushInterval <= 0 {
		return fmt.Errorf("downsample flush interval must be positive, got %s", c.Downsample.FlushInterval)
	}
	if c.Downsample.PollBlock <= 0 {
		return fmt.Errorf("downsample poll block must be positive, got %s", c.Downsample.PollBlock)
	}
	if c.Safety.MaxHzPerSource <= 0 {
		return fmt.Errorf("safety max_hz_per_source must be positive, got %f", c.Safety.MaxHzPerSource)
	}
	if c.Redis.PoolSize < 1 {
		return fmt.Errorf("redis pool size must be positive, got %d", c.Redis.PoolSize)
	}
	if c.LogLevel != "debug" && c.LogLevel != "info" && c.LogLevel != "warn" && c.LogLevel != "error" {
		return fmt.Errorf("log-level must be debug/info/warn/error, got %q", c.LogLevel)
	}
	return nil
}

// IsDevMode reports whether auth verification is skipped.
func (c *GatewayConfig) IsDevMode() bool {
	return c.AuthMode == "dev"
}
