package main

// Active-alert reconciliation — the safety net for memory-only alert state.
//
// Alert instances live only in the AlertStateManager's map, so a restart
// (deploy, crash, host migration) forgets every open alert. The frontend's
// alerts rows stay is_alert_active=true forever: no instance means no
// "closed" transition, and the unique active-alert index then rejects the
// next "open" for the same (rule, source) — silent permanent under-alerting.
// A close batch dropped after the notifier's retries wedges a row the same
// way.
//
// Every reconcileInterval this fetches the frontend's list of active
// rule-based alerts (GET /api/internal/alerts/active, CONTRACT.md §5) and
// emits synthetic "closed" transitions (reason=reconciled) for rows with no
// live instance. Conditions that are genuinely still firing re-open on
// their next evaluation.
//
// The first run waits reconcileInitialDelay so post-restart evaluations can
// re-adopt still-firing alerts (their "open" hits the unique index and is
// skipped, leaving the existing row attached to the new instance) before we
// judge anything stranded.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"
)

const (
	reconcileInitialDelay = 5 * time.Minute
	reconcileInterval     = 5 * time.Minute
)

type activeAlertsResponse struct {
	Alerts []ActiveAlert `json:"alerts"`
}

// FetchActiveAlertsFromAPI fetches the frontend's active rule-based alerts.
// Mirrors FetchAllRulesFromAPI's transport conventions.
func FetchActiveAlertsFromAPI(ctx context.Context, apiURL, internalSecret string) ([]ActiveAlert, error) {
	url := apiURL + "/api/internal/alerts/active"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("x-internal-secret", internalSecret)
	req.Header.Set("accept", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(body))
	}

	var parsed activeAlertsResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 16*1024*1024)).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("decode: %w", err)
	}
	return parsed.Alerts, nil
}

// runReconcileLoop periodically reconciles DB-active alerts against live
// instances. A failed fetch is logged and retried next tick — reconciliation
// is a repair mechanism, not a hot path.
func runReconcileLoop(ctx context.Context, apiURL, internalSecret string, states *AlertStateManager) {
	select {
	case <-ctx.Done():
		return
	case <-time.After(reconcileInitialDelay):
	}

	tick := func() {
		fetchCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		active, err := FetchActiveAlertsFromAPI(fetchCtx, apiURL, internalSecret)
		cancel()
		if err != nil {
			slog.Warn("active-alert reconcile fetch failed", "err", err)
			return
		}
		if closed := states.ReconcileActiveAlerts(active); closed > 0 {
			slog.Info("active-alert reconcile", "active_rows", len(active), "closed", closed)
		}
	}

	tick()
	ticker := time.NewTicker(reconcileInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			tick()
		}
	}
}
