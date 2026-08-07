package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

func main() {
	// Load .env if present. Silently no-ops in prod where env vars are set
	// by the platform (Fly secrets) and no .env file exists.
	_ = godotenv.Load()

	cfg, err := LoadGatewayConfig()
	if err != nil {
		slog.Error("config error", "err", err)
		os.Exit(2)
	}

	configureLogger(cfg.LogLevel)

	slog.Info("starting gateway",
		"addr", cfg.Addr,
		"redis", cfg.Redis.Addr,
		"auth", cfg.AuthMode,
		"org", cfg.Defaults.DevOrg,
		"flush_interval", cfg.Downsample.FlushInterval,
	)

	// Redis
	rc, redisErr := NewRedisClient(cfg.Redis)
	if redisErr != nil {
		slog.Error("redis connect failed", "err", redisErr)
		os.Exit(1)
	}
	defer rc.Close()
	slog.Info("redis connected", "addr", cfg.Redis.Addr)

	// Components
	var metrics *Metrics
	if cfg.MetricsAddr != "" {
		metrics = NewMetrics()
	}
	auth := NewAuthClient(cfg.Auth, cfg.IsDevMode(), cfg.Defaults.DevOrg)
	auth.SetMetrics(metrics)
	validator := NewValidator(cfg.Limits)

	hub := NewHub(cfg, rc, auth, validator, metrics)

	// Routes
	mux := http.NewServeMux()

	mux.HandleFunc("GET /ws/device", func(w http.ResponseWriter, r *http.Request) {
		serveDevice(w, r, hub)
	})

	mux.HandleFunc("GET /ws/browser", func(w http.ResponseWriter, r *http.Request) {
		serveBrowser(w, r, hub)
	})

	mux.HandleFunc("POST /ingest", func(w http.ResponseWriter, r *http.Request) {
		serveIngest(w, r, hub)
	})
	mux.HandleFunc("OPTIONS /ingest", serveIngestOptions)

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		// /health is public (gateway.plexus.company/health). Only trusted
		// internal callers presenting x-internal-secret receive per-connection
		// detail (device_list / orgs); everyone else gets aggregate counts, so
		// we never leak source_id / org / platform on the unauthenticated edge.
		var status map[string]any
		if secret := cfg.Auth.InternalSecret; secret != "" && r.Header.Get("x-internal-secret") == secret {
			status = hub.Status()
		} else {
			status = hub.HealthSummary()
		}
		w.Header().Set("Content-Type", "application/json")
		if s, _ := status["status"].(string); s != "ok" {
			w.WriteHeader(http.StatusServiceUnavailable)
		}
		_ = json.NewEncoder(w).Encode(status)
	})

	// Internal command relay — server-to-server only, not exposed to devices or browsers.
	// Protected by x-internal-secret so only trusted services (data_api, etc.) can call it.
	mux.HandleFunc("POST /internal/command", func(w http.ResponseWriter, r *http.Request) {
		if secret := cfg.Auth.InternalSecret; secret != "" {
			if r.Header.Get("x-internal-secret") != secret {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
		}

		var body struct {
			OrgID    string         `json:"org_id"`
			SourceID string         `json:"source_id"`
			Command  string         `json:"command"`
			Params   map[string]any `json:"params"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		if body.OrgID == "" || body.SourceID == "" || body.Command == "" {
			http.Error(w, "org_id, source_id, command required", http.StatusBadRequest)
			return
		}
		if body.Params == nil {
			body.Params = map[string]any{}
		}

		queued := sendTypedCommand(hub, body.OrgID, body.SourceID, body.Command, body.Params)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"queued": queued})
	})

	// Server
	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	// Metrics server (separate port, private network only by convention)
	var metricsSrv *http.Server
	if metrics != nil {
		metricsMux := http.NewServeMux()
		metricsMux.Handle("GET /metrics", promhttp.HandlerFor(metrics.Registry(), promhttp.HandlerOpts{}))
		metricsSrv = &http.Server{
			Addr:              cfg.MetricsAddr,
			Handler:           metricsMux,
			ReadHeaderTimeout: 5 * time.Second,
		}
		go func() {
			slog.Info("metrics listening", "addr", cfg.MetricsAddr)
			if err := metricsSrv.ListenAndServe(); err != http.ErrServerClosed {
				slog.Error("metrics server error", "err", err)
			}
		}()
	}

	// Graceful shutdown
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	// Background Redis circuit breaker probe.
	go rc.RunProbe(ctx)

	// Periodic video session billing sweep.
	go hub.StartVideoSessionSweep(ctx)

	// Metric schema announcer — tees discovered (org, source, metric)
	// tuples to the Next.js app so live-only (recording=false) sources
	// still surface their metrics in the UI. No-op when the gateway isn't
	// configured with an API URL + internal secret.
	hub.Announcer().Start(ctx)
	defer hub.Announcer().Stop()
	if hub.Announcer().Enabled() {
		slog.Info("metric announcer started", "api_url", cfg.Auth.APIURL)
	}

	go func() {
		<-ctx.Done()
		slog.Info("shutting down...")
		shutCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		// Order matters:
		//   1. Stop org readers first so no new flushes are queued onto
		//      browser channels mid-shutdown.
		//   2. Then srv.Shutdown closes listening sockets and waits for
		//      WebSocket handler goroutines to drain. Without (1), flushes
		//      could land on connections that are about to close.
		//   3. Metrics server can shut down in parallel — it's independent.
		hub.StopAllReaders()
		_ = srv.Shutdown(shutCtx)
		if metricsSrv != nil {
			_ = metricsSrv.Shutdown(shutCtx)
		}
	}()

	slog.Info("listening", "addr", cfg.Addr)
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		slog.Error("server error", "err", err)
		os.Exit(1)
	}
	slog.Info("shutdown complete")
}

// configureLogger sets slog's default logger level from the config.
func configureLogger(level string) {
	var slogLevel slog.Level
	switch level {
	case "debug":
		slogLevel = slog.LevelDebug
	case "info":
		slogLevel = slog.LevelInfo
	case "warn":
		slogLevel = slog.LevelWarn
	case "error":
		slogLevel = slog.LevelError
	default:
		slogLevel = slog.LevelInfo
	}
	handler := slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slogLevel})
	slog.SetDefault(slog.New(handler))
}
