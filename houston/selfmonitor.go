package main

// Self-telemetry — the alert service dogfoods Plexus.
//
// Every interval, POST the service's own health to the gateway as ordinary
// device telemetry (source "plexus-alert-service" in our internal ops org):
//
//   heartbeat            1 on every tick — an OFFLINE monitor on this source
//                        (evaluated by the Next.js offline loop, a different
//                        process) fires when the service dies or wedges. The
//                        watchdog never judges itself.
//   circuit_open         0/1 — threshold monitor catches sustained Redis
//                        degradation (the July 2026 flapping incident).
//   consumers_active     org consumers running.
//   notifier_queue_depth pending transitions not yet flushed to Next.js.
//
// Disabled unless PLEXUS_SELF_API_KEY is set. Failures are throttled to one
// warn per outage — self-monitoring must never crash or spam the service.

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"time"
)

type SelfMonitorConfig struct {
	// Gateway ingest endpoint. Prod default is the 6PN-internal gateway.
	IngestURL string

	// plx_ API key for the ops org. Empty disables self-monitoring.
	APIKey string

	// Source slug the metrics land under.
	SourceID string

	// Tick interval.
	Interval time.Duration
}

func runSelfMonitor(
	ctx context.Context,
	cfg SelfMonitorConfig,
	rc *RedisClient,
	cm *ConsumerManager,
	tn *TransitionNotifier,
) {
	client := &http.Client{Timeout: 10 * time.Second}
	ticker := time.NewTicker(cfg.Interval)
	defer ticker.Stop()

	slog.Info("self-monitor started", "source", cfg.SourceID, "url", cfg.IngestURL)

	inFailure := false
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}

		circuitOpen := 0.0
		if !rc.Healthy() {
			circuitOpen = 1.0
		}
		_, _, queueDepth := tn.Health()
		now := time.Now().UnixMilli()

		type point struct {
			Class     string  `json:"class"`
			Metric    string  `json:"metric"`
			Value     float64 `json:"value"`
			Timestamp int64   `json:"timestamp"`
		}
		body, err := json.Marshal(map[string]any{
			"source_id": cfg.SourceID,
			"points": []point{
				{"metric", "heartbeat", 1, now},
				{"metric", "circuit_open", circuitOpen, now},
				{"metric", "consumers_active", float64(cm.ActiveCount()), now},
				{"metric", "notifier_queue_depth", float64(queueDepth), now},
			},
		})
		if err != nil {
			continue
		}

		req, err := http.NewRequestWithContext(ctx, "POST", cfg.IngestURL, bytes.NewReader(body))
		if err != nil {
			continue
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("x-api-key", cfg.APIKey)

		resp, err := client.Do(req)
		if err != nil {
			if !inFailure {
				inFailure = true
				slog.Warn("self-monitor ingest failed", "err", err)
			}
			continue
		}
		io.Copy(io.Discard, io.LimitReader(resp.Body, 1024))
		resp.Body.Close()

		if resp.StatusCode >= 300 {
			if !inFailure {
				inFailure = true
				slog.Warn("self-monitor ingest non-2xx", "status", resp.StatusCode)
			}
			continue
		}
		if inFailure {
			inFailure = false
			slog.Info("self-monitor ingest recovered")
		}
	}
}
