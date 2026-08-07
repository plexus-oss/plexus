package main

import (
	"sync"
	"testing"
)

// minimalHub builds a Hub with only the in-memory fields AnnounceCamera needs.
func minimalHub() *Hub {
	return &Hub{
		deviceConns:  make(map[string]map[string]*DeviceConn),
		browserConns: make(map[string]map[*BrowserConn]struct{}),
		cameraSubs:   make(map[string]map[*BrowserConn]struct{}),
	}
}

func minimalConn(orgID, sourceID string) *DeviceConn {
	return &DeviceConn{
		orgID:    orgID,
		sourceID: sourceID,
		sendCh:   make(chan []byte, 8),
	}
}

func TestAnnounceCamera_AddsCamera(t *testing.T) {
	h := minimalHub()
	conn := minimalConn("org1", "dev1")

	h.AnnounceCamera(conn, "cam0", "normal")

	cameras, ok := conn.cameras.([]map[string]any)
	if !ok || len(cameras) != 1 {
		t.Fatalf("expected 1 camera, got %v", conn.cameras)
	}
	if cameras[0]["camera_id"] != "cam0" {
		t.Fatalf("unexpected camera_id: %v", cameras[0])
	}
}

func TestAnnounceCamera_VideoTypeStored(t *testing.T) {
	h := minimalHub()
	conn := minimalConn("org1", "dev1")

	h.AnnounceCamera(conn, "cam-thermal", "thermal")

	cameras := conn.cameras.([]map[string]any)
	if len(cameras) != 1 {
		t.Fatalf("expected 1 camera, got %d", len(cameras))
	}
	if cameras[0]["video_type"] != "thermal" {
		t.Fatalf("expected video_type=thermal, got %v", cameras[0]["video_type"])
	}
	if cameras[0]["camera_id"] != "cam-thermal" {
		t.Fatalf("unexpected camera_id: %v", cameras[0]["camera_id"])
	}
}

func TestAnnounceCamera_DuplicateIsNoop(t *testing.T) {
	h := minimalHub()
	conn := minimalConn("org1", "dev1")

	h.AnnounceCamera(conn, "cam0", "normal")
	h.AnnounceCamera(conn, "cam0", "normal")

	cameras := conn.cameras.([]map[string]any)
	if len(cameras) != 1 {
		t.Fatalf("expected 1 camera after duplicate announce, got %d", len(cameras))
	}
}

func TestAnnounceCamera_MultipleCamerasAccumulate(t *testing.T) {
	h := minimalHub()
	conn := minimalConn("org1", "dev1")

	h.AnnounceCamera(conn, "cam0", "normal")
	h.AnnounceCamera(conn, "cam1", "thermal")
	h.AnnounceCamera(conn, "cam2", "normal")

	cameras := conn.cameras.([]map[string]any)
	if len(cameras) != 3 {
		t.Fatalf("expected 3 cameras, got %d", len(cameras))
	}
}

func TestAnnounceCamera_MergesAuthDeclaredCameras(t *testing.T) {
	h := minimalHub()
	conn := minimalConn("org1", "dev1")
	// device_auth cameras arrive through json.Unmarshal into map[string]any,
	// so the array decodes as []any of map[string]any — not []map[string]any.
	conn.cameras = []any{
		map[string]any{"camera_id": "cam-auth", "video_type": "normal"},
	}

	// Announcing the auth-declared camera must be a no-op (the early return
	// leaves the original device_auth shape in place, hence normalizeCameras).
	h.AnnounceCamera(conn, "cam-auth", "normal")
	cameras := normalizeCameras(conn.cameras)
	if len(cameras) != 1 {
		t.Fatalf("expected auth-declared camera preserved without duplicate, got %v", conn.cameras)
	}

	// …and announcing a new camera must merge, not clobber, the auth list.
	h.AnnounceCamera(conn, "cam-new", "thermal")
	cameras = conn.cameras.([]map[string]any)
	if len(cameras) != 2 {
		t.Fatalf("expected auth-declared + announced cameras, got %v", conn.cameras)
	}
	if cameras[0]["camera_id"] != "cam-auth" || cameras[1]["camera_id"] != "cam-new" {
		t.Fatalf("unexpected camera merge order/content: %v", cameras)
	}
}

func TestRelayVideoFrame_ConcurrentSubscribeSafe(t *testing.T) {
	// Regression test for the fatal "concurrent map iteration and map write":
	// RelayVideoFrame used to capture the subs map under RLock but iterate it
	// after RUnlock while Subscribe/UnsubscribeCamera mutated it under Lock.
	// Run with -race (and without: map-iteration faults are runtime-fatal).
	h := minimalHub()

	newBrowser := func() *BrowserConn {
		return &BrowserConn{
			orgID:      "org1",
			subs:       BrowserSubs{Video: true},
			sendCh:     make(chan []byte, 128),
			lastSentNs: make(map[string]int64),
		}
	}

	stop := make(chan struct{})
	var wg sync.WaitGroup

	// Churn subscriptions until told to stop.
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			bc := newBrowser()
			for {
				select {
				case <-stop:
					return
				default:
				}
				h.SubscribeCamera(bc, "cam0")
				h.UnsubscribeCamera(bc, "cam0")
			}
		}()
	}

	// Relay frames concurrently from the test goroutine while churn runs.
	frame := []byte(`{"type":"video_frame"}`)
	for i := 0; i < 20_000; i++ {
		h.RelayVideoFrame("org1", "cam0", frame)
	}

	close(stop)
	wg.Wait()
}

func TestUnregisterBrowser_CleansEmptyCameraSubSets(t *testing.T) {
	h := minimalHub()
	// UnregisterBrowser records connection-gauge metrics; the nil-*Metrics
	// shortcut doesn't cover gauge helpers (their field arg is evaluated at
	// the call site), so wire a real registry here.
	h.metrics = NewMetrics()
	bc := &BrowserConn{
		orgID:      "org1",
		subs:       BrowserSubs{Video: true},
		sendCh:     make(chan []byte, 8),
		lastSentNs: make(map[string]int64),
	}
	h.browserConns["org1"] = map[*BrowserConn]struct{}{bc: {}}
	h.SubscribeCamera(bc, "cam0")
	h.SubscribeCamera(bc, "cam1")

	h.UnregisterBrowser(bc)

	h.mu.RLock()
	defer h.mu.RUnlock()
	if len(h.cameraSubs) != 0 {
		t.Fatalf("expected emptied camera-sub keys to be deleted, got %d keys", len(h.cameraSubs))
	}
}

func TestAnnounceCamera_ConcurrentSafe(t *testing.T) {
	h := minimalHub()
	conn := minimalConn("org1", "dev1")

	// Simulate two goroutines racing to announce the same camera (e.g. two
	// frames arriving simultaneously before seenCameras is checked).
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			h.AnnounceCamera(conn, "cam0", "normal")
		}()
	}
	wg.Wait()

	cameras := conn.cameras.([]map[string]any)
	if len(cameras) != 1 {
		t.Fatalf("expected exactly 1 camera after concurrent announces, got %d", len(cameras))
	}
}
