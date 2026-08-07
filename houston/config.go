package main

// AlertServiceConfig — single source of truth for all alert service configuration.
//
// Follows the same pattern as the gateway: hardcoded dev defaults, env-var
// driven prod defaults, flag overrides. Mode is selected via ALERTD_MODE
// env var or --mode flag.

import (
	"flag"
	"fmt"
	"os"
	"strconv"
	"time"
)

// =========================================================================
// Top-level config
// =========================================================================

type AlertServiceConfig struct {
	// Listen address for the HTTP server (health, rule push, etc).
	Addr string

	// Listen address for Prometheus /metrics endpoint. Empty disables.
	MetricsAddr string

	// Deployment mode: "dev" or "prod".
	Mode string

	// LogLevel: debug | info | warn | error.
	LogLevel string

	// Redis connection settings.
	Redis RedisConfig

	// Internal-service auth (shared secret with Next.js).
	Internal InternalConfig

	// Stream consumer tuning.
	Consumer ConsumerConfig

	// Transition notifier (POST to Next.js).
	Notifier NotifierConfig

	// Distribution tracker tuning.
	Distribution DistributionConfig

	// Alert lifecycle defaults.
	Alerts AlertDefaults

	// Path to on-disk snapshot of the last-known-good rule set. Used as a
	// bootstrap fallback when the Next.js control plane is unreachable.
	// Empty disables the cache (not recommended in prod).
	RulesCachePath string

	// Self-telemetry into Plexus itself (see selfmonitor.go). Disabled
	// unless an API key is configured.
	SelfMonitor SelfMonitorConfig
}

// =========================================================================
// Sub-configs
// =========================================================================

type RedisConfig struct {
	// Redis address in host:port form.
	Addr string

	// Connection pool size.
	PoolSize int

	// Timeout for non-streaming Redis calls.
	CallTimeout time.Duration

	// Timeout for health-check Ping.
	PingTimeout time.Duration
}

type InternalConfig struct {
	// Next.js API URL for bootstrap and transition POSTs.
	APIURL string

	// Shared secret for x-internal-secret header.
	Secret string
}

type ConsumerConfig struct {
	// Redis consumer group name.
	ConsumerGroup string

	// Consumer instance name within the group.
	ConsumerName string

	// Max messages per XREADGROUP call.
	PollCount int64

	// XREADGROUP block time.
	PollBlock time.Duration
}

type NotifierConfig struct {
	// How often to flush batched transitions to Next.js.
	FlushInterval time.Duration

	// Max transitions per batch before forcing a flush.
	BatchSize int

	// HTTP timeout per POST to Next.js.
	Timeout time.Duration

	// Max retry attempts on failure.
	MaxRetries int
}

type DistributionConfig struct {
	// Exponential decay factor for Welford's algorithm. Each new value
	// is blended with weight Alpha. Lower = slower adaptation.
	// Default 0.01: a point becomes negligible after ~500 subsequent points.
	Alpha float64
}

type AlertDefaults struct {
	// Default hysteresis duration for rules that don't specify one.
	HysteresisSeconds int

	// Default cooldown duration for rules that don't specify one.
	CooldownSeconds int

	// Default minimum samples before outlier rules can fire.
	MinSamples int
}

// =========================================================================
// Defaults — dev vs prod
// =========================================================================

func devDefaults() *AlertServiceConfig {
	return &AlertServiceConfig{
		Addr:        ":8081",
		MetricsAddr: ":9091",
		Mode:        "dev",
		LogLevel:    "info",
		Redis: RedisConfig{
			Addr:        "localhost:6379",
			PoolSize:    10,
			CallTimeout: 2 * time.Second,
			PingTimeout: 500 * time.Millisecond,
		},
		Internal: InternalConfig{
			APIURL: "http://localhost:3000",
			Secret: "",
		},
		Consumer: ConsumerConfig{
			ConsumerGroup: "alerts",
			ConsumerName:  "alerts-01",
			PollCount:     500,
			PollBlock:     100 * time.Millisecond,
		},
		Notifier: NotifierConfig{
			FlushInterval: 1 * time.Second,
			BatchSize:     50,
			Timeout:       5 * time.Second,
			MaxRetries:    3,
		},
		Distribution: DistributionConfig{
			Alpha: 0.01,
		},
		Alerts: AlertDefaults{
			HysteresisSeconds: 30,
			CooldownSeconds:   60,
			MinSamples:        30,
		},
		RulesCachePath: "./rules-cache.json",
		SelfMonitor: SelfMonitorConfig{
			IngestURL: "http://localhost:8080/ingest",
			APIKey:    "", // disabled unless set
			SourceID:  "plexus-alert-service",
			Interval:  30 * time.Second,
		},
	}
}

func prodDefaults() *AlertServiceConfig {
	cfg := devDefaults()
	cfg.Mode = "prod"

	// Required env vars in prod.
	cfg.Redis.Addr = os.Getenv("REDIS_URL")
	cfg.Internal.APIURL = os.Getenv("PLEXUS_API_URL")
	cfg.Internal.Secret = os.Getenv("PLEXUS_INTERNAL_SECRET")

	// Listen addresses. Fly's fly.toml sets these via [env]; honor
	// them here so the env var isn't silently ignored. Flag override
	// still wins via LoadConfig's flag parsing.
	if v := os.Getenv("ALERTD_ADDR"); v != "" {
		cfg.Addr = v
	}
	if v := os.Getenv("ALERTD_METRICS_ADDR"); v != "" {
		cfg.MetricsAddr = v
	}

	// Optional overrides.
	if v := os.Getenv("LOG_LEVEL"); v != "" {
		cfg.LogLevel = v
	}
	if v := os.Getenv("REDIS_POOL_SIZE"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			cfg.Redis.PoolSize = n
		}
	}
	if v := os.Getenv("ALERTD_CONSUMER_GROUP"); v != "" {
		cfg.Consumer.ConsumerGroup = v
	}
	// Consumer name must be unique per machine within a Redis consumer
	// group, otherwise two instances share a PEL and lose parallelism.
	// Precedence: explicit ALERTD_CONSUMER_NAME > auto-templated from
	// FLY_MACHINE_ID (when running on Fly) > dev default.
	if v := os.Getenv("ALERTD_CONSUMER_NAME"); v != "" {
		cfg.Consumer.ConsumerName = v
	} else if id := os.Getenv("FLY_MACHINE_ID"); id != "" {
		cfg.Consumer.ConsumerName = "alerts-" + id
	}
	if v := os.Getenv("ALERTD_NOTIFY_INTERVAL"); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			cfg.Notifier.FlushInterval = d
		}
	}
	if v := os.Getenv("ALERTD_DISTRIBUTION_ALPHA"); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			cfg.Distribution.Alpha = f
		}
	}
	if v := os.Getenv("ALERTD_RULES_CACHE_PATH"); v != "" {
		cfg.RulesCachePath = v
	}

	// Self-telemetry (dogfood): enabled iff the API key is present.
	cfg.SelfMonitor.IngestURL = "http://plexus-gateway.internal:8080/ingest"
	if v := os.Getenv("PLEXUS_SELF_INGEST_URL"); v != "" {
		cfg.SelfMonitor.IngestURL = v
	}
	cfg.SelfMonitor.APIKey = os.Getenv("PLEXUS_SELF_API_KEY")
	if v := os.Getenv("PLEXUS_SELF_SOURCE_ID"); v != "" {
		cfg.SelfMonitor.SourceID = v
	}

	return cfg
}

// =========================================================================
// Loader
// =========================================================================

func LoadConfig() (*AlertServiceConfig, error) {
	// Mode must be resolved BEFORE flag registration: it selects the
	// default config that the other flags are registered against. This
	// manual pre-scan of os.Args is therefore the single mechanism that
	// determines mode; it accepts the same four spellings the flag
	// package does (--mode X, -mode X, --mode=X, -mode=X).
	mode := os.Getenv("ALERTD_MODE")
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

	var cfg *AlertServiceConfig
	switch mode {
	case "prod":
		cfg = prodDefaults()
	case "dev", "":
		cfg = devDefaults()
	default:
		return nil, fmt.Errorf("invalid mode %q (must be 'dev' or 'prod')", mode)
	}

	// Flag overrides.
	//
	// --mode is NOT re-parsed here: it was already resolved by the
	// pre-scan above. This registration exists only so flag.Parse()
	// accepts the argument and -help documents it; the parsed value is
	// intentionally discarded (it always equals the pre-scanned value).
	flag.String("mode", mode, "deployment mode: dev or prod (resolved before flag parsing)")
	flag.StringVar(&cfg.Addr, "addr", cfg.Addr, "HTTP listen address")
	flag.StringVar(&cfg.MetricsAddr, "metrics-addr", cfg.MetricsAddr, "Prometheus metrics listen address")
	flag.StringVar(&cfg.Redis.Addr, "redis", cfg.Redis.Addr, "Redis address")
	flag.StringVar(&cfg.Internal.APIURL, "api-url", cfg.Internal.APIURL, "Next.js API URL")
	flag.StringVar(&cfg.Internal.Secret, "internal-secret", cfg.Internal.Secret, "shared secret for internal calls")
	flag.StringVar(&cfg.LogLevel, "log-level", cfg.LogLevel, "log level: debug, info, warn, error")

	flag.Parse()

	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

// =========================================================================
// Validation
// =========================================================================

func (c *AlertServiceConfig) Validate() error {
	if c.Addr == "" {
		return fmt.Errorf("addr is required")
	}
	if c.Redis.Addr == "" {
		return fmt.Errorf("redis address is required (set REDIS_URL in prod)")
	}
	if c.Mode == "prod" && c.Internal.APIURL == "" {
		return fmt.Errorf("api-url is required in prod (set PLEXUS_API_URL)")
	}
	if c.Mode == "prod" && c.Internal.Secret == "" {
		return fmt.Errorf("internal-secret is required in prod (set PLEXUS_INTERNAL_SECRET)")
	}
	if c.Consumer.PollBlock <= 0 {
		return fmt.Errorf("consumer poll block must be positive")
	}
	if c.Notifier.FlushInterval <= 0 {
		return fmt.Errorf("notifier flush interval must be positive")
	}
	if c.Distribution.Alpha <= 0 || c.Distribution.Alpha >= 1 {
		return fmt.Errorf("distribution alpha must be in (0, 1), got %f", c.Distribution.Alpha)
	}
	if c.Alerts.HysteresisSeconds < 0 {
		return fmt.Errorf("default hysteresis must be non-negative")
	}
	if c.Alerts.CooldownSeconds < 0 {
		return fmt.Errorf("default cooldown must be non-negative")
	}
	if c.Alerts.MinSamples < 1 {
		return fmt.Errorf("default min_samples must be positive")
	}
	validLevels := map[string]bool{"debug": true, "info": true, "warn": true, "error": true}
	if !validLevels[c.LogLevel] {
		return fmt.Errorf("log-level must be debug/info/warn/error, got %q", c.LogLevel)
	}
	return nil
}

func (c *AlertServiceConfig) IsDevMode() bool {
	return c.Mode == "dev"
}
