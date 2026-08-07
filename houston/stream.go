package main

// Per-org stream consumer + ConsumerManager.
//
// Each org with alert rules gets an OrgConsumer — a single goroutine
// that reads from Redis via XREADGROUP, parses v:2 envelopes, updates
// distributions, evaluates rules, and feeds results into the state
// machine. The ConsumerManager starts/stops consumers as rules change.

import (
	"context"
	"encoding/json"
	"log/slog"
	"math"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/klauspost/compress/zstd"
	"github.com/redis/go-redis/v9"
)

var zstdDec, _ = zstd.NewReader(nil)

// =========================================================================
// Stream message types (copied from gateway/downsample.go)
// =========================================================================

type streamMsg struct {
	Type     string        `json:"type"`
	V        int           `json:"v"`
	TraceID  string        `json:"trace_id"`
	OrgID    string        `json:"org_id"`
	SourceID string        `json:"source_id"`
	Points   []streamPoint `json:"points"`
}

type streamPoint struct {
	Class     string          `json:"class"`
	Metric    string          `json:"metric"`
	Value     json.RawMessage `json:"value,omitempty"`
	Timestamp json.RawMessage `json:"timestamp,omitempty"`
	Tags      json.RawMessage `json:"tags,omitempty"`
}

// =========================================================================
// Value parsing (adapted from gateway/rules.go)
// =========================================================================

func parseMetricValue(raw json.RawMessage) (float64, bool) {
	if len(raw) == 0 {
		return 0, false
	}
	trimmed := bytesTrimSpace(raw)
	if len(trimmed) == 4 && trimmed[0] == 'n' && trimmed[1] == 'u' && trimmed[2] == 'l' && trimmed[3] == 'l' {
		return 0, false
	}
	var n float64
	if err := json.Unmarshal(raw, &n); err == nil {
		if math.IsNaN(n) || math.IsInf(n, 0) {
			return 0, false
		}
		return n, true
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		if f, err := strconv.ParseFloat(s, 64); err == nil {
			if math.IsNaN(f) || math.IsInf(f, 0) {
				return 0, false
			}
			return f, true
		}
	}
	return 0, false
}

func bytesTrimSpace(b []byte) []byte {
	start, end := 0, len(b)
	for start < end && isSpace(b[start]) {
		start++
	}
	for end > start && isSpace(b[end-1]) {
		end--
	}
	return b[start:end]
}

func isSpace(c byte) bool {
	return c == ' ' || c == '\t' || c == '\n' || c == '\r'
}

// =========================================================================
// OrgConsumer — single goroutine per org
// =========================================================================

// autoClaim tuning: how often to sweep the PEL and what counts as "stuck".
const (
	autoClaimMinIdle  = 60 * time.Second
	autoClaimInterval = 30 * time.Second
	autoClaimCount    = 100
)

type OrgConsumer struct {
	orgID   string
	redis   *RedisClient
	rules   *RuleStore
	dists   *DistributionTracker
	states  *AlertStateManager
	metrics *Metrics
	cfg     ConsumerConfig
	defaults AlertDefaults

	// latestValues tracks the most recent value per (source, metric)
	// for compound rule evaluation.
	latestValues map[string]map[string]float64

	// lastErrLog throttles poll-error logging to once per interval so a
	// persistent failure is visible at INFO-level deployments without
	// flooding (previously these were Debug and invisible in prod).
	// Only touched by the pollLoop goroutine.
	lastErrLog time.Time

	// lastClaimErrLog is the autoClaimLoop's own throttle stamp. Separate
	// from lastErrLog because the two loops are different goroutines and
	// the fields are unsynchronized.
	lastClaimErrLog time.Time

	stopCh chan struct{}
	wg     sync.WaitGroup
}

const pollErrLogInterval = 30 * time.Second

func (oc *OrgConsumer) logPollError(msg string, err error) {
	if time.Since(oc.lastErrLog) < pollErrLogInterval {
		return
	}
	oc.lastErrLog = time.Now()
	slog.Warn(msg, "org", oc.orgID, "err", err)
}

func isNoGroupErr(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "NOGROUP")
}

func NewOrgConsumer(
	orgID string,
	rc *RedisClient,
	rules *RuleStore,
	states *AlertStateManager,
	metrics *Metrics,
	cfg ConsumerConfig,
	distAlpha float64,
	defaults AlertDefaults,
) *OrgConsumer {
	return &OrgConsumer{
		orgID:        orgID,
		redis:        rc,
		rules:        rules,
		dists:        NewDistributionTracker(distAlpha),
		states:       states,
		metrics:      metrics,
		cfg:          cfg,
		defaults:     defaults,
		latestValues: make(map[string]map[string]float64),
		stopCh:       make(chan struct{}),
	}
}

func (oc *OrgConsumer) Start() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := oc.redis.XGroupCreateMkStream(ctx, oc.orgID, oc.cfg.ConsumerGroup); err != nil {
		slog.Error("consumer create group", "org", oc.orgID, "err", err)
	}

	oc.wg.Add(2)
	go oc.pollLoop()
	go oc.autoClaimLoop()
	slog.Info("consumer started", "org", oc.orgID)
}

func (oc *OrgConsumer) Stop() {
	close(oc.stopCh)
	oc.wg.Wait()
	slog.Info("consumer stopped", "org", oc.orgID)
}

// pollLoop error backoff: starts at the min and doubles per consecutive
// failure up to the max, resetting on any successful read. Without this,
// an open circuit (or any persistent Redis failure) has every consumer
// fast-failing at 10Hz.
const (
	pollErrBackoffMin = 100 * time.Millisecond
	pollErrBackoffMax = 5 * time.Second
)

func (oc *OrgConsumer) pollLoop() {
	defer oc.wg.Done()

	backoff := pollErrBackoffMin
	for {
		select {
		case <-oc.stopCh:
			return
		default:
		}

		block := oc.cfg.PollBlock
		ctx, cancel := context.WithTimeout(context.Background(), block+time.Second)
		streams, err := oc.redis.XReadGroup(ctx, oc.orgID, oc.cfg.ConsumerGroup, oc.cfg.ConsumerName, oc.cfg.PollCount, block)
		cancel()

		if err != nil {
			if err == redis.Nil {
				backoff = pollErrBackoffMin
				continue
			}
			select {
			case <-oc.stopCh:
				return
			default:
			}
			// Stream key or group gone (Redis restart, flushed keyspace, or a
			// group create that failed at Start under an open circuit). Without
			// this, every subsequent poll errors instantly forever — and those
			// errors used to flap the shared circuit for every org.
			if isNoGroupErr(err) {
				cctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				cerr := oc.redis.XGroupCreateMkStream(cctx, oc.orgID, oc.cfg.ConsumerGroup)
				cancel()
				if cerr != nil {
					oc.logPollError("consumer group recreate failed", cerr)
				} else {
					slog.Info("consumer group recreated", "org", oc.orgID)
				}
				time.Sleep(time.Second)
				continue
			}
			oc.logPollError("consumer poll error", err)
			select {
			case <-oc.stopCh:
				return
			case <-time.After(backoff):
			}
			backoff *= 2
			if backoff > pollErrBackoffMax {
				backoff = pollErrBackoffMax
			}
			continue
		}
		backoff = pollErrBackoffMin

		for _, stream := range streams {
			oc.processAndAck(stream.Messages)
		}
	}
}

// processAndAck fully processes a batch of messages and acks the IDs that
// were handled — either evaluated successfully or intentionally dropped as
// poison (unparseable JSON, non-metric points). There is no in-process
// panic recovery: a message that crashes mid-process kills the whole
// service, its batch stays in the PEL, and it is recovered after the
// process restarts via the autoClaimLoop's XAUTOCLAIM sweep. If XAck
// itself fails, the IDs stay in this consumer's PEL — XREADGROUP with ">"
// will NOT redeliver them; the autoClaimLoop reclaims them once they're
// ≥60s idle. Combined with the idempotent state machine, a replay at worst
// re-fires a transition that's already open.
func (oc *OrgConsumer) processAndAck(msgs []redis.XMessage) {
	if len(msgs) == 0 {
		return
	}
	now := time.Now()
	ackIDs := make([]string, 0, len(msgs))

	for _, msg := range msgs {
		if !oc.processMessage(msg, now) {
			// Currently unreachable: every processMessage path returns
			// true (all failures are classed as poison and acked). The
			// false branch is the seam for a future transient-failure
			// class that should stay in the PEL for redelivery.
			continue
		}
		ackIDs = append(ackIDs, msg.ID)
	}

	if len(ackIDs) == 0 {
		return
	}
	ackCtx, ackCancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer ackCancel()
	if err := oc.redis.XAck(ackCtx, oc.orgID, oc.cfg.ConsumerGroup, ackIDs...); err != nil {
		slog.Warn("consumer xack failed", "org", oc.orgID, "count", len(ackIDs), "err", err)
	}
}

// processMessage handles a single stream entry. Returns true if the
// message has been fully handled and may be acked (including intentional
// drops like heartbeats or malformed payloads — those are poison and
// retrying won't help). Note: every current path returns true; the bool
// exists so a future transient-failure class can opt out of the ack.
func (oc *OrgConsumer) processMessage(msg redis.XMessage, now time.Time) bool {
	raw, ok := msg.Values["data"].(string)
	if !ok || raw == "" {
		return true // nothing to process; safe to ack
	}
	decompressed, err := zstdDec.DecodeAll([]byte(raw), nil)
	if err != nil {
		return true // poison message; ack to avoid redelivery storm
	}

	var parsed streamMsg
	if err := json.Unmarshal(decompressed, &parsed); err != nil {
		return true // poison message; ack to avoid redelivery storm
	}

	if parsed.Type == "heartbeat" || len(parsed.Points) == 0 {
		return true
	}

	for _, pt := range parsed.Points {
		if pt.Class != "metric" {
			continue
		}
		value, ok := parseMetricValue(pt.Value)
		if !ok {
			continue
		}
		oc.processPoint(parsed.SourceID, pt.Metric, value, now)
	}
	return true
}

// autoClaimLoop periodically sweeps the consumer group's PEL and
// reclaims entries that have been idle longer than autoClaimMinIdle —
// i.e. messages a crashed or evicted consumer left behind. Reclaimed
// messages are fed through the same processing path.
func (oc *OrgConsumer) autoClaimLoop() {
	defer oc.wg.Done()

	ticker := time.NewTicker(autoClaimInterval)
	defer ticker.Stop()

	cursor := "0-0"
	for {
		select {
		case <-oc.stopCh:
			return
		case <-ticker.C:
		}

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		msgs, next, err := oc.redis.XAutoClaim(ctx, oc.orgID, oc.cfg.ConsumerGroup,
			oc.cfg.ConsumerName, autoClaimMinIdle, cursor, autoClaimCount)
		cancel()

		if err != nil {
			// Throttled Warn (same treatment as pollLoop errors): a
			// permanently failing PEL sweep must be visible at the prod
			// LOG_LEVEL=info, not hidden at Debug.
			if time.Since(oc.lastClaimErrLog) >= pollErrLogInterval {
				oc.lastClaimErrLog = time.Now()
				slog.Warn("consumer autoclaim error", "org", oc.orgID, "err", err)
			}
			cursor = "0-0"
			continue
		}
		cursor = next
		if len(msgs) == 0 {
			continue
		}

		slog.Info("consumer reclaimed pending", "org", oc.orgID, "count", len(msgs))
		oc.processAndAck(msgs)
	}
}

func (oc *OrgConsumer) processPoint(sourceID, metric string, value float64, now time.Time) {
	// Update distribution
	dist := oc.dists.Update(sourceID, metric, value)

	// Track latest value for compound rules
	if oc.latestValues[sourceID] == nil {
		oc.latestValues[sourceID] = make(map[string]float64)
	}
	oc.latestValues[sourceID][metric] = value

	// Get rules for this source
	rules := oc.rules.RulesForOrgSource(oc.orgID, sourceID)
	if len(rules) == 0 {
		return
	}

	snapshot := dist.Snapshot()

	for i := range rules {
		rule := &rules[i]

		var eval EvalDetail
		switch rule.Type {
		case RuleThreshold:
			if rule.Metric != metric {
				continue
			}
			eval = EvalThreshold(value, rule.Conditions)

		case RuleOutlier:
			if rule.Metric != metric {
				continue
			}
			eval = EvalOutlier(value, dist, rule.Conditions, oc.defaults.MinSamples)

		case RuleCompound:
			// Evaluate compound on any sub-rule metric change
			relevant := false
			for _, sub := range rule.SubRules {
				if sub.Metric == metric {
					relevant = true
					break
				}
			}
			if !relevant {
				continue
			}
			eval = EvalCompound(*rule, oc.latestValues[sourceID],
				oc.dists.GetSourceMetrics(sourceID), oc.defaults.MinSamples)

		default:
			continue
		}

		oc.metrics.IncEvaluations()
		oc.states.ProcessEvaluation(oc.orgID, rule, sourceID, metric, eval, snapshot, now)
	}
}

// =========================================================================
// ConsumerManager — starts/stops per-org consumers
// =========================================================================

type ConsumerManager struct {
	mu        sync.Mutex
	consumers map[string]*OrgConsumer
	redis     *RedisClient
	rules     *RuleStore
	states    *AlertStateManager
	metrics   *Metrics
	cfg       ConsumerConfig
	distAlpha float64
	defaults  AlertDefaults
}

func NewConsumerManager(
	rc *RedisClient,
	rules *RuleStore,
	states *AlertStateManager,
	metrics *Metrics,
	cfg ConsumerConfig,
	distAlpha float64,
	defaults AlertDefaults,
) *ConsumerManager {
	return &ConsumerManager{
		consumers: make(map[string]*OrgConsumer),
		redis:     rc,
		rules:     rules,
		states:    states,
		metrics:   metrics,
		cfg:       cfg,
		distAlpha: distAlpha,
		defaults:  defaults,
	}
}

// Reconcile checks if an org should have a consumer running and starts
// or stops one accordingly. Called after every rule change.
func (cm *ConsumerManager) Reconcile(orgID string) {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	hasRules := len(cm.rules.RulesForOrg(orgID)) > 0
	_, hasConsumer := cm.consumers[orgID]

	if hasRules && !hasConsumer {
		consumer := NewOrgConsumer(orgID, cm.redis, cm.rules, cm.states,
			cm.metrics, cm.cfg, cm.distAlpha, cm.defaults)
		cm.consumers[orgID] = consumer
		consumer.Start()
	} else if !hasRules && hasConsumer {
		consumer := cm.consumers[orgID]
		delete(cm.consumers, orgID)
		go consumer.Stop() // stop outside lock
	}
	cm.metrics.SetConsumersActive(float64(len(cm.consumers)))
}

// ReconcileAll starts consumers for all orgs with rules. Called at bootstrap.
func (cm *ConsumerManager) ReconcileAll() {
	for _, orgID := range cm.rules.OrgsWithRules() {
		cm.Reconcile(orgID)
	}
}

// StopAll stops all consumers. Called on graceful shutdown.
func (cm *ConsumerManager) StopAll() {
	cm.mu.Lock()
	consumers := make([]*OrgConsumer, 0, len(cm.consumers))
	for _, c := range cm.consumers {
		consumers = append(consumers, c)
	}
	cm.consumers = make(map[string]*OrgConsumer)
	cm.mu.Unlock()

	for _, c := range consumers {
		c.Stop()
	}
}

// ActiveCount returns the number of running consumers.
func (cm *ConsumerManager) ActiveCount() int {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	return len(cm.consumers)
}
