package main

// Message validation — struct and point validation shared between WS and HTTP ingest paths.
// Limits come from LimitsConfig so they can be tuned without recompiling.

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
)

// sourceIDPattern mirrors the frontend slug check at
// frontend/app/api/sources/register/route.ts so clients see the same rules
// whether they register via the UI or push directly to the gateway.
var sourceIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]*$`)

// Validator wraps message validation with configurable limits.
type Validator struct {
	cfg LimitsConfig
}

func NewValidator(cfg LimitsConfig) *Validator {
	return &Validator{cfg: cfg}
}

// ValidateMessage checks a parsed message against the configured limits.
// Returns the message type on success.
func (v *Validator) ValidateMessage(msg map[string]any) (string, error) {
	t, ok := msg["type"].(string)
	if !ok || t == "" {
		return "", fmt.Errorf("type must be a string")
	}
	if len(t) > 64 {
		return "", fmt.Errorf("type too long")
	}

	switch t {
	case "device_auth":
		if err := v.checkSourceID(msg, "source_id"); err != nil {
			return "", err
		}
		_, hasKey := msg["api_key"].(string)
		if !hasKey {
			return "", fmt.Errorf("api_key required")
		}
		return t, nil

	case "telemetry":
		points, ok := msg["points"].([]any)
		if !ok {
			return "", fmt.Errorf("points must be an array")
		}
		if err := v.ValidatePoints(points); err != nil {
			return "", err
		}
		return t, nil

	case "video_frame":
		if _, ok := msg["camera_id"].(string); !ok {
			return "", fmt.Errorf("camera_id must be a string")
		}
		if _, ok := msg["frame"].(string); !ok {
			return "", fmt.Errorf("frame must be a string")
		}
		return t, nil

	case "heartbeat", "device_error", "pong", "command_result":
		return t, nil

	default:
		return "", fmt.Errorf("unknown message type")
	}
}

// ValidatePoints validates a telemetry points array. Shared between the WS
// "telemetry" message path and the HTTP /ingest handler so both paths enforce
// identical per-point rules. Caller is responsible for resolving envelope-level
// fields (source_id, trace_id) — this only validates point shape.
func (v *Validator) ValidatePoints(points []any) error {
	if len(points) > v.cfg.MaxPointsPerBatch {
		return fmt.Errorf("points array exceeds max size (%d)", v.cfg.MaxPointsPerBatch)
	}
	for i, p := range points {
		if err := v.ValidatePoint(i, p); err != nil {
			return err
		}
	}
	return nil
}

// ValidatePoint validates a single point at the caller's index. Exported so
// streaming callers (HTTP /ingest) can validate while iterating for other
// purposes — normalization, source_id resolution — and avoid a second pass.
// The batch-size ceiling is enforced by ValidatePoints; callers that use
// this directly must bound len(points) themselves.
func (v *Validator) ValidatePoint(i int, p any) error {
	pt, ok := p.(map[string]any)
	if !ok {
		return fmt.Errorf("points[%d] must be an object", i)
	}
	cls, ok := pt["class"].(string)
	if !ok {
		return fmt.Errorf("points[%d].class is required", i)
	}
	if cls != "metric" && cls != "event" {
		return fmt.Errorf("points[%d].class must be 'metric' or 'event', got %q", i, cls)
	}
	m, ok := pt["metric"].(string)
	if !ok || len(m) == 0 || len(m) > v.cfg.MaxStringLen {
		return fmt.Errorf("points[%d].metric invalid", i)
	}
	rawVal, exists := pt["value"]
	if !exists {
		return fmt.Errorf("points[%d].value is required", i)
	}
	if err := v.validatePointValue(i, cls, rawVal); err != nil {
		return err
	}
	if ts, ok := pt["timestamp"]; ok {
		if err := v.validateTimestamp(i, ts); err != nil {
			return err
		}
	}
	if tags, ok := pt["tags"]; ok {
		if err := v.validateTags(i, tags); err != nil {
			return err
		}
	}
	return nil
}

// checkSourceID enforces length + slug format. Callers that already have the
// string in hand (e.g. HTTP ingest) should use ValidateSourceID instead.
func (v *Validator) checkSourceID(msg map[string]any, field string) error {
	s, ok := msg[field].(string)
	if !ok {
		return fmt.Errorf("%s must be a string", field)
	}
	return v.ValidateSourceID(s)
}

// ValidateSourceID enforces length + slug format. Empty strings are rejected.
func (v *Validator) ValidateSourceID(s string) error {
	if s == "" {
		return fmt.Errorf("source_id is required")
	}
	if len(s) > v.cfg.MaxStringLen {
		return fmt.Errorf("source_id exceeds max length (%d)", v.cfg.MaxStringLen)
	}
	if !sourceIDPattern.MatchString(s) {
		return fmt.Errorf("source_id must match %s", sourceIDPattern.String())
	}
	return nil
}

// validatePointValue enforces the shape of a point's `value` field.
//
//   - Metrics must be numeric and finite. JSON numbers decode as float64,
//     but we also accept int/int64 for callers that construct messages
//     directly in Go (e.g. tests, in-process emitters).
//   - Events accept arbitrary JSON shapes (strings, numbers, bools,
//     objects, arrays) because events legitimately carry structured data
//     like GPS fixes, log objects, and state transitions. We only bound
//     the serialized byte size so a single point can't smuggle a 1 MB
//     payload through the pipeline all the way to dashboards.
//
// In both cases, explicit null is rejected.
func (v *Validator) validatePointValue(i int, class string, raw any) error {
	if raw == nil {
		return fmt.Errorf("points[%d].value cannot be null", i)
	}
	switch class {
	case "metric":
		var n float64
		switch x := raw.(type) {
		case float64:
			n = x
		case int:
			n = float64(x)
		case int64:
			n = float64(x)
		default:
			return fmt.Errorf("points[%d].value must be a number for class=metric", i)
		}
		if math.IsNaN(n) || math.IsInf(n, 0) {
			return fmt.Errorf("points[%d].value must be finite", i)
		}
		return nil
	case "event":
		// Scalars are bounded by MaxStringLen / numeric range and can't
		// exceed MaxValueBytes after JSON encoding, so we skip the trial
		// Marshal for them. Only nested shapes (objects/arrays) need the
		// byte-size check. This halves per-point validator cost for the
		// common case of log-line and status-string events.
		switch x := raw.(type) {
		case string:
			if len(x) > v.cfg.MaxStringLen {
				return fmt.Errorf("points[%d].value string exceeds max length (%d)", i, v.cfg.MaxStringLen)
			}
			return nil
		case bool, float64, float32, int, int32, int64, json.Number:
			return nil
		case map[string]any, []any:
			buf, err := json.Marshal(raw)
			if err != nil {
				return fmt.Errorf("points[%d].value not serializable: %w", i, err)
			}
			if v.cfg.MaxValueBytes > 0 && len(buf) > v.cfg.MaxValueBytes {
				return fmt.Errorf("points[%d].value exceeds max bytes (%d)", i, v.cfg.MaxValueBytes)
			}
			return nil
		default:
			return fmt.Errorf("points[%d].value has unsupported type for class=event", i)
		}
	}
	// Unreachable: class is checked by the caller.
	return fmt.Errorf("points[%d]: unknown class %q", i, class)
}

// validateTimestamp requires a finite number if present. Accepts
// float64/int/int64 for the same reason as validatePointValue.
func (v *Validator) validateTimestamp(i int, raw any) error {
	var n float64
	switch x := raw.(type) {
	case float64:
		n = x
	case int:
		n = float64(x)
	case int64:
		n = float64(x)
	default:
		return fmt.Errorf("points[%d].timestamp must be a number", i)
	}
	if math.IsNaN(n) || math.IsInf(n, 0) {
		return fmt.Errorf("points[%d].timestamp must be finite", i)
	}
	return nil
}

// validateTags enforces a flat string→string map bounded by
// MaxTagsPerPoint entries. Nested tag objects are rejected so the
// dashboard can trust tag shape without runtime type checks per point.
func (v *Validator) validateTags(i int, raw any) error {
	m, ok := raw.(map[string]any)
	if !ok {
		return fmt.Errorf("points[%d].tags must be an object", i)
	}
	if v.cfg.MaxTagsPerPoint > 0 && len(m) > v.cfg.MaxTagsPerPoint {
		return fmt.Errorf("points[%d].tags exceeds max entries (%d)", i, v.cfg.MaxTagsPerPoint)
	}
	for k, val := range m {
		if len(k) > v.cfg.MaxStringLen {
			return fmt.Errorf("points[%d].tags key too long", i)
		}
		s, ok := val.(string)
		if !ok {
			return fmt.Errorf("points[%d].tags[%q] must be a string", i, k)
		}
		if len(s) > v.cfg.MaxStringLen {
			return fmt.Errorf("points[%d].tags[%q] value too long", i, k)
		}
	}
	return nil
}
