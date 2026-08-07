package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func testAuthConfig(url string) AuthConfig {
	return AuthConfig{
		APIURL:           url,
		HTTPTimeout:      2 * time.Second,
		CacheTTL:         60 * time.Second,
		NegativeCacheTTL: 10 * time.Second,
		MaxResponseBytes: 4096,
	}
}

func TestAuthClient_DevMode_VerifyAPIKey(t *testing.T) {
	client := NewAuthClient(AuthConfig{}, true, "dev-org")
	res, err := client.VerifyAPIKey(context.Background(), "anything")
	if err != nil {
		t.Fatalf("dev mode should not fail: %v", err)
	}
	if res.OrgID != "dev-org" {
		t.Errorf("expected dev-org, got %q", res.OrgID)
	}
}

func TestAuthClient_DevMode_VerifySession(t *testing.T) {
	client := NewAuthClient(AuthConfig{}, true, "dev-org")
	res, err := client.VerifySession(context.Background(), "anything")
	if err != nil {
		t.Fatalf("dev mode should not fail: %v", err)
	}
	if res.OrgID != "dev-org" || res.UserID != "dev-user" {
		t.Errorf("unexpected dev result: %+v", res)
	}
}

func TestAuthClient_VerifyAPIKey_Success(t *testing.T) {
	var hits int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		if r.URL.Path != "/api/auth/verify-key" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Header.Get("x-api-key") != "plx_test" {
			t.Errorf("missing x-api-key header: %s", r.Header.Get("x-api-key"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"org_id":"org-abc"}`))
	}))
	defer server.Close()

	client := NewAuthClient(testAuthConfig(server.URL), false, "")

	// First call hits HTTP.
	res, err := client.VerifyAPIKey(context.Background(), "plx_test")
	if err != nil {
		t.Fatalf("verify failed: %v", err)
	}
	if res.OrgID != "org-abc" {
		t.Errorf("expected org-abc, got %q", res.OrgID)
	}
	if atomic.LoadInt32(&hits) != 1 {
		t.Errorf("expected 1 HTTP hit, got %d", atomic.LoadInt32(&hits))
	}

	// Second call should hit the cache.
	res, err = client.VerifyAPIKey(context.Background(), "plx_test")
	if err != nil {
		t.Fatalf("cached verify failed: %v", err)
	}
	if res.OrgID != "org-abc" {
		t.Errorf("cached result wrong: %q", res.OrgID)
	}
	if atomic.LoadInt32(&hits) != 1 {
		t.Errorf("cache missed: %d HTTP hits", atomic.LoadInt32(&hits))
	}
}

func TestAuthClient_VerifyAPIKey_NegativeCache(t *testing.T) {
	// Failed auths get cached with a short TTL to prevent DDoS.
	var hits int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(401)
	}))
	defer server.Close()

	client := NewAuthClient(testAuthConfig(server.URL), false, "")

	// First call — fetches, fails, caches.
	_, err := client.VerifyAPIKey(context.Background(), "plx_bad")
	if err == nil {
		t.Fatal("expected error for bad key")
	}

	// Second call — should hit negative cache.
	_, err = client.VerifyAPIKey(context.Background(), "plx_bad")
	if err == nil {
		t.Fatal("expected cached error")
	}
	if !strings.Contains(err.Error(), "cached") {
		t.Errorf("expected cached error message, got: %v", err)
	}

	if atomic.LoadInt32(&hits) != 1 {
		t.Errorf("negative cache missed: %d HTTP hits", atomic.LoadInt32(&hits))
	}
}

func TestAuthClient_VerifyAPIKey_ResponseSizeLimit(t *testing.T) {
	// A malicious auth server returning a huge body should be truncated.
	huge := strings.Repeat("a", 100_000) // 100KB blob
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"org_id":"` + huge + `"}`))
	}))
	defer server.Close()

	client := NewAuthClient(testAuthConfig(server.URL), false, "")

	// Should fail to parse because the body is truncated at 4KB.
	_, err := client.VerifyAPIKey(context.Background(), "plx_test")
	if err == nil {
		t.Fatal("expected parse error from truncated body")
	}
}

func TestAuthClient_VerifySession_Success(t *testing.T) {
	var hits int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		if r.URL.Path != "/api/auth/verify-session" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Errorf("missing bearer token: %s", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"org_id":"org-xyz","user_id":"user-123"}`))
	}))
	defer server.Close()

	client := NewAuthClient(testAuthConfig(server.URL), false, "")

	res, err := client.VerifySession(context.Background(), "test-token")
	if err != nil {
		t.Fatalf("verify failed: %v", err)
	}
	if res.OrgID != "org-xyz" || res.UserID != "user-123" {
		t.Errorf("wrong result: %+v", res)
	}

	// Second call should hit cache.
	_, _ = client.VerifySession(context.Background(), "test-token")
	if atomic.LoadInt32(&hits) != 1 {
		t.Errorf("session cache missed: %d HTTP hits", atomic.LoadInt32(&hits))
	}
}

func TestAuthClient_HTTPTimeout(t *testing.T) {
	// Server that hangs past the client timeout.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(3 * time.Second) // longer than 500ms client timeout below
		w.WriteHeader(200)
	}))
	defer server.Close()

	cfg := testAuthConfig(server.URL)
	cfg.HTTPTimeout = 500 * time.Millisecond
	client := NewAuthClient(cfg, false, "")

	start := time.Now()
	_, err := client.VerifyAPIKey(context.Background(), "plx_test")
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("expected timeout error")
	}
	if elapsed > 2*time.Second {
		t.Errorf("timeout took too long: %s", elapsed)
	}
}

func TestAuthClient_CacheExpiry(t *testing.T) {
	// A very short CacheTTL should cause a second call to refetch.
	var hits int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"org_id":"org-abc"}`))
	}))
	defer server.Close()

	cfg := testAuthConfig(server.URL)
	cfg.CacheTTL = 20 * time.Millisecond
	client := NewAuthClient(cfg, false, "")

	_, _ = client.VerifyAPIKey(context.Background(), "plx_test")
	if atomic.LoadInt32(&hits) != 1 {
		t.Fatalf("first call: expected 1 hit, got %d", atomic.LoadInt32(&hits))
	}

	// Wait out the TTL.
	time.Sleep(30 * time.Millisecond)

	_, _ = client.VerifyAPIKey(context.Background(), "plx_test")
	if atomic.LoadInt32(&hits) != 2 {
		t.Errorf("expected cache expiry to trigger refetch, got %d hits", atomic.LoadInt32(&hits))
	}
}
