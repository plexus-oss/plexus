package main

// Exponentially weighted Welford's online algorithm for running statistics.
//
// Each (source, metric) pair gets a WelfordState that tracks count, mean,
// and variance with exponential decay. Recent values have more influence
// than historical ones — a sensor that drifts over hours will shift the
// distribution toward current behavior.
//
// Standard Welford's treats all samples equally. We add a decay factor
// (alpha) that blends each new value in with weight alpha and retains
// existing stats with weight (1-alpha). This gives us an exponentially
// weighted moving average/variance without storing raw samples.

import "math"

// WelfordState holds the running statistics for a single (source, metric).
// Updated O(1) per point, ~40 bytes per instance.
type WelfordState struct {
	Count int64   // total points seen (for min_samples gating)
	Mean  float64 // exponentially weighted mean
	M2    float64 // exponentially weighted variance estimate
	Alpha float64 // decay factor: higher = faster adaptation
}

// NewWelfordState creates a new tracker with the given decay factor.
func NewWelfordState(alpha float64) *WelfordState {
	return &WelfordState{Alpha: alpha}
}

// Update adds a new value to the running statistics.
//
// For the first sample, mean is set directly. For subsequent samples,
// we use exponentially weighted update:
//
//	diff = value - mean
//	mean += alpha * diff
//	M2   = (1-alpha) * (M2 + alpha * diff^2)
//
// This converges to the exponentially weighted variance. The Count
// tracks total observations for min_samples gating only — it does not
// affect the statistical calculation.
func (w *WelfordState) Update(value float64) {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return
	}

	w.Count++

	if w.Count == 1 {
		w.Mean = value
		w.M2 = 0
		return
	}

	diff := value - w.Mean
	w.Mean += w.Alpha * diff
	w.M2 = (1 - w.Alpha) * (w.M2 + w.Alpha*diff*diff)
}

// Variance returns the current exponentially weighted variance.
// Returns 0 if fewer than 2 samples have been seen.
func (w *WelfordState) Variance() float64 {
	if w.Count < 2 {
		return 0
	}
	return w.M2
}

// StdDev returns the exponentially weighted standard deviation.
func (w *WelfordState) StdDev() float64 {
	return math.Sqrt(w.Variance())
}

// ZScore computes how many standard deviations value is from the mean.
// Returns 0 if stddev is zero or count is below minSamples.
func (w *WelfordState) ZScore(value float64, minSamples int) float64 {
	if w.Count < int64(minSamples) {
		return 0
	}
	sd := w.StdDev()
	if sd == 0 {
		return 0
	}
	return (value - w.Mean) / sd
}

// Snapshot returns a serializable copy of the current state.
func (w *WelfordState) Snapshot() DistSnapshot {
	return DistSnapshot{
		Mean:   w.Mean,
		StdDev: w.StdDev(),
		Count:  w.Count,
	}
}

// DistSnapshot is a point-in-time copy of distribution statistics,
// included in transition payloads to Next.js.
type DistSnapshot struct {
	Mean   float64 `json:"mean"`
	StdDev float64 `json:"stddev"`
	Count  int64   `json:"count"`
}

// DistributionTracker holds per-(source, metric) running statistics
// for a single org. Owned by the org's consumer goroutine — no locking
// needed (goroutine-confined).
type DistributionTracker struct {
	alpha    float64
	bySource map[string]map[string]*WelfordState
}

func NewDistributionTracker(alpha float64) *DistributionTracker {
	return &DistributionTracker{
		alpha:    alpha,
		bySource: make(map[string]map[string]*WelfordState),
	}
}

// Update records a new value for a (source, metric) pair and returns
// the updated state.
func (dt *DistributionTracker) Update(sourceID, metric string, value float64) *WelfordState {
	metrics, ok := dt.bySource[sourceID]
	if !ok {
		metrics = make(map[string]*WelfordState)
		dt.bySource[sourceID] = metrics
	}

	w, ok := metrics[metric]
	if !ok {
		w = NewWelfordState(dt.alpha)
		metrics[metric] = w
	}

	w.Update(value)
	return w
}

// Get returns the distribution state for a (source, metric) or nil.
func (dt *DistributionTracker) Get(sourceID, metric string) *WelfordState {
	if metrics, ok := dt.bySource[sourceID]; ok {
		return metrics[metric]
	}
	return nil
}

// GetSourceMetrics returns all metric distributions for a source.
// Used by compound rule evaluation.
func (dt *DistributionTracker) GetSourceMetrics(sourceID string) map[string]*WelfordState {
	return dt.bySource[sourceID]
}
