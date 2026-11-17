// Package metrics exposes the workspace module's operational numbers.
//
// One question per service: is it answering, how fast, and (where it owns data) how
// long the database is taking. The three are reported by every module under its own
// prefix, so one dashboard works for all of them.
//
// The scrape endpoint is anonymous and lives on the internal HTTP port next to
// /healthz: a scraper is infrastructure, not a user, and the port is not public.
package metrics

import (
	"bufio"
	"net"
	"net/http"
	"strconv"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var (
	// HTTPRequests counts calls by matched route pattern, method and status. The
	// pattern comes from the ServeMux (Go 1.22+), so a path parameter never becomes
	// a label value and the series count stays bounded.
	HTTPRequests = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "workspace_http_requests_total",
		Help: "HTTP requests served, by route, method and status.",
	}, []string{"route", "method", "status"})

	// HTTPSeconds is the handler latency of those calls.
	HTTPSeconds = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "workspace_http_request_seconds",
		Help:    "Time spent serving one HTTP request, by route.",
		Buckets: []float64{0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10},
	}, []string{"route"})
)

func init() { prometheus.MustRegister(HTTPRequests, HTTPSeconds) }

// Handler serves the Prometheus text exposition.
func Handler() http.Handler { return promhttp.Handler() }

// Middleware records one HTTP call under its route pattern. A request that matched
// no route is reported as "unmatched" rather than by path: an unknown path is
// exactly what would otherwise mint a time series per probe.
func Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)

		route := r.Pattern
		if route == "" {
			route = "unmatched"
		}
		HTTPRequests.WithLabelValues(route, r.Method, strconv.Itoa(rec.status)).Inc()
		HTTPSeconds.WithLabelValues(route).Observe(time.Since(start).Seconds())
	})
}

// statusRecorder keeps the status the handler wrote. A handler that never calls
// WriteHeader has answered 200, which is what the initial value records.
type statusRecorder struct {
	http.ResponseWriter
	status  int
	written bool
}

func (r *statusRecorder) WriteHeader(code int) {
	if !r.written {
		r.status, r.written = code, true
	}
	r.ResponseWriter.WriteHeader(code)
}

func (r *statusRecorder) Write(b []byte) (int, error) {
	r.written = true
	return r.ResponseWriter.Write(b)
}

// Flush keeps streaming handlers working through the wrapper.
func (r *statusRecorder) Flush() {
	if f, ok := r.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Hijack keeps WebSocket upgrades working through the wrapper.
func (r *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := r.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, http.ErrNotSupported
	}
	return h.Hijack()
}
