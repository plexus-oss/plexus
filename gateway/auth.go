package main

// Auth verification — calls Next.js API endpoints, caches results.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"
)

type AuthResult struct {
	OrgID  string `json:"org_id"`
	UserID string `json:"user_id,omitempty"`

	// Scopes granted to an API key (populated by VerifyAPIKey from verify-key).
	// verify-key defaults a scopeless key to ["write"], so a read-only key
	// carries an explicit list that excludes "write" — see HasScope.
	Scopes []string `json:"scopes,omitempty"`

	// Share-link context, populated only by VerifyShareToken. DashboardID
	// identifies the single dashboard a share link exposes; AccessLevel is
	// "view" or "edit". Empty for API-key and session auth. These are used to
	// mark share connections as restricted (read-only) viewers.
	DashboardID string `json:"dashboard_id,omitempty"`
	AccessLevel string `json:"access_level,omitempty"`
}

type cacheEntry struct {
	result    *AuthResult // nil for negative cache (failed auth)
	expiresAt time.Time
}

type AuthClient struct {
	cfg        AuthConfig
	devMode    bool
	defaultOrg string
	client     *http.Client
	metrics    *Metrics

	mu    sync.RWMutex
	cache map[string]cacheEntry
	// inserts counts setCache calls since the last expired-entry sweep.
	// Guarded by mu.
	inserts int
}

// cacheSweepEvery is how many cache inserts pass between full expired-entry
// sweeps. Expired entries are otherwise only evicted on a same-key lookup,
// which never happens for single-use ws session tokens — one stranded entry
// per browser reconnect. Sweeping every N inserts bounds the map at roughly
// N + live entries with amortized O(1) cost per insert.
const cacheSweepEvery = 256

func NewAuthClient(cfg AuthConfig, devMode bool, defaultOrg string) *AuthClient {
	return &AuthClient{
		cfg:        cfg,
		devMode:    devMode,
		defaultOrg: defaultOrg,
		client:     &http.Client{Timeout: cfg.HTTPTimeout},
		cache:      make(map[string]cacheEntry),
	}
}

// SetMetrics attaches a metrics collector. Safe to call after construction.
// Nil is allowed (all recording is no-op on nil *Metrics).
func (a *AuthClient) SetMetrics(m *Metrics) {
	a.metrics = m
}

// HasScope reports whether the auth result grants the given scope. A result
// with no scopes recorded is treated as full-access for backward-compat
// (verify-key already defaults a missing scope list to ["write"], so this only
// waves through non-API-key auth like sessions); "*" grants everything.
//
// Known edge (P3-empty-scopes-array): verify-key currently passes a stored
// EMPTY scopes array through as-is (`scopes || ["write"]` — `[]` is truthy in
// JS), so such a key lands here with len(Scopes)==0 and gets full access.
// The fix belongs in verify-key: normalize empty → ["write"]. Once that
// lands, len(Scopes)==0 here really does mean non-API-key auth.
func (a *AuthResult) HasScope(want string) bool {
	if len(a.Scopes) == 0 {
		return true
	}
	for _, s := range a.Scopes {
		if s == want || s == "*" {
			return true
		}
	}
	return false
}

func (a *AuthClient) VerifyAPIKey(ctx context.Context, apiKey string) (*AuthResult, error) {
	if a.devMode {
		return &AuthResult{OrgID: a.defaultOrg}, nil
	}

	cacheKey := "apikey:" + apiKey
	if result, found := a.getCached(cacheKey); found {
		if result == nil {
			a.metrics.IncAuthCache(authTypeKey, authResultNegativeHit)
			return nil, fmt.Errorf("invalid API key (cached)")
		}
		a.metrics.IncAuthCache(authTypeKey, authResultHit)
		return result, nil
	}
	a.metrics.IncAuthCache(authTypeKey, authResultMiss)

	req, err := http.NewRequestWithContext(ctx, "GET", a.cfg.APIURL+"/api/auth/verify-key", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("x-api-key", apiKey)

	resp, err := a.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("auth request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		// Only cache explicit auth rejections (401/403). Server errors (5xx) are
		// transient — caching them locks out a valid key until restart.
		if resp.StatusCode == 401 || resp.StatusCode == 403 {
			a.setCache(cacheKey, nil, a.cfg.NegativeCacheTTL)
		}
		return nil, fmt.Errorf("invalid API key (status %d)", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, a.cfg.MaxResponseBytes))
	if err != nil {
		return nil, fmt.Errorf("auth response read: %w", err)
	}

	var result AuthResult
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("auth response decode: %w", err)
	}

	a.setCache(cacheKey, &result, a.cfg.CacheTTL)
	return &result, nil
}

func (a *AuthClient) VerifySession(ctx context.Context, token string) (*AuthResult, error) {
	if a.devMode {
		return &AuthResult{OrgID: a.defaultOrg, UserID: "dev-user"}, nil
	}

	cacheKey := "session:" + token
	if result, found := a.getCached(cacheKey); found {
		if result == nil {
			a.metrics.IncAuthCache(authTypeSession, authResultNegativeHit)
			return nil, fmt.Errorf("invalid session (cached)")
		}
		a.metrics.IncAuthCache(authTypeSession, authResultHit)
		return result, nil
	}
	a.metrics.IncAuthCache(authTypeSession, authResultMiss)

	req, err := http.NewRequestWithContext(ctx, "GET", a.cfg.APIURL+"/api/auth/verify-session", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := a.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("session verify failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		if resp.StatusCode == 401 || resp.StatusCode == 403 {
			a.setCache(cacheKey, nil, a.cfg.NegativeCacheTTL)
		}
		return nil, fmt.Errorf("invalid session (status %d)", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, a.cfg.MaxResponseBytes))
	if err != nil {
		return nil, fmt.Errorf("session response read: %w", err)
	}

	var result AuthResult
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("session response decode: %w", err)
	}

	a.setCache(cacheKey, &result, a.cfg.CacheTTL)
	return &result, nil
}

// VerifyShareToken validates a dashboard share-link token. Same
// cache/HTTP pattern as VerifySession, but calls /api/auth/verify-share
// and sends the token as x-share-token header. Returns {org_id} with no
// user_id (anonymous viewer). Used by shared-dashboard browser connections
// that send share_auth instead of browser_auth.
//
// SECURITY / TODO(share-password): this uses the GET verify-share handler,
// which soft-allows password-protected links (the GET path cannot carry a
// password body). Password gating currently only happens on the frontend POST
// path used for the dashboard fetch, so a password-protected dashboard is
// viewable over this WebSocket without the password. Enforcing it requires a
// coordinated frontend change: the browser must send the share password in the
// share_auth frame, and this method must call POST /api/auth/verify-share with
// an Authorization: Bearer <token> header and a {password} body (which returns
// 401 requiresPassword when the password is missing/wrong). Not fixable in the
// gateway alone without the client sending the password, so left as a TODO.
func (a *AuthClient) VerifyShareToken(ctx context.Context, token string) (*AuthResult, error) {
	if a.devMode {
		return &AuthResult{OrgID: a.defaultOrg}, nil
	}

	cacheKey := "share:" + token
	if result, found := a.getCached(cacheKey); found {
		if result == nil {
			a.metrics.IncAuthCache(authTypeShare, authResultNegativeHit)
			return nil, fmt.Errorf("invalid share token (cached)")
		}
		a.metrics.IncAuthCache(authTypeShare, authResultHit)
		return result, nil
	}
	a.metrics.IncAuthCache(authTypeShare, authResultMiss)

	req, err := http.NewRequestWithContext(ctx, "GET", a.cfg.APIURL+"/api/auth/verify-share", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("x-share-token", token)

	resp, err := a.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("share verify failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		if resp.StatusCode == 401 || resp.StatusCode == 403 {
			a.setCache(cacheKey, nil, a.cfg.NegativeCacheTTL)
		}
		return nil, fmt.Errorf("invalid share token (status %d)", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, a.cfg.MaxResponseBytes))
	if err != nil {
		return nil, fmt.Errorf("share response read: %w", err)
	}

	var result AuthResult
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("share response decode: %w", err)
	}

	a.setCache(cacheKey, &result, a.cfg.CacheTTL)
	return &result, nil
}

func (a *AuthClient) getCached(key string) (*AuthResult, bool) {
	now := time.Now()
	a.mu.RLock()
	entry, ok := a.cache[key]
	a.mu.RUnlock()
	if !ok {
		return nil, false
	}
	if now.After(entry.expiresAt) {
		a.mu.Lock()
		if e, exists := a.cache[key]; exists && now.After(e.expiresAt) {
			delete(a.cache, key)
		}
		a.mu.Unlock()
		return nil, false
	}
	return entry.result, true
}

func (a *AuthClient) setCache(key string, result *AuthResult, ttl time.Duration) {
	now := time.Now()
	a.mu.Lock()
	defer a.mu.Unlock()
	a.cache[key] = cacheEntry{result: result, expiresAt: now.Add(ttl)}
	a.inserts++
	if a.inserts >= cacheSweepEvery {
		a.inserts = 0
		for k, e := range a.cache {
			if now.After(e.expiresAt) {
				delete(a.cache, k)
			}
		}
	}
}
