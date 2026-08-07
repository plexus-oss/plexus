package main

// Stateless rule evaluation engine.
//
// Each function takes a value (and optionally a distribution or latest
// values map) and returns an EvalDetail indicating whether the rule
// triggered. No side effects, no state — the caller (OrgConsumer)
// feeds results into the AlertStateManager.

import (
	"fmt"
	"math"
)

// EvalDetail is the result of evaluating a single rule against a value.
type EvalDetail struct {
	Triggered bool
	Value     float64
	Threshold *float64 // which bound was violated (threshold rules)
	ZScore    *float64 // computed z-score (outlier rules)
	Reason    string
}

// EvalThreshold checks whether value is outside [min, max] bounds.
// nil min/max means no bound on that side.
func EvalThreshold(value float64, cond RuleConditions) EvalDetail {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return EvalDetail{Value: value, Reason: "non-numeric value"}
	}
	if cond.Min != nil && value < *cond.Min {
		return EvalDetail{
			Triggered: true,
			Value:     value,
			Threshold: cond.Min,
			Reason:    fmt.Sprintf("%.4g below minimum %.4g", value, *cond.Min),
		}
	}
	if cond.Max != nil && value > *cond.Max {
		return EvalDetail{
			Triggered: true,
			Value:     value,
			Threshold: cond.Max,
			Reason:    fmt.Sprintf("%.4g above maximum %.4g", value, *cond.Max),
		}
	}
	return EvalDetail{Value: value}
}

// EvalOutlier checks whether value is a statistical outlier based on
// the running distribution. Returns not-triggered if the distribution
// has insufficient samples.
func EvalOutlier(value float64, dist *WelfordState, cond RuleConditions, defaultMinSamples int) EvalDetail {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return EvalDetail{Value: value, Reason: "non-numeric value"}
	}
	if dist == nil {
		return EvalDetail{Value: value, Reason: "no distribution data"}
	}

	minSamples := defaultMinSamples
	if cond.MinSamples != nil {
		minSamples = *cond.MinSamples
	}

	zThreshold := 3.0
	if cond.ZScore != nil {
		zThreshold = *cond.ZScore
	}

	if dist.Count < int64(minSamples) {
		return EvalDetail{
			Value:  value,
			Reason: fmt.Sprintf("insufficient samples (%d/%d)", dist.Count, minSamples),
		}
	}

	z := dist.ZScore(value, minSamples)
	absZ := math.Abs(z)

	if absZ > zThreshold {
		return EvalDetail{
			Triggered: true,
			Value:     value,
			ZScore:    &absZ,
			Reason:    fmt.Sprintf("z-score %.2f exceeds threshold %.1f", absZ, zThreshold),
		}
	}
	return EvalDetail{Value: value, ZScore: &absZ}
}

// EvalCompound evaluates a compound rule by checking each sub-rule
// against the latest known values for the same source and combining
// results with the specified operator (AND/OR).
//
// latestValues: metric -> most recent value for this source.
// dists: metric -> distribution state for this source.
func EvalCompound(rule AlertRule, latestValues map[string]float64, dists map[string]*WelfordState, defaultMinSamples int) EvalDetail {
	if len(rule.SubRules) == 0 {
		return EvalDetail{Reason: "compound rule has no sub-rules"}
	}

	results := make([]bool, 0, len(rule.SubRules))
	reasons := make([]string, 0, len(rule.SubRules))

	for _, sub := range rule.SubRules {
		val, ok := latestValues[sub.Metric]
		if !ok {
			results = append(results, false)
			reasons = append(reasons, fmt.Sprintf("%s: no data", sub.Metric))
			continue
		}

		var detail EvalDetail
		switch sub.Type {
		case RuleThreshold:
			detail = EvalThreshold(val, sub.Conditions)
		case RuleOutlier:
			var dist *WelfordState
			if dists != nil {
				dist = dists[sub.Metric]
			}
			detail = EvalOutlier(val, dist, sub.Conditions, defaultMinSamples)
		default:
			results = append(results, false)
			reasons = append(reasons, fmt.Sprintf("%s: unknown sub-rule type %q", sub.Metric, sub.Type))
			continue
		}

		results = append(results, detail.Triggered)
		if detail.Reason != "" {
			reasons = append(reasons, fmt.Sprintf("%s: %s", sub.Metric, detail.Reason))
		}
	}

	var triggered bool
	switch rule.Operator {
	case "and":
		triggered = true
		for _, r := range results {
			if !r {
				triggered = false
				break
			}
		}
	case "or":
		for _, r := range results {
			if r {
				triggered = true
				break
			}
		}
	default:
		return EvalDetail{Reason: fmt.Sprintf("unknown operator %q", rule.Operator)}
	}

	reason := ""
	if triggered {
		reason = fmt.Sprintf("compound %s: all conditions met", rule.Operator)
		if rule.Operator == "or" {
			reason = fmt.Sprintf("compound %s: at least one condition met", rule.Operator)
		}
	}

	return EvalDetail{
		Triggered: triggered,
		Reason:    reason,
	}
}
