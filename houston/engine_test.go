package main

import (
	"math"
	"testing"
)

func float64Ptr(v float64) *float64 { return &v }
func intPtr(v int) *int             { return &v }

func TestEvalThreshold_BelowMin(t *testing.T) {
	d := EvalThreshold(15.0, RuleConditions{Min: float64Ptr(20.0), Max: float64Ptr(80.0)})
	if !d.Triggered {
		t.Error("should trigger below min")
	}
	if d.Threshold == nil || *d.Threshold != 20.0 {
		t.Errorf("threshold = %v, want 20.0", d.Threshold)
	}
}

func TestEvalThreshold_AboveMax(t *testing.T) {
	d := EvalThreshold(85.0, RuleConditions{Min: float64Ptr(20.0), Max: float64Ptr(80.0)})
	if !d.Triggered {
		t.Error("should trigger above max")
	}
	if d.Threshold == nil || *d.Threshold != 80.0 {
		t.Errorf("threshold = %v, want 80.0", d.Threshold)
	}
}

func TestEvalThreshold_InRange(t *testing.T) {
	d := EvalThreshold(50.0, RuleConditions{Min: float64Ptr(20.0), Max: float64Ptr(80.0)})
	if d.Triggered {
		t.Error("should not trigger in range")
	}
}

func TestEvalThreshold_OneSided(t *testing.T) {
	// Only max
	d := EvalThreshold(85.0, RuleConditions{Max: float64Ptr(80.0)})
	if !d.Triggered {
		t.Error("should trigger above max-only bound")
	}

	d = EvalThreshold(50.0, RuleConditions{Max: float64Ptr(80.0)})
	if d.Triggered {
		t.Error("should not trigger within max-only bound")
	}

	// Only min
	d = EvalThreshold(5.0, RuleConditions{Min: float64Ptr(10.0)})
	if !d.Triggered {
		t.Error("should trigger below min-only bound")
	}
}

func TestEvalThreshold_NaN(t *testing.T) {
	d := EvalThreshold(math.NaN(), RuleConditions{Max: float64Ptr(80.0)})
	if d.Triggered {
		t.Error("NaN should not trigger")
	}
}

func TestEvalOutlier_Triggered(t *testing.T) {
	w := NewWelfordState(0.1)
	// Build distribution around 100 with stddev ~10
	for i := 0; i < 100; i++ {
		if i%2 == 0 {
			w.Update(90.0)
		} else {
			w.Update(110.0)
		}
	}

	// A value far from the mean should trigger
	d := EvalOutlier(160.0, w, RuleConditions{ZScore: float64Ptr(3.0)}, 30)
	if !d.Triggered {
		t.Errorf("should trigger for value 160 (z-score=%v)", d.ZScore)
	}
	if d.ZScore == nil {
		t.Error("z-score should be populated")
	}
}

func TestEvalOutlier_NotTriggered(t *testing.T) {
	w := NewWelfordState(0.1)
	for i := 0; i < 100; i++ {
		if i%2 == 0 {
			w.Update(90.0)
		} else {
			w.Update(110.0)
		}
	}

	// A value near the mean should not trigger
	d := EvalOutlier(105.0, w, RuleConditions{ZScore: float64Ptr(3.0)}, 30)
	if d.Triggered {
		t.Errorf("should not trigger for value 105 (z-score=%v)", d.ZScore)
	}
}

func TestEvalOutlier_InsufficientSamples(t *testing.T) {
	w := NewWelfordState(0.1)
	for i := 0; i < 10; i++ {
		w.Update(100.0)
	}

	d := EvalOutlier(200.0, w, RuleConditions{ZScore: float64Ptr(3.0), MinSamples: intPtr(30)}, 30)
	if d.Triggered {
		t.Error("should not trigger with insufficient samples")
	}
}

func TestEvalOutlier_NilDist(t *testing.T) {
	d := EvalOutlier(100.0, nil, RuleConditions{}, 30)
	if d.Triggered {
		t.Error("should not trigger with nil distribution")
	}
}

func TestEvalCompound_AND(t *testing.T) {
	rule := AlertRule{
		Type:     RuleCompound,
		Operator: "and",
		SubRules: []SubRule{
			{Type: RuleThreshold, Metric: "temperature", Conditions: RuleConditions{Max: float64Ptr(80.0)}},
			{Type: RuleThreshold, Metric: "pressure", Conditions: RuleConditions{Min: float64Ptr(900.0)}},
		},
	}

	// Both trigger
	d := EvalCompound(rule, map[string]float64{
		"temperature": 85.0,
		"pressure":    850.0,
	}, nil, 30)
	if !d.Triggered {
		t.Error("AND: should trigger when both conditions met")
	}

	// Only one triggers
	d = EvalCompound(rule, map[string]float64{
		"temperature": 85.0,
		"pressure":    950.0,
	}, nil, 30)
	if d.Triggered {
		t.Error("AND: should not trigger when only one condition met")
	}
}

func TestEvalCompound_OR(t *testing.T) {
	rule := AlertRule{
		Type:     RuleCompound,
		Operator: "or",
		SubRules: []SubRule{
			{Type: RuleThreshold, Metric: "temperature", Conditions: RuleConditions{Max: float64Ptr(80.0)}},
			{Type: RuleThreshold, Metric: "pressure", Conditions: RuleConditions{Min: float64Ptr(900.0)}},
		},
	}

	// One triggers
	d := EvalCompound(rule, map[string]float64{
		"temperature": 85.0,
		"pressure":    950.0,
	}, nil, 30)
	if !d.Triggered {
		t.Error("OR: should trigger when one condition met")
	}

	// Neither triggers
	d = EvalCompound(rule, map[string]float64{
		"temperature": 75.0,
		"pressure":    950.0,
	}, nil, 30)
	if d.Triggered {
		t.Error("OR: should not trigger when no conditions met")
	}
}

func TestEvalCompound_MissingMetric(t *testing.T) {
	rule := AlertRule{
		Type:     RuleCompound,
		Operator: "and",
		SubRules: []SubRule{
			{Type: RuleThreshold, Metric: "temperature", Conditions: RuleConditions{Max: float64Ptr(80.0)}},
			{Type: RuleThreshold, Metric: "pressure", Conditions: RuleConditions{Min: float64Ptr(900.0)}},
		},
	}

	// Only temperature present (AND requires both)
	d := EvalCompound(rule, map[string]float64{
		"temperature": 85.0,
	}, nil, 30)
	if d.Triggered {
		t.Error("AND: should not trigger with missing metric data")
	}
}

func TestEvalCompound_WithOutlierSubRule(t *testing.T) {
	w := NewWelfordState(0.1)
	for i := 0; i < 100; i++ {
		if i%2 == 0 {
			w.Update(90.0)
		} else {
			w.Update(110.0)
		}
	}

	rule := AlertRule{
		Type:     RuleCompound,
		Operator: "and",
		SubRules: []SubRule{
			{Type: RuleThreshold, Metric: "temperature", Conditions: RuleConditions{Max: float64Ptr(80.0)}},
			{Type: RuleOutlier, Metric: "pressure", Conditions: RuleConditions{ZScore: float64Ptr(3.0)}},
		},
	}

	// Temperature above max, pressure is an outlier
	d := EvalCompound(rule, map[string]float64{
		"temperature": 85.0,
		"pressure":    160.0,
	}, map[string]*WelfordState{
		"pressure": w,
	}, 30)
	if !d.Triggered {
		t.Error("AND: should trigger when threshold and outlier both met")
	}
}
