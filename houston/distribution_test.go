package main

import (
	"math"
	"testing"
)

func TestWelfordState_SingleValue(t *testing.T) {
	w := NewWelfordState(0.01)
	w.Update(42.0)

	if w.Count != 1 {
		t.Errorf("count = %d, want 1", w.Count)
	}
	if w.Mean != 42.0 {
		t.Errorf("mean = %f, want 42.0", w.Mean)
	}
	if w.StdDev() != 0 {
		t.Errorf("stddev = %f, want 0", w.StdDev())
	}
}

func TestWelfordState_ConstantValues(t *testing.T) {
	w := NewWelfordState(0.01)
	for i := 0; i < 100; i++ {
		w.Update(50.0)
	}

	if w.Count != 100 {
		t.Errorf("count = %d, want 100", w.Count)
	}
	if math.Abs(w.Mean-50.0) > 1e-10 {
		t.Errorf("mean = %f, want 50.0", w.Mean)
	}
	if w.StdDev() > 1e-10 {
		t.Errorf("stddev = %f, want ~0", w.StdDev())
	}
}

func TestWelfordState_ZScore(t *testing.T) {
	w := NewWelfordState(0.1) // faster adaptation for test
	// Feed a bunch of values around 100 with some variance
	for i := 0; i < 100; i++ {
		// Alternate between 90 and 110 to build variance
		if i%2 == 0 {
			w.Update(90.0)
		} else {
			w.Update(110.0)
		}
	}

	// Mean should be close to 100
	if math.Abs(w.Mean-100.0) > 1.0 {
		t.Errorf("mean = %f, want ~100.0", w.Mean)
	}

	// StdDev should be close to 10
	if math.Abs(w.StdDev()-10.0) > 2.0 {
		t.Errorf("stddev = %f, want ~10.0", w.StdDev())
	}

	// A value of 130 should have z-score ~3
	z := w.ZScore(130.0, 10)
	if math.Abs(z-3.0) > 1.0 {
		t.Errorf("z-score for 130 = %f, want ~3.0", z)
	}
}

func TestWelfordState_ZScoreGatedByMinSamples(t *testing.T) {
	w := NewWelfordState(0.01)
	for i := 0; i < 10; i++ {
		w.Update(100.0)
	}

	// With only 10 samples, z-score should be 0 when min_samples=30
	z := w.ZScore(200.0, 30)
	if z != 0 {
		t.Errorf("z-score = %f, want 0 (gated by min_samples)", z)
	}

	// But should work when min_samples=5
	// (stddev is 0 for constant values, so z-score is still 0)
	z = w.ZScore(200.0, 5)
	if z != 0 {
		t.Errorf("z-score for constant values = %f, want 0 (zero stddev)", z)
	}
}

func TestWelfordState_IgnoresNaN(t *testing.T) {
	w := NewWelfordState(0.01)
	w.Update(42.0)
	w.Update(math.NaN())
	w.Update(math.Inf(1))

	if w.Count != 1 {
		t.Errorf("count = %d, want 1 (NaN/Inf should be ignored)", w.Count)
	}
	if w.Mean != 42.0 {
		t.Errorf("mean = %f, want 42.0", w.Mean)
	}
}

func TestWelfordState_ExponentialDecay(t *testing.T) {
	w := NewWelfordState(0.1) // 10% decay — fast adaptation for test

	// Phase 1: 100 values around 50
	for i := 0; i < 100; i++ {
		w.Update(50.0)
	}
	meanAfterPhase1 := w.Mean

	// Phase 2: 100 values around 150 (regime change)
	for i := 0; i < 100; i++ {
		w.Update(150.0)
	}

	// Mean should have shifted significantly toward 150
	if w.Mean <= meanAfterPhase1 {
		t.Errorf("mean did not shift toward new regime: %f", w.Mean)
	}
	// With alpha=0.1 and 100 samples of 150, mean should be very close to 150
	if math.Abs(w.Mean-150.0) > 5.0 {
		t.Errorf("mean = %f, want ~150.0 after regime change", w.Mean)
	}
}

func TestDistributionTracker_UpdateAndGet(t *testing.T) {
	dt := NewDistributionTracker(0.01)

	w := dt.Update("drone-1", "temperature", 25.0)
	if w.Count != 1 {
		t.Errorf("count = %d, want 1", w.Count)
	}
	if w.Mean != 25.0 {
		t.Errorf("mean = %f, want 25.0", w.Mean)
	}

	// Get returns same state
	w2 := dt.Get("drone-1", "temperature")
	if w2 != w {
		t.Error("Get returned different pointer than Update")
	}

	// Different source
	if dt.Get("drone-2", "temperature") != nil {
		t.Error("Get should return nil for unknown source")
	}

	// Different metric
	if dt.Get("drone-1", "pressure") != nil {
		t.Error("Get should return nil for unknown metric")
	}
}

func TestDistributionTracker_GetSourceMetrics(t *testing.T) {
	dt := NewDistributionTracker(0.01)
	dt.Update("drone-1", "temperature", 25.0)
	dt.Update("drone-1", "pressure", 1013.0)
	dt.Update("drone-2", "temperature", 30.0)

	metrics := dt.GetSourceMetrics("drone-1")
	if len(metrics) != 2 {
		t.Errorf("drone-1 metrics count = %d, want 2", len(metrics))
	}
	if metrics["temperature"] == nil {
		t.Error("missing temperature metric")
	}
	if metrics["pressure"] == nil {
		t.Error("missing pressure metric")
	}

	if dt.GetSourceMetrics("unknown") != nil {
		t.Error("GetSourceMetrics should return nil for unknown source")
	}
}
