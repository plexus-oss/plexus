package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Readiness thresholds — beyond these, /readyz returns 503.
const (
	readyMaxSinkIdle   = 5 * time.Minute  // sink with no successful flush this long
	readyMaxRulesAge   = 15 * time.Minute // rules snapshot this stale
	readyMaxQueueDepth = 10_000           // pending batch size
)

// bootstrapState tracks where the rule set came from at startup.
type bootstrapState struct {
	mu     sync.RWMutex
	source string // "api" | "cache" | "none"
}

func (b *bootstrapState) set(s string) {
	b.mu.Lock()
	b.source = s
	b.mu.Unlock()
}

func (b *bootstrapState) get() string {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.source
}

func main() {
	_ = godotenv.Load()

	cfg, err := LoadConfig()
	if err != nil {
		slog.Error("config error", "err", err)
		os.Exit(2)
	}

	configureLogger(cfg.LogLevel)

	slog.Info("starting alert service",
		"addr", cfg.Addr,
		"redis", cfg.Redis.Addr,
		"mode", cfg.Mode,
		"consumer_group", cfg.Consumer.ConsumerGroup,
	)

	// Redis
	rc, err := NewRedisClient(cfg.Redis)
	if err != nil {
		slog.Error("redis connect failed", "err", err)
		os.Exit(1)
	}
	defer rc.Close()
	slog.Info("redis connected", "addr", cfg.Redis.Addr)

	// Metrics
	var metrics *Metrics
	if cfg.MetricsAddr != "" {
		metrics = NewMetrics()
	}

	// Notifier
	notifier := NewTransitionNotifier(cfg.Notifier, cfg.Internal.APIURL, cfg.Internal.Secret, metrics)

	states := NewAlertStateManager(cfg.Alerts, metrics, notifier)

	// Rule store — onChange triggers consumer reconciliation and closes
	// out alert instances whose rule vanished from the pushed set (a
	// deleted rule would otherwise leave its open alert stranded forever:
	// nothing evaluates it again, so cooldown-expiry cleanup never runs).
	var consumerMgr *ConsumerManager
	var rules *RuleStore
	rules = NewRuleStore(func(orgID string) {
		if consumerMgr != nil {
			consumerMgr.Reconcile(orgID)
		}
		live := make(map[string]struct{})
		for _, r := range rules.RulesForOrg(orgID) {
			live[r.ID] = struct{}{}
		}
		states.ReconcileRules(orgID, live)
	})
	rules.SetCachePath(cfg.RulesCachePath)
	rules.SetMetrics(metrics)

	// Consumer manager
	consumerMgr = NewConsumerManager(rc, rules, states, metrics, cfg.Consumer,
		cfg.Distribution.Alpha, cfg.Alerts)

	// Bootstrap rules: prefer Next.js, fall back to on-disk cache, then
	// fail-fast if neither works. Running with an empty rule set would
	// silently under-alert — worse than crashing.
	bootstrap := &bootstrapState{source: "none"}
	if cfg.Internal.APIURL != "" {
		bootCtx, bootCancel := context.WithTimeout(context.Background(), 90*time.Second)
		snapshot, err := fetchRulesWithRetry(bootCtx, cfg.Internal.APIURL, cfg.Internal.Secret)
		bootCancel()
		if err != nil {
			slog.Error("rules bootstrap from api failed", "err", err)
			cached, savedAt, cerr := LoadRulesCache(cfg.RulesCachePath)
			if cerr != nil {
				slog.Error("rules cache load failed", "path", cfg.RulesCachePath, "err", cerr)
			}
			if cached != nil {
				rules.ReplaceAll(cached)
				bootstrap.set("cache")
				totalRules := 0
				for _, orgRules := range cached {
					totalRules += len(orgRules)
				}
				slog.Warn("rules bootstrapped from cache",
					"path", cfg.RulesCachePath,
					"saved_at", savedAt,
					"orgs", len(cached),
					"rules", totalRules)
			} else {
				slog.Error("no rules cache available, refusing to start empty",
					"path", cfg.RulesCachePath)
				os.Exit(1)
			}
		} else {
			rules.ReplaceAll(snapshot)
			bootstrap.set("api")
			totalRules := 0
			for _, orgRules := range snapshot {
				totalRules += len(orgRules)
			}
			slog.Info("rules bootstrapped", "orgs", len(snapshot), "rules", totalRules)
		}
	} else {
		// Dev mode with no upstream configured: allow empty-start so local
		// iteration still works. Prod requires APIURL via Validate().
		slog.Info("no api url configured, starting with empty rule set")
		bootstrap.set("api")
	}

	// Start consumers for all orgs with rules
	consumerMgr.ReconcileAll()

	// Start background workers
	notifier.Start()

	// HTTP routes
	mux := http.NewServeMux()

	mux.HandleFunc("POST /internal/rules/{orgID}", func(w http.ResponseWriter, r *http.Request) {
		rules.ServeHTTP(w, r, cfg.Internal.Secret)
	})

	// /livez: cheap liveness — the process is up and the HTTP server is
	// serving. Used by Fly for restart decisions. Should almost never fail.
	livez := func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"status": "ok"})
	}
	mux.HandleFunc("GET /livez", livez)

	// /readyz: deep readiness — every subsystem that could silently fail
	// must contribute a signal here. Returns 503 if any check fails so
	// external probes can alert before the service is useless.
	readyz := func(w http.ResponseWriter, r *http.Request) {
		now := time.Now()
		checks := map[string]any{}
		healthy := true
		failReason := ""

		// Redis
		redisCtx, cancel := context.WithTimeout(r.Context(), cfg.Redis.PingTimeout)
		redisErr := rc.Ping(redisCtx)
		cancel()
		if redisErr != nil {
			checks["redis"] = "unreachable"
			healthy = false
			failReason = "redis"
		} else {
			checks["redis"] = "connected"
		}

		// Bootstrap state
		bootSrc := bootstrap.get()
		checks["bootstrap"] = bootSrc
		if bootSrc == "none" {
			healthy = false
			if failReason == "" {
				failReason = "bootstrap"
			}
		}

		// Rules snapshot age
		rulesAge := now.Sub(rules.LastUpdated())
		checks["rules_age_seconds"] = int(rulesAge.Seconds())
		if !rules.LastUpdated().IsZero() && rulesAge > readyMaxRulesAge {
			healthy = false
			if failReason == "" {
				failReason = "rules_stale"
			}
		}

		// Notifier sink
		nSuccess, nFailure, nDepth := notifier.Health()
		notifierIdle := now.Sub(nSuccess)
		checks["notifier"] = map[string]any{
			"last_success_seconds": int(notifierIdle.Seconds()),
			"last_failure":         nFailure,
			"queue_depth":          nDepth,
		}
		if notifierIdle > readyMaxSinkIdle && nDepth > 0 {
			healthy = false
			if failReason == "" {
				failReason = "notifier_stuck"
			}
		}
		if nDepth > readyMaxQueueDepth {
			healthy = false
			if failReason == "" {
				failReason = "notifier_backlog"
			}
		}

		// Counters (informational)
		checks["consumers"] = consumerMgr.ActiveCount()
		checks["alerts_open"] = states.OpenAlerts()

		w.Header().Set("Content-Type", "application/json")
		resp := map[string]any{"checks": checks}
		if healthy {
			resp["status"] = "ready"
		} else {
			resp["status"] = "not_ready"
			resp["reason"] = failReason
			w.WriteHeader(http.StatusServiceUnavailable)
		}
		json.NewEncoder(w).Encode(resp)
	}
	mux.HandleFunc("GET /readyz", readyz)
	// /health retained for backward compatibility with existing probes.
	mux.HandleFunc("GET /health", readyz)

	// /stats: live alert stats for an in-flight alert (threshold/outlier only).
	// Returns the current breach profile while the alert is open or recovering.
	mux.HandleFunc("GET /stats", func(w http.ResponseWriter, r *http.Request) {
		if cfg.Internal.Secret != "" {
			if subtle.ConstantTimeCompare(
				[]byte(r.Header.Get("x-internal-secret")),
				[]byte(cfg.Internal.Secret),
			) != 1 {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
		}
		ruleID := r.URL.Query().Get("rule")
		sourceID := r.URL.Query().Get("source")
		if ruleID == "" || sourceID == "" {
			http.Error(w, "rule and source query params required", http.StatusBadRequest)
			return
		}
		inst, ok := states.GetInstance(ruleID, sourceID)
		if !ok || (inst.State != StateOpen && inst.State != StateClosing) {
			http.NotFound(w, r)
			return
		}
		live := LiveStats{
			OpenedAt:       inst.OpenedAt.Unix(),
			TriggerValue:   inst.TriggerValue,
			PeakValue:      inst.PeakValue,
			PeakZScore:     inst.PeakZScore,
			RetriggerCount: inst.RetriggerCount,
			DataPointCount: inst.DataPointCount,
			CurrentDist:    inst.LastDist,
		}
		if inst.State == StateOpen {
			live.State = "breaching"
		} else {
			live.State = "recovering"
			hystSeconds := cfg.Alerts.HysteresisSeconds
			for _, rule := range rules.RulesForOrg(inst.OrgID) {
				if rule.ID == ruleID && rule.HysteresisSeconds > 0 {
					hystSeconds = rule.HysteresisSeconds
					break
				}
			}
			if hystSeconds > 0 {
				progress := min(time.Since(inst.ClosingStart).Seconds()/float64(hystSeconds), 1.0)
				live.HysteresisProgress = &progress
			}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(live)
	})

	// HTTP server
	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	// Metrics server
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

	go rc.RunProbe(ctx)

	// Dogfood: stream our own health into Plexus (see selfmonitor.go).
	if cfg.SelfMonitor.APIKey != "" {
		go runSelfMonitor(ctx, cfg.SelfMonitor, rc, consumerMgr, notifier)
	}

	go func() {
		<-ctx.Done()
		slog.Info("shutting down...")
		shutCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		consumerMgr.StopAll()
		notifier.Stop()
		srv.Shutdown(shutCtx)
		if metricsSrv != nil {
			metricsSrv.Shutdown(shutCtx)
		}
	}()

	slog.Info("listening", "addr", cfg.Addr)
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		slog.Error("server error", "err", err)
		os.Exit(1)
	}
	slog.Info("shutdown complete")
}

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
