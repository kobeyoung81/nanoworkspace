package tunnel

// The dual-track window: a container that still dials the bus is only reachable
// through the second endpoint. A 404 from the provisioner must therefore be a
// "try the next one", not a failure.

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
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

// TestDoStreamForwardsHeadersAndQuery: the streamed path carries the method and
// the target path in the query, and passes the caller's headers (Range included)
// to the relay. A download must be resumable and a preview seekable.
func TestDoStreamForwardsHeadersAndQuery(t *testing.T) {
	var gotQuery url.Values
	var gotHeader http.Header
	var gotBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.Query()
		gotHeader = r.Header.Clone()
		gotBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Range", "bytes 0-3/4")
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write([]byte("data"))
	}))
	defer srv.Close()

	c := New(srv.URL, "", "tok")
	resp, err := c.DoStream(context.Background(), "user-1", http.MethodGet,
		"/api/v1/files/a/content?path=big.mp4", http.Header{"Range": {"bytes=0-3"}}, nil, 0)
	if err != nil {
		t.Fatalf("DoStream: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if gotQuery.Get("method") != http.MethodGet || gotQuery.Get("path") != "/api/v1/files/a/content?path=big.mp4" {
		t.Fatalf("query = %v", gotQuery)
	}
	if gotHeader.Get("Range") != "bytes=0-3" {
		t.Fatalf("Range = %q", gotHeader.Get("Range"))
	}
	if gotHeader.Get("Authorization") != "Bearer tok" {
		t.Fatalf("Authorization = %q", gotHeader.Get("Authorization"))
	}
	if len(gotBody) != 0 {
		t.Fatalf("body = %q, want empty", gotBody)
	}
	if resp.StatusCode != http.StatusPartialContent {
		t.Fatalf("status = %d, want 206", resp.StatusCode)
	}
	if got := resp.Header.Get("Content-Range"); got != "bytes 0-3/4" {
		t.Fatalf("Content-Range = %q", got)
	}
}
