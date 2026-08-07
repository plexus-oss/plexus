package main

// Prometheus metrics for the alert service.
//
// Nil-safe: all methods check for nil receiver so callers don't need
// nil guards. Metrics are disabled when MetricsAddr is empty.

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
)

type Metrics struct {
	registry *prometheus.Registry

	rulesActive       prometheus.Gauge
	alertsOpen        prometheus.Gauge
	alertsFired       prometheus.Counter
	alertsClosed      prometheus.Counter
	evaluationsTotal  prometheus.Counter
	notificationsSent prometheus.Counter
	notificationsFail prometheus.Counter
	consumersActive   prometheus.Gauge
}

func NewMetrics() *Metrics {
	reg := prometheus.NewRegistry()

	m := &Metrics{
		registry: reg,

		rulesActive: prometheus.NewGauge(prometheus.GaugeOpts{
			Namespace: "alertd",
			Name:      "rules_active",
			Help:      "Number of active alert rules",
		}),
		alertsOpen: prometheus.NewGauge(prometheus.GaugeOpts{
			Namespace: "alertd",
			Name:      "alerts_open",
			Help:      "Number of currently open alerts",
		}),
		alertsFired: prometheus.NewCounter(prometheus.CounterOpts{
			Namespace: "alertd",
			Name:      "alerts_fired_total",
			Help:      "Total alerts opened",
		}),
		alertsClosed: prometheus.NewCounter(prometheus.CounterOpts{
			Namespace: "alertd",
			Name:      "alerts_closed_total",
			Help:      "Total alerts closed",
		}),
		evaluationsTotal: prometheus.NewCounter(prometheus.CounterOpts{
			Namespace: "alertd",
			Name:      "evaluations_total",
			Help:      "Total rule evaluations",
		}),
		notificationsSent: prometheus.NewCounter(prometheus.CounterOpts{
			Namespace: "alertd",
			Name:      "notifications_sent_total",
			Help:      "Transition batches successfully POSTed to Next.js",
		}),
		notificationsFail: prometheus.NewCounter(prometheus.CounterOpts{
			Namespace: "alertd",
			Name:      "notifications_failed_total",
			Help:      "Transition batches that failed all retries",
		}),
		consumersActive: prometheus.NewGauge(prometheus.GaugeOpts{
			Namespace: "alertd",
			Name:      "consumers_active",
			Help:      "Number of active org stream consumers",
		}),
	}

	reg.MustRegister(
		m.rulesActive, m.alertsOpen,
		m.alertsFired, m.alertsClosed,
		m.evaluationsTotal,
		m.notificationsSent, m.notificationsFail,
		m.consumersActive,
	)

	reg.MustRegister(
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
		collectors.NewGoCollector(),
	)

	return m
}

func (m *Metrics) Registry() *prometheus.Registry {
	if m == nil {
		return nil
	}
	return m.registry
}

func (m *Metrics) SetRulesActive(n float64)    { if m != nil { m.rulesActive.Set(n) } }
func (m *Metrics) SetAlertsOpen(n float64)     { if m != nil { m.alertsOpen.Set(n) } }
func (m *Metrics) IncAlertsFired()             { if m != nil { m.alertsFired.Inc() } }
func (m *Metrics) IncAlertsClosed()            { if m != nil { m.alertsClosed.Inc() } }
func (m *Metrics) IncEvaluations()             { if m != nil { m.evaluationsTotal.Inc() } }
func (m *Metrics) IncNotificationsSent()        { if m != nil { m.notificationsSent.Inc() } }
func (m *Metrics) IncNotificationsFail()        { if m != nil { m.notificationsFail.Inc() } }
func (m *Metrics) SetConsumersActive(n float64) { if m != nil { m.consumersActive.Set(n) } }
