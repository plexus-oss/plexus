package main

// Alert rule store + push/bootstrap machinery.
//
// Rules are the richer alert-service format: threshold, outlier, and
// compound (cross-metric, same device). Pushed from Next.js as full
// per-org snapshots (no deltas). Bootstrapped at startup via HTTP GET.
//
// No updates — delete + create only. Push replaces entire org's rule set.

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// =========================================================================
// Rule types
// =========================================================================

type RuleType string

const (
	RuleThreshold RuleType = "threshold"
	RuleOutlier   RuleType = "outlier"
	RuleCompound  RuleType = "compound"
)

// AlertRule is a single alert rule. For compound rules, SubRules contains
// the child rules and Metric is empty. For threshold/outlier, SubRules
// is empty and Metric identifies the target.
type AlertRule struct {
	ID                string         `json:"id"`
	OrgID             string         `json:"org_id"`
	SourceID          string         `json:"source_id"` // slug, not UUID
	Type              RuleType       `json:"type"`
	Metric            string         `json:"metric,omitempty"`
	Conditions        RuleConditions `json:"conditions,omitempty"`
	Operator          string         `json:"operator,omitempty"` // "and"|"or" for compound
	SubRules          []SubRule      `json:"rules,omitempty"`    // for compound
	HysteresisSeconds int            `json:"hysteresis_seconds,omitempty"`
	CooldownSeconds   int            `json:"cooldown_seconds,omitempty"`
	Severity          string         `json:"severity"`
}

// SubRule is a child rule within a compound rule. It has its own type,
// metric, and conditions but inherits lifecycle config from the parent.
type SubRule struct {
	Type       RuleType       `json:"type"`
	Metric     string         `json:"metric"`
	Conditions RuleConditions `json:"conditions,omitempty"`
}

type RuleConditions struct {
	Min        *float64 `json:"min,omitempty"`
	Max        *float64 `json:"max,omitempty"`
	ZScore     *float64 `json:"z_score,omitempty"`
	MinSamples *int     `json:"min_samples,omitempty"`
}

const maxSubRules = 20

func validateRule(r *AlertRule) error {
	if r.ID == "" {
		return fmt.Errorf("id is required")
	}
	if r.SourceID == "" {
		return fmt.Errorf("source_id is required")
	}
	switch r.Type {
	case RuleThreshold:
		if r.Metric == "" {
			return fmt.Errorf("metric is required for threshold rules")
		}
	case RuleOutlier:
		if r.Metric == "" {
			return fmt.Errorf("metric is required for outlier rules")
		}
		if r.Conditions.ZScore != nil && *r.Conditions.ZScore <= 0 {
			return fmt.Errorf("z_score must be positive")
		}
		if r.Conditions.MinSamples != nil && *r.Conditions.MinSamples < 1 {
			return fmt.Errorf("min_samples must be positive")
		}
	case RuleCompound:
		if len(r.SubRules) == 0 {
			return fmt.Errorf("compound rules must have at least one sub-rule")
		}
		if len(r.SubRules) > maxSubRules {
			return fmt.Errorf("compound rules limited to %d sub-rules", maxSubRules)
		}
		if r.Operator != "and" && r.Operator != "or" {
			return fmt.Errorf("operator must be 'and' or 'or'")
		}
		for i, sub := range r.SubRules {
			if sub.Metric == "" {
				return fmt.Errorf("sub-rule %d: metric is required", i)
			}
			if sub.Type != RuleThreshold && sub.Type != RuleOutlier {
				return fmt.Errorf("sub-rule %d: type must be 'threshold' or 'outlier'", i)
			}
		}
	default:
		return fmt.Errorf("unknown rule type %q", r.Type)
	}
	if r.HysteresisSeconds < 0 {
		return fmt.Errorf("hysteresis_seconds must be non-negative")
	}
	if r.CooldownSeconds < 0 {
		return fmt.Errorf("cooldown_seconds must be non-negative")
	}
	return nil
}

// =========================================================================
// RuleStore
// =========================================================================

// RuleStore is a thread-safe in-memory store of alert rules, keyed by org.
// The ConsumerManager watches for changes to start/stop per-org consumers.
type RuleStore struct {
	mu          sync.RWMutex
	byOrg       map[string][]AlertRule
	lastUpdated time.Time

	// cachePath, if non-empty, is where the last-known snapshot is
	// persisted after every successful update for bootstrap fallback.
	cachePath string

	// metrics, if non-nil, receives the alertd_rules_active gauge after
	// every ReplaceOrg/ReplaceAll. Nil-safe via the Metrics methods.
	metrics *Metrics

	// onChange is called (outside the lock) whenever an org's rules change.
	// The ConsumerManager uses this to reconcile consumers.
	onChange func(orgID string)
}

func NewRuleStore(onChange func(orgID string)) *RuleStore {
	return &RuleStore{
		byOrg:    make(map[string][]AlertRule),
		onChange: onChange,
	}
}

// SetCachePath enables on-disk persistence of the snapshot. Call once
// at startup, before bootstrap.
func (s *RuleStore) SetCachePath(path string) {
	s.mu.Lock()
	s.cachePath = path
	s.mu.Unlock()
}

// SetMetrics wires the Prometheus gauge updates. Call once at startup,
// before bootstrap.
func (s *RuleStore) SetMetrics(m *Metrics) {
	s.mu.Lock()
	s.metrics = m
	s.mu.Unlock()
}

// LastUpdated returns the wall time of the most recent successful
// ReplaceAll / ReplaceOrg. Zero if never updated.
func (s *RuleStore) LastUpdated() time.Time {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.lastUpdated
}

// RulesForOrg returns a copy of the rules for an org. Returns nil if none.
func (s *RuleStore) RulesForOrg(orgID string) []AlertRule {
	s.mu.RLock()
	defer s.mu.RUnlock()
	rules := s.byOrg[orgID]
	if len(rules) == 0 {
		return nil
	}
	out := make([]AlertRule, len(rules))
	copy(out, rules)
	return out
}

// RulesForOrgSource returns rules matching a specific (org, source) pair.
func (s *RuleStore) RulesForOrgSource(orgID, sourceID string) []AlertRule {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []AlertRule
	for _, r := range s.byOrg[orgID] {
		if r.SourceID == sourceID {
			out = append(out, r)
		}
	}
	return out
}

// OrgsWithRules returns all org IDs that have at least one rule.
func (s *RuleStore) OrgsWithRules() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	orgs := make([]string, 0, len(s.byOrg))
	for orgID, rules := range s.byOrg {
		if len(rules) > 0 {
			orgs = append(orgs, orgID)
		}
	}
	return orgs
}

// ReplaceOrg atomically swaps an org's entire rule set. Empty slice
// clears the org's rules. Calls onChange after the swap.
func (s *RuleStore) ReplaceOrg(orgID string, rules []AlertRule) {
	s.mu.Lock()
	if len(rules) == 0 {
		delete(s.byOrg, orgID)
	} else {
		s.byOrg[orgID] = rules
	}
	s.lastUpdated = time.Now()
	cachePath := s.cachePath
	metrics := s.metrics
	snap := s.snapshotLocked()
	s.mu.Unlock()

	metrics.SetRulesActive(float64(countRules(snap)))
	s.writeCache(cachePath, snap)

	if s.onChange != nil {
		s.onChange(orgID)
	}
}

// ReplaceAll atomically swaps the entire store. Used by bootstrap.
func (s *RuleStore) ReplaceAll(snapshot map[string][]AlertRule) {
	newByOrg := make(map[string][]AlertRule, len(snapshot))
	for orgID, rules := range snapshot {
		if len(rules) > 0 {
			newByOrg[orgID] = rules
		}
	}

	s.mu.Lock()
	s.byOrg = newByOrg
	s.lastUpdated = time.Now()
	cachePath := s.cachePath
	metrics := s.metrics
	snap := s.snapshotLocked()
	s.mu.Unlock()

	metrics.SetRulesActive(float64(countRules(snap)))
	s.writeCache(cachePath, snap)
}

// countRules totals the rules across all orgs in a snapshot.
func countRules(snap map[string][]AlertRule) int {
	total := 0
	for _, rules := range snap {
		total += len(rules)
	}
	return total
}

// snapshotLocked returns a deep-ish copy of byOrg; caller must hold the
// lock. Used for cache persistence so writeCache can run lock-free.
func (s *RuleStore) snapshotLocked() map[string][]AlertRule {
	out := make(map[string][]AlertRule, len(s.byOrg))
	for k, v := range s.byOrg {
		cp := make([]AlertRule, len(v))
		copy(cp, v)
		out[k] = cp
	}
	return out
}

// writeCache atomically writes the snapshot to disk. Best-effort: cache
// errors are logged but do not fail the update.
func (s *RuleStore) writeCache(path string, snap map[string][]AlertRule) {
	if path == "" {
		return
	}
	payload := cachePayload{
		SavedAt: time.Now().UTC().Format(time.RFC3339),
		Orgs:    snap,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		slog.Error("rules cache marshal", "err", err)
		return
	}

	dir := filepath.Dir(path)
	if dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			slog.Error("rules cache mkdir", "path", dir, "err", err)
			return
		}
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, body, 0o600); err != nil {
		slog.Error("rules cache write tmp", "err", err)
		return
	}
	if err := os.Rename(tmp, path); err != nil {
		slog.Error("rules cache rename", "err", err)
		return
	}
}

type cachePayload struct {
	SavedAt string                   `json:"saved_at"`
	Orgs    map[string][]AlertRule   `json:"orgs"`
}

// LoadRulesCache reads a previously-persisted snapshot from disk.
// Returns (nil, nil) if the cache file does not exist.
func LoadRulesCache(path string) (map[string][]AlertRule, time.Time, error) {
	if path == "" {
		return nil, time.Time{}, nil
	}
	body, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, time.Time{}, nil
		}
		return nil, time.Time{}, fmt.Errorf("read cache: %w", err)
	}
	var payload cachePayload
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, time.Time{}, fmt.Errorf("decode cache: %w", err)
	}
	savedAt, _ := time.Parse(time.RFC3339, payload.SavedAt)
	return payload.Orgs, savedAt, nil
}

// =========================================================================
// HTTP handler — POST /internal/rules/{orgID}
// =========================================================================

type rulesPushPayload struct {
	Rules []AlertRule `json:"rules"`
}

func (s *RuleStore) ServeHTTP(w http.ResponseWriter, r *http.Request, internalSecret string) {
	if internalSecret != "" {
		provided := r.Header.Get("x-internal-secret")
		if subtle.ConstantTimeCompare([]byte(provided), []byte(internalSecret)) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
	}

	orgID := r.PathValue("orgID")
	if orgID == "" {
		http.Error(w, "orgID required", http.StatusBadRequest)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 4*1024*1024) // 4 MB cap
	defer r.Body.Close()

	var payload rulesPushPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			http.Error(w, "payload too large", http.StatusRequestEntityTooLarge)
			return
		}
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	for i := range payload.Rules {
		if err := validateRule(&payload.Rules[i]); err != nil {
			http.Error(w, fmt.Sprintf("invalid rule at index %d: %s", i, err), http.StatusBadRequest)
			return
		}
	}

	s.ReplaceOrg(orgID, payload.Rules)
	slog.Info("rules updated", "org", orgID, "count", len(payload.Rules))
	w.WriteHeader(http.StatusNoContent)
}

// =========================================================================
// Bootstrap — GET {apiURL}/api/internal/alerts/rules/all
// =========================================================================

type bootstrapResponse struct {
	Orgs map[string]struct {
		Rules []AlertRule `json:"rules"`
	} `json:"orgs"`
}

func FetchAllRulesFromAPI(ctx context.Context, apiURL, internalSecret string) (map[string][]AlertRule, error) {
	url := apiURL + "/api/internal/alerts/rules/all"
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

	var parsed bootstrapResponse
	// Cap response at 16 MB to prevent memory exhaustion from a
	// compromised or buggy API server.
	if err := json.NewDecoder(io.LimitReader(resp.Body, 16*1024*1024)).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("decode: %w", err)
	}

	snapshot := make(map[string][]AlertRule, len(parsed.Orgs))
	for orgID, group := range parsed.Orgs {
		snapshot[orgID] = group.Rules
	}
	return snapshot, nil
}

func fetchRulesWithRetry(ctx context.Context, apiURL, internalSecret string) (map[string][]AlertRule, error) {
	delays := []time.Duration{
		1 * time.Second,
		2 * time.Second,
		4 * time.Second,
		8 * time.Second,
		16 * time.Second,
	}

	var lastErr error
	for attempt := 0; attempt <= len(delays); attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return nil, fmt.Errorf("context cancelled during retry: %w", ctx.Err())
			case <-time.After(delays[attempt-1]):
			}
		}

		snapshot, err := FetchAllRulesFromAPI(ctx, apiURL, internalSecret)
		if err == nil {
			return snapshot, nil
		}
		lastErr = err
		slog.Warn("rules bootstrap attempt failed", "attempt", attempt+1, "err", err)
	}

	return nil, fmt.Errorf("all retry attempts failed: %w", lastErr)
}
