package main

// Alert state machine — manages per-(rule, source) alert lifecycle.
//
// States:
//   IDLE → OPEN → CLOSING → COOLDOWN → IDLE
//
// - IDLE: no alert, ready to fire
// - OPEN: condition triggered, emitted "open" transition
// - CLOSING: condition cleared, hysteresis countdown running
// - COOLDOWN: hysteresis elapsed, "closed" transition emitted; waiting
//   before allowing re-fire
//
// (The wire-level "closed" event fires on the CLOSING → COOLDOWN edge;
// there is no stored CLOSED state — it would never be observable, since
// the transition happens in one locked section.)
//
// Hysteresis is close-side only: alert opens immediately, requires
// sustained recovery to close. Prevents flapping on recovery.

import (
	"log/slog"
	"sync"
	"time"
)

type AlertState int

const (
	StateIdle     AlertState = iota
	StateOpen                // alert active
	StateClosing             // condition cleared, hysteresis countdown
	StateCooldown            // "closed" emitted, waiting before allowing re-fire
)

func (s AlertState) String() string {
	switch s {
	case StateIdle:
		return "idle"
	case StateOpen:
		return "open"
	case StateClosing:
		return "closing"
	case StateCooldown:
		return "cooldown"
	default:
		return "unknown"
	}
}

// AlertInstance tracks the state of a single alert (one rule + one source).
type AlertInstance struct {
	RuleID   string
	SourceID string
	Metric   string // primary metric (or first sub-rule metric for compound)
	Severity string // copied from the rule at open (needed for synthetic closes)
	State    AlertState

	OpenedAt      time.Time
	LastTriggered time.Time // last time condition was true
	ClosingStart  time.Time // when hysteresis countdown started
	ClosedAt      time.Time

	LastValue float64
	LastDist  DistSnapshot

	// Stats fields — populated for threshold/outlier rules only.
	OrgID           string       // for rule lookup in /stats endpoint
	TriggerValue    float64      // value at first breach, frozen at open
	PeakValue       float64      // most extreme value seen (direction-aware)
	PeakZScore      *float64     // highest |z-score| seen (outlier only)
	RecoveryValue   *float64     // value at most recent OPEN→CLOSING transition
	RetriggerCount  int          // triggered evals after the initial open
	DataPointCount  int          // every ProcessEvaluation call after open (incl. open)
	OpenDist        DistSnapshot // EWMA snapshot frozen at open
	BreachDirection int8         // +1 = max violation, -1 = min violation, 0 = outlier
}

// Transition represents a state change to be sent to Next.js.
type Transition struct {
	RuleID       string       `json:"rule_id"`
	OrgID        string       `json:"org_id"`
	SourceID     string       `json:"source_id"`
	Metric       string       `json:"metric"`
	State        string       `json:"state"` // "open" or "closed"
	Value        float64      `json:"value"`
	Threshold    *float64     `json:"threshold,omitempty"`
	ZScore       *float64     `json:"z_score,omitempty"`
	Severity     string       `json:"severity"`
	Distribution DistSnapshot `json:"distribution"`
	Timestamp    int64        `json:"timestamp"`       // unix seconds
	Stats        *AlertStats  `json:"stats,omitempty"` // closed transitions only, threshold/outlier
}

// AlertStats is assembled at alert close and attached to the "closed" Transition.
// Only produced for threshold and outlier rules.
type AlertStats struct {
	OpenedAt        int64        `json:"opened_at"`
	ClosedAt        int64        `json:"closed_at"`
	DurationSeconds float64      `json:"duration_seconds"`
	TriggerValue    float64      `json:"trigger_value"`
	PeakValue       float64      `json:"peak_value"`
	PeakZScore      *float64     `json:"peak_z_score,omitempty"`
	RecoveryValue   *float64     `json:"recovery_value,omitempty"`
	RetriggerCount  int          `json:"retrigger_count"`
	DataPointCount  int          `json:"data_point_count"`
	OpenDist        DistSnapshot `json:"open_dist"`
	CloseDist       DistSnapshot `json:"close_dist"`
	DistDrift       float64      `json:"dist_drift"` // close_dist.Mean - open_dist.Mean
}

// LiveStats is returned by GET /stats for in-flight alerts.
// Only produced for threshold and outlier rules.
type LiveStats struct {
	State              string       `json:"state"` // "breaching" or "recovering"
	OpenedAt           int64        `json:"opened_at"`
	TriggerValue       float64      `json:"trigger_value"`
	PeakValue          float64      `json:"peak_value"`
	PeakZScore         *float64     `json:"peak_z_score,omitempty"`
	RetriggerCount     int          `json:"retrigger_count"`
	DataPointCount     int          `json:"data_point_count"`
	CurrentDist        DistSnapshot `json:"current_dist"`
	HysteresisProgress *float64     `json:"hysteresis_progress,omitempty"` // 0.0–1.0, recovering only
}

// TransitionSink receives state transitions.
type TransitionSink interface {
	Enqueue(t Transition)
}

// AlertStateManager holds all active alert instances and processes
// evaluation results to drive state transitions. Thread-safe — called
// from multiple OrgConsumer goroutines.
type AlertStateManager struct {
	mu        sync.Mutex
	instances map[string]*AlertInstance // key: ruleID:sourceSlug
	sinks     []TransitionSink
	defaults  AlertDefaults
	metrics   *Metrics
}

func NewAlertStateManager(defaults AlertDefaults, metrics *Metrics, sinks ...TransitionSink) *AlertStateManager {
	return &AlertStateManager{
		instances: make(map[string]*AlertInstance),
		sinks:     sinks,
		defaults:  defaults,
		metrics:   metrics,
	}
}

func instanceKey(ruleID, sourceID string) string {
	return ruleID + ":" + sourceID
}

// isStatsRule reports whether the rule supports stats accumulation.
// Compound rules span multiple metrics and are excluded.
func isStatsRule(rule *AlertRule) bool {
	return rule.Type == RuleThreshold || rule.Type == RuleOutlier
}

// breachDirection returns +1 if a max bound was violated, -1 if a min bound
// was violated, and 0 for outlier rules. Uses the rule's conditions directly
// so it doesn't depend on EvalDetail.Threshold being populated.
func breachDirection(rule *AlertRule, eval EvalDetail) int8 {
	if rule.Type == RuleOutlier {
		return 0
	}
	if rule.Conditions.Max != nil && eval.Value > *rule.Conditions.Max {
		return +1
	}
	return -1
}

// updatePeak updates PeakValue (and PeakZScore for outlier rules) if the new
// evaluation is more extreme than the current peak.
func updatePeak(inst *AlertInstance, eval EvalDetail) {
	switch inst.BreachDirection {
	case +1:
		if eval.Value > inst.PeakValue {
			inst.PeakValue = eval.Value
		}
	case -1:
		if eval.Value < inst.PeakValue {
			inst.PeakValue = eval.Value
		}
	case 0: // outlier — EvalOutlier stores |z| in ZScore
		if eval.ZScore != nil {
			absZ := *eval.ZScore
			if inst.PeakZScore == nil || absZ > *inst.PeakZScore {
				z := absZ
				inst.PeakZScore = &z
				inst.PeakValue = eval.Value
			}
		}
	}
}

// newAlertInstance creates a fresh AlertInstance for a new breach, initializing
// stats fields for threshold/outlier rules.
func newAlertInstance(rule *AlertRule, orgID, sourceID, metric string, eval EvalDetail, dist DistSnapshot, now time.Time) *AlertInstance {
	inst := &AlertInstance{
		RuleID:        rule.ID,
		OrgID:         orgID,
		SourceID:      sourceID,
		Metric:        metric,
		Severity:      rule.Severity,
		State:         StateOpen,
		OpenedAt:      now,
		LastTriggered: now,
		LastValue:     eval.Value,
		LastDist:      dist,
	}
	if isStatsRule(rule) {
		inst.TriggerValue = eval.Value
		inst.PeakValue = eval.Value
		inst.OpenDist = dist
		inst.BreachDirection = breachDirection(rule, eval)
		inst.DataPointCount = 1
		if eval.ZScore != nil {
			z := *eval.ZScore
			inst.PeakZScore = &z
		}
	}
	return inst
}

// ProcessEvaluation feeds an evaluation result into the state machine
// for a specific (rule, source) pair. Emits transitions on state changes.
// Thread-safe — called from multiple OrgConsumer goroutines.
func (asm *AlertStateManager) ProcessEvaluation(
	orgID string,
	rule *AlertRule,
	sourceID string,
	metric string,
	eval EvalDetail,
	dist DistSnapshot,
	now time.Time,
) {
	asm.mu.Lock()
	defer asm.mu.Unlock()

	key := instanceKey(rule.ID, sourceID)
	inst, exists := asm.instances[key]

	hysteresis := time.Duration(asm.hysteresisSeconds(rule)) * time.Second
	cooldown := time.Duration(asm.cooldownSeconds(rule)) * time.Second

	if !exists {
		if eval.Triggered {
			inst = newAlertInstance(rule, orgID, sourceID, metric, eval, dist, now)
			asm.instances[key] = inst
			asm.emit(orgID, rule, inst, "open", eval)

			slog.Info("alert opened",
				"org", orgID, "rule", rule.ID,
				"source", sourceID, "metric", metric,
				"value", eval.Value, "severity", rule.Severity)
		}
		return
	}

	switch inst.State {
	case StateOpen:
		inst.LastDist = dist
		if isStatsRule(rule) {
			inst.DataPointCount++
		}
		if eval.Triggered {
			inst.LastTriggered = now
			inst.LastValue = eval.Value
			if isStatsRule(rule) {
				inst.RetriggerCount++
				updatePeak(inst, eval)
			}
		} else {
			inst.State = StateClosing
			inst.ClosingStart = now
			if isStatsRule(rule) {
				v := eval.Value
				inst.RecoveryValue = &v
			}
		}

	case StateClosing:
		inst.LastDist = dist
		if isStatsRule(rule) {
			inst.DataPointCount++
		}
		if eval.Triggered {
			// Re-triggered during hysteresis: back to open
			inst.State = StateOpen
			inst.LastTriggered = now
			inst.LastValue = eval.Value
			if isStatsRule(rule) {
				inst.RetriggerCount++
				updatePeak(inst, eval)
			}
		} else if now.Sub(inst.ClosingStart) >= hysteresis {
			// Hysteresis elapsed: emit "closed" and go straight to
			// cooldown. (A distinct CLOSED state would never be observable
			// — this all happens under one lock.) State is set before the
			// emit so the alerts_open gauge sees the post-close count.
			inst.ClosedAt = now
			inst.State = StateCooldown
			asm.emit(orgID, rule, inst, "closed", eval)

			slog.Info("alert closed",
				"org", orgID, "rule", rule.ID,
				"source", sourceID, "metric", metric,
				"duration", now.Sub(inst.OpenedAt))
		}

	case StateCooldown:
		if now.Sub(inst.ClosedAt) >= cooldown {
			delete(asm.instances, key)
			// Cooldown expired. If currently triggering, open a new alert
			// immediately (inline instead of recursive call to avoid deadlock).
			if eval.Triggered {
				newInst := newAlertInstance(rule, orgID, sourceID, metric, eval, dist, now)
				asm.instances[key] = newInst
				asm.emit(orgID, rule, newInst, "open", eval)

				slog.Info("alert opened",
					"org", orgID, "rule", rule.ID,
					"source", sourceID, "metric", metric,
					"value", eval.Value, "severity", rule.Severity)
			}
		}
		// During cooldown, ignore evaluations
	}
}

// OpenAlerts returns the count of currently open alerts.
func (asm *AlertStateManager) OpenAlerts() int {
	asm.mu.Lock()
	defer asm.mu.Unlock()
	return asm.openAlertsLocked()
}

// openAlertsLocked counts open/closing instances. Caller must hold asm.mu.
func (asm *AlertStateManager) openAlertsLocked() int {
	count := 0
	for _, inst := range asm.instances {
		if inst.State == StateOpen || inst.State == StateClosing {
			count++
		}
	}
	return count
}

// ReconcileRules drops alert instances belonging to orgID whose rule is no
// longer in liveRuleIDs (i.e. the rule was deleted or the org's rule set was
// cleared). Without this, an OPEN/CLOSING instance for a deleted rule would
// be stranded forever: instances are otherwise only removed at cooldown
// expiry inside ProcessEvaluation, which never runs again once the rule is
// gone. Open/closing instances emit a synthetic "closed" transition so the
// frontend's active alert row is closed out; cooldown instances are dropped
// silently. Returns the number of instances removed.
func (asm *AlertStateManager) ReconcileRules(orgID string, liveRuleIDs map[string]struct{}) int {
	asm.mu.Lock()
	defer asm.mu.Unlock()

	now := time.Now()
	removed := 0
	for key, inst := range asm.instances {
		if inst.OrgID != orgID {
			continue
		}
		if _, live := liveRuleIDs[inst.RuleID]; live {
			continue
		}
		wasOpen := inst.State == StateOpen || inst.State == StateClosing
		delete(asm.instances, key)
		removed++
		if !wasOpen {
			continue
		}
		inst.ClosedAt = now
		asm.emitSyntheticClose(inst)
		slog.Info("alert closed (rule deleted)",
			"org", orgID, "rule", inst.RuleID,
			"source", inst.SourceID, "metric", inst.Metric,
			"duration", now.Sub(inst.OpenedAt))
	}
	if removed > 0 {
		asm.metrics.SetAlertsOpen(float64(asm.openAlertsLocked()))
	}
	return removed
}

// emitSyntheticClose sends a "closed" transition for an instance whose rule
// was deleted. The rule itself is gone, so the payload is built entirely
// from the instance (severity was frozen at open). Shape matches a normal
// close per CONTRACT.md §3 / the Next.js transitions route: it resolves the
// active alerts row by (org_id, rule_id, source_id) and flips
// is_alert_active. Caller must hold asm.mu.
func (asm *AlertStateManager) emitSyntheticClose(inst *AlertInstance) {
	t := Transition{
		RuleID:       inst.RuleID,
		OrgID:        inst.OrgID,
		SourceID:     inst.SourceID,
		Metric:       inst.Metric,
		State:        "closed",
		Value:        inst.LastValue,
		Severity:     inst.Severity,
		Distribution: inst.LastDist,
		Timestamp:    inst.ClosedAt.Unix(),
	}
	// DataPointCount is ≥1 iff this was a stats (threshold/outlier) rule.
	if inst.DataPointCount > 0 {
		t.Stats = closeStats(inst)
	}
	for _, sink := range asm.sinks {
		sink.Enqueue(t)
	}
	asm.metrics.IncAlertsClosed()
}

// AllInstances returns a snapshot of all alert instances (for health/debug).
func (asm *AlertStateManager) AllInstances() map[string]*AlertInstance {
	asm.mu.Lock()
	defer asm.mu.Unlock()
	out := make(map[string]*AlertInstance, len(asm.instances))
	for k, v := range asm.instances {
		cp := *v
		out[k] = &cp
	}
	return out
}

// GetInstance returns a copy of the AlertInstance for the given (ruleID, sourceID),
// or (nil, false) if not found.
func (asm *AlertStateManager) GetInstance(ruleID, sourceID string) (*AlertInstance, bool) {
	asm.mu.Lock()
	defer asm.mu.Unlock()
	inst, ok := asm.instances[instanceKey(ruleID, sourceID)]
	if !ok {
		return nil, false
	}
	cp := *inst
	return &cp, true
}

func (asm *AlertStateManager) emit(orgID string, rule *AlertRule, inst *AlertInstance, state string, eval EvalDetail) {
	t := Transition{
		RuleID:       rule.ID,
		OrgID:        orgID,
		SourceID:     inst.SourceID,
		Metric:       inst.Metric,
		State:        state,
		Value:        inst.LastValue,
		Threshold:    eval.Threshold,
		ZScore:       eval.ZScore,
		Severity:     rule.Severity,
		Distribution: inst.LastDist,
		Timestamp:    inst.OpenedAt.Unix(),
	}
	if state == "closed" {
		t.Timestamp = inst.ClosedAt.Unix()
		if isStatsRule(rule) {
			t.Stats = closeStats(inst)
		}
	}

	for _, sink := range asm.sinks {
		sink.Enqueue(t)
	}

	if state == "open" {
		asm.metrics.IncAlertsFired()
	} else if state == "closed" {
		asm.metrics.IncAlertsClosed()
	}
	asm.metrics.SetAlertsOpen(float64(asm.openAlertsLocked()))
}

// closeStats assembles the AlertStats payload attached to a "closed"
// transition. Only meaningful for threshold/outlier (stats) rules.
func closeStats(inst *AlertInstance) *AlertStats {
	closeDist := inst.LastDist
	return &AlertStats{
		OpenedAt:        inst.OpenedAt.Unix(),
		ClosedAt:        inst.ClosedAt.Unix(),
		DurationSeconds: inst.ClosedAt.Sub(inst.OpenedAt).Seconds(),
		TriggerValue:    inst.TriggerValue,
		PeakValue:       inst.PeakValue,
		PeakZScore:      inst.PeakZScore,
		RecoveryValue:   inst.RecoveryValue,
		RetriggerCount:  inst.RetriggerCount,
		DataPointCount:  inst.DataPointCount,
		OpenDist:        inst.OpenDist,
		CloseDist:       closeDist,
		DistDrift:       closeDist.Mean - inst.OpenDist.Mean,
	}
}

func (asm *AlertStateManager) hysteresisSeconds(rule *AlertRule) int {
	if rule.HysteresisSeconds > 0 {
		return rule.HysteresisSeconds
	}
	return asm.defaults.HysteresisSeconds
}

func (asm *AlertStateManager) cooldownSeconds(rule *AlertRule) int {
	if rule.CooldownSeconds > 0 {
		return rule.CooldownSeconds
	}
	return asm.defaults.CooldownSeconds
}
