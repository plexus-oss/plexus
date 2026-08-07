package main

import (
	"strings"
	"testing"
)

func testValidator() *Validator {
	return NewValidator(LimitsConfig{
		MaxMessageSize:    1_048_576,
		MaxPointsPerBatch: 10_000,
		MaxStringLen:      256,
		MaxValueBytes:     4_096,
		MaxTagsPerPoint:   16,
	})
}

func TestValidator_MissingType(t *testing.T) {
	v := testValidator()
	_, err := v.ValidateMessage(map[string]any{})
	if err == nil {
		t.Fatal("expected error for missing type")
	}
}

func TestValidator_TypeWrongKind(t *testing.T) {
	v := testValidator()
	_, err := v.ValidateMessage(map[string]any{"type": 42})
	if err == nil {
		t.Fatal("expected error for non-string type")
	}
}

func TestValidator_TypeTooLong(t *testing.T) {
	v := testValidator()
	longType := strings.Repeat("a", 65)
	_, err := v.ValidateMessage(map[string]any{"type": longType})
	if err == nil {
		t.Fatal("expected error for type > 64 chars")
	}
}

func TestValidator_UnknownType(t *testing.T) {
	v := testValidator()
	_, err := v.ValidateMessage(map[string]any{"type": "made_up"})
	if err == nil {
		t.Fatal("expected error for unknown type")
	}
}

func TestValidator_DeviceAuth_Valid(t *testing.T) {
	v := testValidator()
	msgType, err := v.ValidateMessage(map[string]any{
		"type":      "device_auth",
		"api_key":   "plx_test",
		"source_id": "device-001",
	})
	if err != nil || msgType != "device_auth" {
		t.Fatalf("valid device_auth rejected: type=%q err=%v", msgType, err)
	}
}

func TestValidator_DeviceAuth_MissingKey(t *testing.T) {
	v := testValidator()
	_, err := v.ValidateMessage(map[string]any{
		"type":      "device_auth",
		"source_id": "device-001",
	})
	if err == nil {
		t.Fatal("expected error for missing api_key")
	}
}

func TestValidator_DeviceAuth_MissingSourceID(t *testing.T) {
	v := testValidator()
	_, err := v.ValidateMessage(map[string]any{
		"type":    "device_auth",
		"api_key": "plx_test",
	})
	if err == nil {
		t.Fatal("expected error for missing source_id")
	}
}

func TestValidator_DeviceAuth_SourceIDTooLong(t *testing.T) {
	v := testValidator()
	_, err := v.ValidateMessage(map[string]any{
		"type":      "device_auth",
		"api_key":   "plx_test",
		"source_id": strings.Repeat("a", 257),
	})
	if err == nil {
		t.Fatal("expected error for oversized source_id")
	}
}

func TestValidator_Telemetry_Valid(t *testing.T) {
	v := testValidator()
	msgType, err := v.ValidateMessage(map[string]any{
		"type": "telemetry",
		"points": []any{
			map[string]any{"class": "metric", "metric": "temp", "value": 22.5},
			map[string]any{"class": "metric", "metric": "humidity", "value": 45},
		},
	})
	if err != nil || msgType != "telemetry" {
		t.Fatalf("valid telemetry rejected: type=%q err=%v", msgType, err)
	}
}

func TestValidator_Telemetry_EventValuesAnyType(t *testing.T) {
	v := testValidator()
	msgType, err := v.ValidateMessage(map[string]any{
		"type": "telemetry",
		"points": []any{
			map[string]any{"class": "event", "metric": "app.log", "value": "user signed in"},
			map[string]any{"class": "event", "metric": "feature.enabled", "value": true},
			map[string]any{"class": "event", "metric": "gps.status", "value": map[string]any{"fix": "lost", "sats": 3}},
		},
	})
	if err != nil || msgType != "telemetry" {
		t.Fatalf("valid event telemetry rejected: type=%q err=%v", msgType, err)
	}
}

func TestValidator_Telemetry_PointMissingClass(t *testing.T) {
	v := testValidator()
	_, err := v.ValidateMessage(map[string]any{
		"type": "telemetry",
		"points": []any{
			map[string]any{"metric": "temp", "value": 22.5},
		},
	})
	if err == nil {
		t.Fatal("expected error for point missing class")
	}
}

func TestValidator_Telemetry_PointBlobClassRejected(t *testing.T) {
	v := testValidator()
	_, err := v.ValidateMessage(map[string]any{
		"type": "telemetry",
		"points": []any{
			map[string]any{"class": "blob", "metric": "snapshot", "value": "s3://..."},
		},
	})
	if err == nil {
		t.Fatal("expected error for class=blob (no handler yet)")
	}
}

func TestValidator_Telemetry_PointUnknownClassRejected(t *testing.T) {
	v := testValidator()
	_, err := v.ValidateMessage(map[string]any{
		"type": "telemetry",
		"points": []any{
			map[string]any{"class": "evnt", "metric": "temp", "value": 1},
		},
	})
	if err == nil {
		t.Fatal("expected error for unknown class (typo)")
	}
}

func TestValidator_Telemetry_PointsNotArray(t *testing.T) {
	v := testValidator()
	_, err := v.ValidateMessage(map[string]any{
		"type":   "telemetry",
		"points": "not-an-array",
	})
	if err == nil {
		t.Fatal("expected error for non-array points")
	}
}

func TestValidator_Telemetry_TooManyPoints(t *testing.T) {
	v := testValidator()
	points := make([]any, 10_001)
	for i := range points {
		points[i] = map[string]any{"class": "metric", "metric": "x", "value": 1}
	}
	_, err := v.ValidateMessage(map[string]any{
		"type":   "telemetry",
		"points": points,
	})
	if err == nil {
		t.Fatal("expected error for >max points")
	}
}

func TestValidator_Telemetry_PointMissingValue(t *testing.T) {
	v := testValidator()
	_, err := v.ValidateMessage(map[string]any{
		"type": "telemetry",
		"points": []any{
			map[string]any{"class": "metric", "metric": "temp"}, // no value
		},
	})
	if err == nil {
		t.Fatal("expected error for point missing value")
	}
}

func TestValidator_Telemetry_PointMetricTooLong(t *testing.T) {
	v := testValidator()
	_, err := v.ValidateMessage(map[string]any{
		"type": "telemetry",
		"points": []any{
			map[string]any{"class": "metric", "metric": strings.Repeat("m", 257), "value": 1},
		},
	})
	if err == nil {
		t.Fatal("expected error for oversized metric name")
	}
}

func TestValidator_Telemetry_PointNotObject(t *testing.T) {
	v := testValidator()
	_, err := v.ValidateMessage(map[string]any{
		"type":   "telemetry",
		"points": []any{"not-an-object"},
	})
	if err == nil {
		t.Fatal("expected error for non-object point")
	}
}

func TestValidator_VideoFrame_Valid(t *testing.T) {
	v := testValidator()
	msgType, err := v.ValidateMessage(map[string]any{
		"type":      "video_frame",
		"camera_id": "cam-0",
		"frame":     "base64data",
	})
	if err != nil || msgType != "video_frame" {
		t.Fatalf("valid video_frame rejected: type=%q err=%v", msgType, err)
	}
}

func TestValidator_VideoFrame_MissingCameraID(t *testing.T) {
	v := testValidator()
	_, err := v.ValidateMessage(map[string]any{
		"type":  "video_frame",
		"frame": "base64data",
	})
	if err == nil {
		t.Fatal("expected error for missing camera_id")
	}
}

func TestValidator_VideoFrame_MissingFrame(t *testing.T) {
	v := testValidator()
	_, err := v.ValidateMessage(map[string]any{
		"type":      "video_frame",
		"camera_id": "cam-0",
	})
	if err == nil {
		t.Fatal("expected error for missing frame")
	}
}

func TestValidator_PassthroughTypes(t *testing.T) {
	// ValidateMessage runs only on the device read path (device.go), so the
	// passthrough set is device→gateway message types that accept minimal
	// shape. Browser/command types (start_stream, configure, ping, …) are NOT
	// device messages and must be rejected here — see TestValidator_RejectsBrowserTypes.
	v := testValidator()
	passthroughs := []string{
		"heartbeat", "device_error", "pong", "command_result",
	}
	for _, tp := range passthroughs {
		msgType, err := v.ValidateMessage(map[string]any{"type": tp})
		if err != nil {
			t.Errorf("%s: rejected valid message: %v", tp, err)
		}
		if msgType != tp {
			t.Errorf("%s: wrong type returned: %q", tp, msgType)
		}
	}
}

// TestValidator_RejectsBrowserTypes locks in the security narrowing from
// commit 8f54cbd: a device must not be able to send browser/command message
// types through the device read path. These are handled entirely on the
// browser side (browser.go), never validated as device messages.
func TestValidator_RejectsBrowserTypes(t *testing.T) {
	v := testValidator()
	rejected := []string{
		"browser_auth", "subscribe",
		"start_stream", "stop_stream",
		"start_camera", "stop_camera",
		"start_can", "stop_can",
		"start_mavlink", "stop_mavlink",
		"configure", "configure_camera",
		"ping",
	}
	for _, tp := range rejected {
		if _, err := v.ValidateMessage(map[string]any{"type": tp}); err == nil {
			t.Errorf("%s: expected rejection on device path, got nil error", tp)
		}
	}
}
