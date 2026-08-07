package main

// Batched transition notifier — POSTs alert state changes to Next.js.
//
// Transitions are enqueued from the alert state machine (potentially
// from multiple org consumer goroutines) and flushed periodically or
// when the batch reaches a size threshold. Retry with backoff on failure.

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

type TransitionBatch struct {
	Transitions []Transition `json:"transitions"`
}

type TransitionNotifier struct {
	mu      sync.Mutex
	batch   []Transition
	apiURL  string
	secret  string
	client  *http.Client
	flushCh chan struct{}
	stopCh  chan struct{}
	wg      sync.WaitGroup
	cfg     NotifierConfig
	metrics *Metrics // nil-safe; feeds alertd_notifications_{sent,failed}_total

	// healthMu guards the readiness signals below.
	healthMu    sync.RWMutex
	lastSuccess time.Time
	lastFailure time.Time
}

func NewTransitionNotifier(cfg NotifierConfig, apiURL, secret string, metrics *Metrics) *TransitionNotifier {
	return &TransitionNotifier{
		batch:       make([]Transition, 0, cfg.BatchSize),
		apiURL:      apiURL,
		secret:      secret,
		client:      &http.Client{Timeout: cfg.Timeout},
		flushCh:     make(chan struct{}, 1),
		stopCh:      make(chan struct{}),
		cfg:         cfg,
		metrics:     metrics,
		lastSuccess: time.Now(), // treat boot as healthy until proven otherwise
	}
}

// Health returns readiness signals for /readyz: last successful flush,
// last failed flush, and current pending queue depth.
func (tn *TransitionNotifier) Health() (lastSuccess, lastFailure time.Time, queueDepth int) {
	tn.healthMu.RLock()
	lastSuccess = tn.lastSuccess
	lastFailure = tn.lastFailure
	tn.healthMu.RUnlock()
	tn.mu.Lock()
	queueDepth = len(tn.batch)
	tn.mu.Unlock()
	return
}

func (tn *TransitionNotifier) recordSuccess() {
	tn.healthMu.Lock()
	tn.lastSuccess = time.Now()
	tn.healthMu.Unlock()
}

func (tn *TransitionNotifier) recordFailure() {
	tn.healthMu.Lock()
	tn.lastFailure = time.Now()
	tn.healthMu.Unlock()
}

// Enqueue adds a transition to the batch. Thread-safe — called from
// multiple org consumer goroutines.
func (tn *TransitionNotifier) Enqueue(t Transition) {
	tn.mu.Lock()
	tn.batch = append(tn.batch, t)
	shouldFlush := len(tn.batch) >= tn.cfg.BatchSize
	tn.mu.Unlock()

	if shouldFlush {
		select {
		case tn.flushCh <- struct{}{}:
		default:
		}
	}
}

// Start begins the flush loop goroutine.
func (tn *TransitionNotifier) Start() {
	tn.wg.Add(1)
	go tn.flushLoop()
}

// Stop signals the flush loop to exit and waits for it to drain.
func (tn *TransitionNotifier) Stop() {
	close(tn.stopCh)
	tn.wg.Wait()
}

func (tn *TransitionNotifier) flushLoop() {
	defer tn.wg.Done()

	ticker := time.NewTicker(tn.cfg.FlushInterval)
	defer ticker.Stop()

	for {
		select {
		case <-tn.stopCh:
			tn.flush() // final drain
			return
		case <-ticker.C:
			tn.flush()
		case <-tn.flushCh:
			tn.flush()
		}
	}
}

func (tn *TransitionNotifier) flush() {
	tn.mu.Lock()
	if len(tn.batch) == 0 {
		tn.mu.Unlock()
		return
	}
	batch := tn.batch
	tn.batch = make([]Transition, 0, cap(batch))
	tn.mu.Unlock()

	body, err := json.Marshal(TransitionBatch{Transitions: batch})
	if err != nil {
		// Batch is dropped without a retry — still a lost batch.
		tn.metrics.IncNotificationsFail()
		slog.Error("notifier marshal", "err", err, "count", len(batch))
		return
	}

	delays := []time.Duration{1 * time.Second, 2 * time.Second, 4 * time.Second}
	maxAttempts := tn.cfg.MaxRetries + 1
	if maxAttempts > len(delays)+1 {
		maxAttempts = len(delays) + 1
	}

	for attempt := 0; attempt < maxAttempts; attempt++ {
		if attempt > 0 && attempt-1 < len(delays) {
			// Backoff must not block shutdown: Stop() has a ~10s budget in
			// main.go and the sleeps alone total 7s. When stopCh is closed
			// we skip the remaining backoff and let the attempts themselves
			// (bounded by the client timeout) decide the batch's fate.
			select {
			case <-tn.stopCh:
			case <-time.After(delays[attempt-1]):
			}
		}

		ctx, cancel := context.WithTimeout(context.Background(), tn.cfg.Timeout)
		req, err := http.NewRequestWithContext(ctx, "POST",
			tn.apiURL+"/api/internal/alerts/transitions", bytes.NewReader(body))
		if err != nil {
			cancel()
			slog.Error("notifier request build", "err", err)
			return
		}
		req.Header.Set("Content-Type", "application/json")
		if tn.secret != "" {
			req.Header.Set("x-internal-secret", tn.secret)
		}

		resp, err := tn.client.Do(req)
		cancel()
		if err != nil {
			slog.Warn("notifier flush failed", "attempt", attempt+1, "err", err)
			continue
		}
		io.Copy(io.Discard, io.LimitReader(resp.Body, 10*1024)) // 10KB cap
		resp.Body.Close()

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			tn.recordSuccess()
			tn.metrics.IncNotificationsSent()
			slog.Debug("notifier flush ok", "transitions", len(batch))
			return
		}
		slog.Warn("notifier flush non-2xx", "status", resp.StatusCode, "attempt", attempt+1)
	}

	tn.recordFailure()
	tn.metrics.IncNotificationsFail()
	slog.Error("notifier flush exhausted retries", "transitions", len(batch))
}
