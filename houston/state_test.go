package main

import (
	"testing"
	"time"
)

// mockSink collects transitions for test assertions.
type mockSink struct {
	transitions []Transition
}

func (m *mockSink) Enqueue(t Transition) {
	m.transitions = append(m.transitions, t)
}

func newTestASM(sinks ...TransitionSink) *AlertStateManager {
	return NewAlertStateManager(AlertDefaults{
		HysteresisSeconds: 30,
		CooldownSeconds:   60,
		MinSamples:        30,
	}, nil, sinks...)
}

func makeRule(id string) *AlertRule {
	max := 80.0
	return &AlertRule{
		ID:                id,
		OrgID:             "org1",
		SourceID:          "drone-1",
		Type:              RuleThreshold,
		Metric:            "temperature",
		Conditions:        RuleConditions{Max: &max},
		HysteresisSeconds: 30,
		CooldownSeconds:   60,
		Severity:          "warning",
	}
}

var zeroDist = DistSnapshot{}

// Scenario 1: Clean alert, clean recovery
func TestStateMachine_CleanOpenClose(t *testing.T) {
	sink := &mockSink{}
	asm := newTestASM(sink)
	rule := makeRule("r1")
	t0 := time.Now()

	// t=0: value=75, no trigger
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Value: 75.0}, zeroDist, t0)
	if len(sink.transitions) != 0 {
		t.Error("should not emit transition for non-trigger")
	}

	// t=1s: value=82, trigger → OPEN
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Triggered: true, Value: 82.0}, zeroDist, t0.Add(1*time.Second))
	if len(sink.transitions) != 1 {
		t.Fatalf("expected 1 transition, got %d", len(sink.transitions))
	}
	if sink.transitions[0].State != "open" {
		t.Errorf("state = %q, want %q", sink.transitions[0].State, "open")
	}
	if sink.transitions[0].Value != 82.0 {
		t.Errorf("value = %f, want 82.0", sink.transitions[0].Value)
	}

	// t=2s: still triggering, no new transition
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Triggered: true, Value: 85.0}, zeroDist, t0.Add(2*time.Second))
	if len(sink.transitions) != 1 {
		t.Error("should not emit extra transition while still open")
	}

	// t=3s: value=78, clears → starts hysteresis
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Value: 78.0}, zeroDist, t0.Add(3*time.Second))
	if len(sink.transitions) != 1 {
		t.Error("should not emit transition when entering closing")
	}

	// t=20s: still clear but hysteresis not elapsed (30s)
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Value: 76.0}, zeroDist, t0.Add(20*time.Second))
	if len(sink.transitions) != 1 {
		t.Error("should not close before hysteresis elapses")
	}

	// t=33s: hysteresis elapsed → CLOSED
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Value: 76.0}, zeroDist, t0.Add(33*time.Second))
	if len(sink.transitions) != 2 {
		t.Fatalf("expected 2 transitions, got %d", len(sink.transitions))
	}
	if sink.transitions[1].State != "closed" {
		t.Errorf("state = %q, want %q", sink.transitions[1].State, "closed")
	}
}

// Scenario 2: Flapping recovery — hysteresis prevents close
func TestStateMachine_FlappingRecovery(t *testing.T) {
	sink := &mockSink{}
	asm := newTestASM(sink)
	rule := makeRule("r1")
	t0 := time.Now()

	// Open the alert
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Triggered: true, Value: 82.0}, zeroDist, t0)
	if len(sink.transitions) != 1 || sink.transitions[0].State != "open" {
		t.Fatal("expected open transition")
	}

	// t=5s: clears, hysteresis starts
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Value: 78.0}, zeroDist, t0.Add(5*time.Second))

	// t=15s: re-triggers during hysteresis → back to open, no new transition
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Triggered: true, Value: 83.0}, zeroDist, t0.Add(15*time.Second))
	if len(sink.transitions) != 1 {
		t.Error("should not emit new transition for re-trigger during hysteresis")
	}

	// t=20s: clears again, hysteresis restarts
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Value: 79.0}, zeroDist, t0.Add(20*time.Second))

	// t=50s: sustained recovery (30s since t=20s), should close
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Value: 77.0}, zeroDist, t0.Add(50*time.Second))
	if len(sink.transitions) != 2 {
		t.Fatalf("expected 2 transitions, got %d", len(sink.transitions))
	}
	if sink.transitions[1].State != "closed" {
		t.Errorf("state = %q, want %q", sink.transitions[1].State, "closed")
	}
}

// Scenario 3: Cooldown blocks rapid re-fire
func TestStateMachine_CooldownBlocksRefire(t *testing.T) {
	sink := &mockSink{}
	asm := newTestASM(sink)
	rule := makeRule("r1")
	t0 := time.Now()

	// Open
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Triggered: true, Value: 82.0}, zeroDist, t0)

	// Close after hysteresis
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Value: 76.0}, zeroDist, t0.Add(1*time.Second))
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Value: 75.0}, zeroDist, t0.Add(32*time.Second))
	if len(sink.transitions) != 2 {
		t.Fatalf("expected 2 transitions (open+close), got %d", len(sink.transitions))
	}

	// t=40s: re-trigger during cooldown → should be ignored
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Triggered: true, Value: 84.0}, zeroDist, t0.Add(40*time.Second))
	if len(sink.transitions) != 2 {
		t.Error("should not re-fire during cooldown")
	}

	// t=92s: cooldown expired (60s after close at t=32s), re-trigger → new open
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Triggered: true, Value: 81.0}, zeroDist, t0.Add(93*time.Second))
	if len(sink.transitions) != 3 {
		t.Fatalf("expected 3 transitions, got %d", len(sink.transitions))
	}
	if sink.transitions[2].State != "open" {
		t.Errorf("state = %q, want %q", sink.transitions[2].State, "open")
	}
}

// No data = alert stays open (hysteresis is data-driven)
func TestStateMachine_NoDataKeepsOpen(t *testing.T) {
	sink := &mockSink{}
	asm := newTestASM(sink)
	rule := makeRule("r1")
	t0 := time.Now()

	// Open
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Triggered: true, Value: 82.0}, zeroDist, t0)

	// Only 1 transition (open), no close because no subsequent data
	if len(sink.transitions) != 1 {
		t.Errorf("expected 1 transition, got %d", len(sink.transitions))
	}
	if asm.OpenAlerts() != 1 {
		t.Errorf("open alerts = %d, want 1", asm.OpenAlerts())
	}
}

func TestStateMachine_OpenAlerts(t *testing.T) {
	asm := newTestASM(&mockSink{})
	rule1 := makeRule("r1")
	rule2 := makeRule("r2")
	t0 := time.Now()

	if asm.OpenAlerts() != 0 {
		t.Error("should start with 0 open alerts")
	}

	asm.ProcessEvaluation("org1", rule1, "drone-1", "temperature",
		EvalDetail{Triggered: true, Value: 82.0}, zeroDist, t0)
	asm.ProcessEvaluation("org1", rule2, "drone-1", "temperature",
		EvalDetail{Triggered: true, Value: 82.0}, zeroDist, t0)

	if asm.OpenAlerts() != 2 {
		t.Errorf("open alerts = %d, want 2", asm.OpenAlerts())
	}
}

func TestStateMachine_MultipleSinks(t *testing.T) {
	sink1 := &mockSink{}
	sink2 := &mockSink{}
	asm := newTestASM(sink1, sink2)
	rule := makeRule("r1")

	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Triggered: true, Value: 82.0}, zeroDist, time.Now())

	if len(sink1.transitions) != 1 {
		t.Errorf("sink1 got %d transitions, want 1", len(sink1.transitions))
	}
	if len(sink2.transitions) != 1 {
		t.Errorf("sink2 got %d transitions, want 1", len(sink2.transitions))
	}
}

// =========================================================================
// Stats tests
// =========================================================================

func makeMinRule(id string) *AlertRule {
	min := 10.0
	return &AlertRule{
		ID:                id,
		OrgID:             "org1",
		SourceID:          "drone-1",
		Type:              RuleThreshold,
		Metric:            "temperature",
		Conditions:        RuleConditions{Min: &min},
		HysteresisSeconds: 30,
		CooldownSeconds:   60,
		Severity:          "warning",
	}
}

func makeOutlierRule(id string) *AlertRule {
	zScore := 3.0
	minSamples := 2
	return &AlertRule{
		ID:                id,
		OrgID:             "org1",
		SourceID:          "drone-1",
		Type:              RuleOutlier,
		Metric:            "temperature",
		Conditions:        RuleConditions{ZScore: &zScore, MinSamples: &minSamples},
		HysteresisSeconds: 30,
		CooldownSeconds:   60,
		Severity:          "warning",
	}
}

func makeCompoundRule(id string) *AlertRule {
	max := 80.0
	return &AlertRule{
		ID:       id,
		OrgID:    "org1",
		SourceID: "drone-1",
		Type:     RuleCompound,
		Operator: "and",
		SubRules: []SubRule{
			{Type: RuleThreshold, Metric: "temperature", Conditions: RuleConditions{Max: &max}},
		},
		HysteresisSeconds: 30,
		CooldownSeconds:   60,
		Severity:          "warning",
	}
}

func TestStats_ThresholdMaxViolation(t *testing.T) {
	sink := &mockSink{}
	asm := newTestASM(sink)
	rule := makeRule("r1")
	t0 := time.Now()

	openDist := DistSnapshot{Mean: 70.0, StdDev: 2.0, Count: 100}
	closeDist := DistSnapshot{Mean: 72.0, StdDev: 2.1, Count: 104}

	// t=1: open
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Triggered: true, Value: 82.0}, openDist, t0.Add(1*time.Second))

	// Open transition should have nil Stats
	if sink.transitions[0].Stats != nil {
		t.Error("open transition should not have Stats")
	}

	// t=2: retrigger with higher peak
	th := 80.0
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Triggered: true, Value: 91.0, Threshold: &th}, DistSnapshot{Mean: 70.5, StdDev: 2.0, Count: 101}, t0.Add(2*time.Second))

	// t=3: clear → enter hysteresis, RecoveryValue = 78.0
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Value: 78.0}, DistSnapshot{Mean: 71.0, StdDev: 2.0, Count: 102}, t0.Add(3*time.Second))

	// t=33: hysteresis elapsed → close
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Value: 76.0}, closeDist, t0.Add(33*time.Second))

	if len(sink.transitions) != 2 {
		t.Fatalf("expected 2 transitions, got %d", len(sink.transitions))
	}
	s := sink.transitions[1].Stats
	if s == nil {
		t.Fatal("closed transition should have Stats")
	}

	if s.TriggerValue != 82.0 {
		t.Errorf("TriggerValue = %f, want 82.0", s.TriggerValue)
	}
	if s.PeakValue != 91.0 {
		t.Errorf("PeakValue = %f, want 91.0", s.PeakValue)
	}
	if s.PeakZScore != nil {
		t.Error("PeakZScore should be nil for threshold rule")
	}
	if s.RetriggerCount != 1 {
		t.Errorf("RetriggerCount = %d, want 1", s.RetriggerCount)
	}
	// DataPointCount: 1 (open) + 1 (retrigger) + 1 (clear→closing) + 1 (hysteresis elapsed) = 4
	if s.DataPointCount != 4 {
		t.Errorf("DataPointCount = %d, want 4", s.DataPointCount)
	}
	if s.RecoveryValue == nil || *s.RecoveryValue != 78.0 {
		t.Errorf("RecoveryValue = %v, want 78.0", s.RecoveryValue)
	}
	if s.OpenDist != openDist {
		t.Errorf("OpenDist = %+v, want %+v", s.OpenDist, openDist)
	}
	if s.CloseDist != closeDist {
		t.Errorf("CloseDist = %+v, want %+v", s.CloseDist, closeDist)
	}
	wantDrift := closeDist.Mean - openDist.Mean
	if s.DistDrift != wantDrift {
		t.Errorf("DistDrift = %f, want %f", s.DistDrift, wantDrift)
	}
	if s.DurationSeconds <= 0 {
		t.Errorf("DurationSeconds = %f, want > 0", s.DurationSeconds)
	}
	// Closed transition Value should be the last triggered value (91.0), not the clearing value (78.0).
	if sink.transitions[1].Value != 91.0 {
		t.Errorf("closed transition Value = %f, want 91.0 (last triggered value)", sink.transitions[1].Value)
	}
}

func TestStats_MinViolation(t *testing.T) {
	sink := &mockSink{}
	asm := newTestASM(sink)
	rule := makeMinRule("r1")
	t0 := time.Now()

	// Open with value below min (10.0)
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Triggered: true, Value: 5.0}, zeroDist, t0)

	// Retrigger with a lower value — should become new peak
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Triggered: true, Value: 2.0}, zeroDist, t0.Add(1*time.Second))

	// Retrigger with a higher (less extreme) value — peak should not change
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Triggered: true, Value: 4.0}, zeroDist, t0.Add(2*time.Second))

	// Clear and close
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Value: 12.0}, zeroDist, t0.Add(3*time.Second))
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Value: 12.0}, zeroDist, t0.Add(33*time.Second))

	if len(sink.transitions) != 2 {
		t.Fatalf("expected 2 transitions, got %d", len(sink.transitions))
	}
	s := sink.transitions[1].Stats
	if s == nil {
		t.Fatal("closed transition should have Stats")
	}
	if s.TriggerValue != 5.0 {
		t.Errorf("TriggerValue = %f, want 5.0", s.TriggerValue)
	}
	// Peak is the minimum (most extreme for min violation)
	if s.PeakValue != 2.0 {
		t.Errorf("PeakValue = %f, want 2.0 (lowest seen)", s.PeakValue)
	}
}

func TestStats_OutlierPeakZScore(t *testing.T) {
	sink := &mockSink{}
	asm := newTestASM(sink)
	rule := makeOutlierRule("r1")
	t0 := time.Now()

	z1 := 4.2
	z2 := 5.8

	// Open with z=4.2
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Triggered: true, Value: 55.0, ZScore: &z1}, zeroDist, t0)

	// Retrigger with higher z=5.8 → new peak
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Triggered: true, Value: 60.0, ZScore: &z2}, zeroDist, t0.Add(1*time.Second))

	// Clear and close
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Value: 40.0}, zeroDist, t0.Add(2*time.Second))
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Value: 40.0}, zeroDist, t0.Add(32*time.Second))

	if len(sink.transitions) != 2 {
		t.Fatalf("expected 2 transitions, got %d", len(sink.transitions))
	}
	s := sink.transitions[1].Stats
	if s == nil {
		t.Fatal("closed transition should have Stats")
	}
	if s.TriggerValue != 55.0 {
		t.Errorf("TriggerValue = %f, want 55.0", s.TriggerValue)
	}
	if s.PeakValue != 60.0 {
		t.Errorf("PeakValue = %f, want 60.0 (value with highest z-score)", s.PeakValue)
	}
	if s.PeakZScore == nil || *s.PeakZScore != z2 {
		t.Errorf("PeakZScore = %v, want %f", s.PeakZScore, z2)
	}
}

func TestStats_Flapping(t *testing.T) {
	sink := &mockSink{}
	asm := newTestASM(sink)
	rule := makeRule("r1")
	t0 := time.Now()

	// Open
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Triggered: true, Value: 82.0}, zeroDist, t0)

	// Clear → start hysteresis, RecoveryValue = 78.0
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Value: 78.0}, zeroDist, t0.Add(5*time.Second))

	// Re-trigger during hysteresis → back to open, RecoveryValue not updated yet
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Triggered: true, Value: 90.0}, zeroDist, t0.Add(15*time.Second))

	// Clear again → hysteresis restarts, RecoveryValue updated to 79.0
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Value: 79.0}, zeroDist, t0.Add(20*time.Second))

	// Hysteresis elapses → close
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Value: 77.0}, zeroDist, t0.Add(50*time.Second))

	if len(sink.transitions) != 2 {
		t.Fatalf("expected 2 transitions, got %d", len(sink.transitions))
	}
	s := sink.transitions[1].Stats
	if s == nil {
		t.Fatal("closed transition should have Stats")
	}
	// RecoveryValue should reflect the second (sticky) recovery, not the first aborted one
	if s.RecoveryValue == nil || *s.RecoveryValue != 79.0 {
		t.Errorf("RecoveryValue = %v, want 79.0 (second recovery)", s.RecoveryValue)
	}
	// PeakValue should track the highest value seen (90.0 during the re-trigger)
	if s.PeakValue != 90.0 {
		t.Errorf("PeakValue = %f, want 90.0", s.PeakValue)
	}
	// RetriggerCount: re-trigger at t=15s counts
	if s.RetriggerCount != 1 {
		t.Errorf("RetriggerCount = %d, want 1", s.RetriggerCount)
	}
}

func TestStats_CompoundRuleNoStats(t *testing.T) {
	sink := &mockSink{}
	asm := newTestASM(sink)
	rule := makeCompoundRule("r1")
	t0 := time.Now()

	latestVals := map[string]float64{"temperature": 90.0}
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Triggered: true, Value: 90.0}, zeroDist, t0)

	// Clear and close
	_ = latestVals
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Value: 75.0}, zeroDist, t0.Add(1*time.Second))
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Value: 75.0}, zeroDist, t0.Add(31*time.Second))

	if len(sink.transitions) != 2 {
		t.Fatalf("expected 2 transitions, got %d", len(sink.transitions))
	}
	if sink.transitions[1].Stats != nil {
		t.Error("compound rule closed transition should have nil Stats")
	}
}

func TestStats_GetInstanceBreaching(t *testing.T) {
	asm := newTestASM(&mockSink{})
	rule := makeRule("r1")
	t0 := time.Now()

	// Not found before open
	if _, ok := asm.GetInstance("r1", "drone-1"); ok {
		t.Error("should not find instance before open")
	}

	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Triggered: true, Value: 82.0}, zeroDist, t0)

	inst, ok := asm.GetInstance("r1", "drone-1")
	if !ok {
		t.Fatal("should find instance after open")
	}
	if inst.State != StateOpen {
		t.Errorf("State = %v, want StateOpen", inst.State)
	}
	if inst.TriggerValue != 82.0 {
		t.Errorf("TriggerValue = %f, want 82.0", inst.TriggerValue)
	}
	if inst.OrgID != "org1" {
		t.Errorf("OrgID = %q, want org1", inst.OrgID)
	}
}

func TestStats_GetInstanceRecovering(t *testing.T) {
	asm := newTestASM(&mockSink{})
	rule := makeRule("r1")
	t0 := time.Now()

	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Triggered: true, Value: 82.0}, zeroDist, t0)

	// Clear → enter hysteresis
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Value: 78.0}, zeroDist, t0.Add(1*time.Second))

	inst, ok := asm.GetInstance("r1", "drone-1")
	if !ok {
		t.Fatal("should find instance in closing state")
	}
	if inst.State != StateClosing {
		t.Errorf("State = %v, want StateClosing", inst.State)
	}
	if inst.RecoveryValue == nil || *inst.RecoveryValue != 78.0 {
		t.Errorf("RecoveryValue = %v, want 78.0", inst.RecoveryValue)
	}
}

// Rule deletion: ReconcileRules synthetically closes open instances whose
// rule vanished from the pushed set, and removes them.
func TestStateMachine_ReconcileRulesClosesDeletedRuleAlert(t *testing.T) {
	sink := &mockSink{}
	asm := newTestASM(sink)
	rule := makeRule("r1")
	t0 := time.Now()

	// Open an alert.
	asm.ProcessEvaluation("org1", rule, "drone-1", "temperature",
		EvalDetail{Triggered: true, Value: 82.0}, zeroDist, t0)
	if len(sink.transitions) != 1 || sink.transitions[0].State != "open" {
		t.Fatal("expected open transition")
	}
	if asm.OpenAlerts() != 1 {
		t.Fatalf("open alerts = %d, want 1", asm.OpenAlerts())
	}

	// Rule set replaced without r1 — the rule was deleted.
	removed := asm.ReconcileRules("org1", map[string]struct{}{})
	if removed != 1 {
		t.Fatalf("removed = %d, want 1", removed)
	}
	if len(sink.transitions) != 2 {
		t.Fatalf("expected 2 transitions, got %d", len(sink.transitions))
	}
	closed := sink.transitions[1]
	if closed.State != "closed" {
		t.Errorf("state = %q, want closed", closed.State)
	}
	if closed.RuleID != "r1" || closed.OrgID != "org1" || closed.SourceID != "drone-1" {
		t.Errorf("identity mismatch: %+v", closed)
	}
	if closed.Metric != "temperature" {
		t.Errorf("metric = %q, want temperature", closed.Metric)
	}
	if closed.Severity != "warning" {
		t.Errorf("severity = %q, want warning (frozen from rule at open)", closed.Severity)
	}
	if closed.Timestamp == 0 {
		t.Error("timestamp must be set")
	}
	if closed.Stats == nil {
		t.Error("stats expected on synthetic close of a threshold rule")
	} else if closed.Stats.TriggerValue != 82.0 {
		t.Errorf("stats trigger value = %f, want 82.0", closed.Stats.TriggerValue)
	}
	if asm.OpenAlerts() != 0 {
		t.Errorf("open alerts = %d, want 0", asm.OpenAlerts())
	}
	if _, ok := asm.GetInstance("r1", "drone-1"); ok {
		t.Error("instance should be deleted after reconcile")
	}
}

// ReconcileRules must not touch live rules or other orgs, and must drop
// cooldown instances silently (no synthetic close — already closed).
func TestStateMachine_ReconcileRulesScoping(t *testing.T) {
	sink := &mockSink{}
	asm := newTestASM(sink)
	t0 := time.Now()

	// org1: r1 (stays live) and r2 (will be deleted), both open.
	asm.ProcessEvaluation("org1", makeRule("r1"), "drone-1", "temperature",
		EvalDetail{Triggered: true, Value: 82.0}, zeroDist, t0)
	asm.ProcessEvaluation("org1", makeRule("r2"), "drone-1", "temperature",
		EvalDetail{Triggered: true, Value: 83.0}, zeroDist, t0)
	// org2: r3 open — a different org must be untouched.
	asm.ProcessEvaluation("org2", makeRule("r3"), "drone-9", "temperature",
		EvalDetail{Triggered: true, Value: 84.0}, zeroDist, t0)
	if len(sink.transitions) != 3 {
		t.Fatalf("expected 3 opens, got %d", len(sink.transitions))
	}

	removed := asm.ReconcileRules("org1", map[string]struct{}{"r1": {}})
	if removed != 1 {
		t.Fatalf("removed = %d, want 1", removed)
	}
	if len(sink.transitions) != 4 || sink.transitions[3].RuleID != "r2" {
		t.Fatalf("expected synthetic close for r2 only, got %+v", sink.transitions[3:])
	}
	if _, ok := asm.GetInstance("r1", "drone-1"); !ok {
		t.Error("live rule r1 instance must survive")
	}
	if _, ok := asm.GetInstance("r3", "drone-9"); !ok {
		t.Error("other org's instance must survive")
	}

	// Drive r1 through close into cooldown, then delete it: the cooldown
	// instance is dropped without emitting anything.
	asm.ProcessEvaluation("org1", makeRule("r1"), "drone-1", "temperature",
		EvalDetail{Value: 70.0}, zeroDist, t0.Add(1*time.Second))
	asm.ProcessEvaluation("org1", makeRule("r1"), "drone-1", "temperature",
		EvalDetail{Value: 70.0}, zeroDist, t0.Add(40*time.Second)) // hysteresis 30s elapsed
	if len(sink.transitions) != 5 || sink.transitions[4].State != "closed" {
		t.Fatalf("expected r1 real close, got %+v", sink.transitions[4:])
	}
	inst, ok := asm.GetInstance("r1", "drone-1")
	if !ok || inst.State != StateCooldown {
		t.Fatalf("r1 should be in cooldown, got %+v (ok=%v)", inst, ok)
	}

	removed = asm.ReconcileRules("org1", map[string]struct{}{})
	if removed != 1 {
		t.Fatalf("removed = %d, want 1", removed)
	}
	if len(sink.transitions) != 5 {
		t.Errorf("cooldown drop must not emit; got %d transitions", len(sink.transitions))
	}
	if _, ok := asm.GetInstance("r1", "drone-1"); ok {
		t.Error("cooldown instance should be deleted")
	}
}

// ReconcileActiveAlerts: DB-active rows with no live instance get a
// synthetic close (reason=reconciled); OPEN/CLOSING instances are left
// alone; COOLDOWN re-emits (repairs a lost close batch).
func TestReconcileActiveAlerts(t *testing.T) {
	sink := &mockSink{}
	asm := newTestASM(sink)
	t0 := time.Now()

	// r1/drone-1: live OPEN instance.
	asm.ProcessEvaluation("org1", makeRule("r1"), "drone-1", "temperature",
		EvalDetail{Triggered: true, Value: 90.0}, zeroDist, t0)
	// r2/drone-2: CLOSING (cleared, hysteresis running).
	asm.ProcessEvaluation("org1", makeRule("r2"), "drone-2", "temperature",
		EvalDetail{Triggered: true, Value: 90.0}, zeroDist, t0)
	asm.ProcessEvaluation("org1", makeRule("r2"), "drone-2", "temperature",
		EvalDetail{Value: 70.0}, zeroDist, t0.Add(1*time.Second))
	// r3/drone-3: COOLDOWN (closed already emitted).
	asm.ProcessEvaluation("org1", makeRule("r3"), "drone-3", "temperature",
		EvalDetail{Triggered: true, Value: 90.0}, zeroDist, t0)
	asm.ProcessEvaluation("org1", makeRule("r3"), "drone-3", "temperature",
		EvalDetail{Value: 70.0}, zeroDist, t0.Add(1*time.Second))
	asm.ProcessEvaluation("org1", makeRule("r3"), "drone-3", "temperature",
		EvalDetail{Value: 70.0}, zeroDist, t0.Add(40*time.Second))

	emittedBefore := len(sink.transitions) // r1 open, r2 open, r3 open+closed

	active := []ActiveAlert{
		{OrgID: "org1", RuleID: "r1", SourceID: "drone-1", Metric: "temperature", Severity: "warning"},
		{OrgID: "org1", RuleID: "r2", SourceID: "drone-2", Metric: "temperature", Severity: "warning"},
		{OrgID: "org1", RuleID: "r3", SourceID: "drone-3", Metric: "temperature", Severity: "warning"},
		{OrgID: "org1", RuleID: "r4", SourceID: "drone-4", Metric: "temperature", Severity: "critical"},
	}
	closed := asm.ReconcileActiveAlerts(active)

	// r1 (OPEN) and r2 (CLOSING) skipped; r3 (COOLDOWN) and r4 (no
	// instance — the restart-stranded case) closed.
	if closed != 2 {
		t.Fatalf("closed = %d, want 2", closed)
	}
	synthetic := sink.transitions[emittedBefore:]
	if len(synthetic) != 2 {
		t.Fatalf("expected 2 synthetic transitions, got %d", len(synthetic))
	}
	for _, tr := range synthetic {
		if tr.State != "closed" {
			t.Errorf("state = %q, want closed", tr.State)
		}
		if tr.Reason != "reconciled" {
			t.Errorf("reason = %q, want reconciled", tr.Reason)
		}
	}
	if synthetic[0].RuleID != "r3" || synthetic[1].RuleID != "r4" {
		t.Errorf("closed rules = %s, %s; want r3, r4",
			synthetic[0].RuleID, synthetic[1].RuleID)
	}
	if synthetic[1].Severity != "critical" {
		t.Errorf("severity should carry through from the row, got %q", synthetic[1].Severity)
	}

	// Idempotent for live instances: a second pass with only live rows
	// emits nothing new.
	closed = asm.ReconcileActiveAlerts(active[:2])
	if closed != 0 {
		t.Errorf("second pass closed = %d, want 0", closed)
	}
}
