package goal

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// configServer answers the admin config call with one item and counts calls.
func configServer(t *testing.T, key, value string) (*httptest.Server, *int32) {
	t.Helper()
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Errorf("missing internal token on the admin call")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"component_type":"agent","items":[{"key":"` + key + `","value":"` + value + `"}]}`))
	}))
	t.Cleanup(srv.Close)
	return srv, &calls
}

// TestEnabled_ReadsTheSwitch is the happy path, and it spells the key out on
// purpose: the constant and the server both coming from enabledKey would keep
// the test green if the constant drifted away from what the seeder stores.
func TestEnabled_ReadsTheSwitch(t *testing.T) {
	srv, _ := configServer(t, "goal.enabled", "true")
	c := NewEnabled(srv.URL, "test-token")
	if !c.Enabled(context.Background()) {
		t.Fatal("enabled switch should be true")
	}
}

// TestEnabled_FailsClosed covers every way of not knowing: a missing key, a
// value that is not a bool, an unreachable module and an unconfigured URL all
// read as off. A switch that failed open would turn a broken admin module into
// unattended rounds nobody can stop.
func TestEnabled_FailsClosed(t *testing.T) {
	cases := []struct {
		name string
		srv  func(*testing.T) *httptest.Server
		url  string
	}{
		{"missing key", func(t *testing.T) *httptest.Server { s, _ := configServer(t, "other.key", "true"); return s }, ""},
		{"not a bool", func(t *testing.T) *httptest.Server { s, _ := configServer(t, enabledKey, "yes please"); return s }, ""},
		{"http error", func(t *testing.T) *httptest.Server {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusInternalServerError)
			}))
			t.Cleanup(s.Close)
			return s
		}, ""},
		{"no url", func(t *testing.T) *httptest.Server { return nil }, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			url := tc.url
			if s := tc.srv(t); s != nil {
				url = s.URL
			}
			c := NewEnabled(url, "test-token")
			if c.Enabled(context.Background()) {
				t.Fatal("an unreadable switch must read as off")
			}
		})
	}
}

// TestEnabled_CachesForThirtySeconds pins the cache: a 5s scheduler tick must
// not become two admin calls per tick, and turning the switch off has to reach
// the scheduler within the TTL.
func TestEnabled_CachesForThirtySeconds(t *testing.T) {
	srv, calls := configServer(t, enabledKey, "false")
	c := NewEnabled(srv.URL, "test-token")

	now := time.Now()
	c.now = func() time.Time { return now }
	for i := 0; i < 5; i++ {
		if c.Enabled(context.Background()) {
			t.Fatal("switch is off")
		}
		now = now.Add(5 * time.Second)
	}
	if got := atomic.LoadInt32(calls); got != 1 {
		t.Fatalf("admin was called %d times within the TTL, want 1", got)
	}

	// Past the TTL the next tick asks again.
	now = now.Add(enabledTTL)
	_ = c.Enabled(context.Background())
	if got := atomic.LoadInt32(calls); got != 2 {
		t.Fatalf("admin was called %d times after the TTL, want 2", got)
	}
}
