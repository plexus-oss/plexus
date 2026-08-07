package main

import (
	"encoding/json"
	"testing"
)

// unmarshalMsg decodes a wire-shaped JSON message the way deviceReadLoop does,
// so tests exercise the same concrete types (float64, []any, map[string]any).
func unmarshalMsg(t *testing.T, raw string) map[string]any {
	t.Helper()
	var msg map[string]any
	if err := json.Unmarshal([]byte(raw), &msg); err != nil {
		t.Fatalf("test message unmarshal: %v", err)
	}
	return msg
}

func pointAt(t *testing.T, msg map[string]any, i int) map[string]any {
	t.Helper()
	points, ok := msg["points"].([]any)
	if !ok || len(points) <= i {
		t.Fatalf("points[%d] missing: %v", i, msg["points"])
	}
	pt, ok := points[i].(map[string]any)
	if !ok {
		t.Fatalf("points[%d] not an object: %v", i, points[i])
	}
	return pt
}

// The C SDK WS serializer (plexus_json.c) emits telemetry points without a
// "class" field. The WS path must infer it like HTTP /ingest does so those
// frames validate and land with the inferred class.
func TestInferTelemetryPointClasses_ClasslessWSPointAccepted(t *testing.T) {
	v := testValidator()
	msg := unmarshalMsg(t, `{"type":"telemetry","points":[
		{"metric":"battery.pct","value":87.5,"timestamp":1753600000000},
		{"metric":"status","value":"armed"}
	]}`)

	// Without inference the validator rejects the frame outright.
	if _, err := v.ValidateMessage(msg); err == nil {
		t.Fatal("precondition failed: class-less point unexpectedly passed validation")
	}

	inferTelemetryPointClasses(msg)

	msgType, err := v.ValidateMessage(msg)
	if err != nil {
		t.Fatalf("class-less WS telemetry rejected after inference: %v", err)
	}
	if msgType != "telemetry" {
		t.Fatalf("expected telemetry, got %q", msgType)
	}
	if got := pointAt(t, msg, 0)["class"]; got != "metric" {
		t.Fatalf("numeric value should infer class=metric, got %v", got)
	}
	if got := pointAt(t, msg, 1)["class"]; got != "event" {
		t.Fatalf("string value should infer class=event, got %v", got)
	}
}

func TestInferTelemetryPointClasses_ExplicitClassPreserved(t *testing.T) {
	msg := unmarshalMsg(t, `{"type":"telemetry","points":[
		{"metric":"gps.fix","value":3,"class":"event"}
	]}`)

	inferTelemetryPointClasses(msg)

	if got := pointAt(t, msg, 0)["class"]; got != "event" {
		t.Fatalf("explicit class must not be overwritten, got %v", got)
	}
}

func TestInferTelemetryPointClasses_InvalidExplicitClassStillRejected(t *testing.T) {
	v := testValidator()
	msg := unmarshalMsg(t, `{"type":"telemetry","points":[
		{"metric":"battery.pct","value":87.5,"class":"metrics"}
	]}`)

	inferTelemetryPointClasses(msg)

	if _, err := v.ValidateMessage(msg); err == nil {
		t.Fatal("invalid explicit class should still be rejected")
	}
}

func TestInferTelemetryPointClasses_MalformedShapesUntouched(t *testing.T) {
	// Non-object points and a non-array points field must not panic and are
	// left for the validator to reject.
	inferTelemetryPointClasses(unmarshalMsg(t, `{"type":"telemetry","points":["nope",42]}`))
	inferTelemetryPointClasses(unmarshalMsg(t, `{"type":"telemetry","points":"nope"}`))
	inferTelemetryPointClasses(unmarshalMsg(t, `{"type":"telemetry"}`))
}
