package tunnel

// The dual-track window: a container that still dials the bus is only reachable
// through the second endpoint. A 404 from the provisioner must therefore be a
// "try the next one", not a failure.

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"gitee.com/kobeyoung81/nanoprotocol"
)

func endpoint(t *testing.T, status int, body string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if status == http.StatusNotFound {
			http.NotFound(w, r)
			return
		}
		var req nanoprotocol.TunnelRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		_ = json.NewEncoder(w).Encode(nanoprotocol.TunnelResponse{RequestID: req.RequestID, Status: status, Body: []byte(body)})
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestFallsBackToTheBus(t *testing.T) {
	provisioner := endpoint(t, http.StatusNotFound, "")
	bus := endpoint(t, http.StatusOK, "from-the-bus")
	c := New(provisioner.URL, bus.URL, "token")

	resp, err := c.Do(context.Background(), "user-1", nanoprotocol.TunnelRequest{RequestID: "r1", Method: http.MethodGet, Path: "/x"})
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	if string(resp.Body) != "from-the-bus" {
		t.Fatalf("body = %q", resp.Body)
	}
}

func TestBothOfflineIsErrOffline(t *testing.T) {
	provisioner := endpoint(t, http.StatusNotFound, "")
	bus := endpoint(t, http.StatusNotFound, "")
	c := New(provisioner.URL, bus.URL, "token")

	if _, err := c.Do(context.Background(), "user-1", nanoprotocol.TunnelRequest{RequestID: "r1"}); err != ErrOffline {
		t.Fatalf("err = %v, want ErrOffline", err)
	}
}

// TestARealFailureIsNotRetried keeps a broken container (502 from the endpoint)
// from being reported as "offline" and from being retried against the other hop.
func TestARealFailureIsNotRetried(t *testing.T) {
	asked := 0
	provisioner := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		asked++
		http.Error(w, "tunnel forward failed", http.StatusBadGateway)
	}))
	defer provisioner.Close()
	bus := endpoint(t, http.StatusOK, "should-not-be-used")
	c := New(provisioner.URL, bus.URL, "token")

	if _, err := c.Do(context.Background(), "user-1", nanoprotocol.TunnelRequest{RequestID: "r1"}); err == nil {
		t.Fatal("a 502 from the tunnel endpoint was reported as success")
	}
	if asked != 1 {
		t.Fatalf("the bus was retried after a real failure (%d calls)", asked)
	}
}
