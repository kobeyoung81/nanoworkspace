// Package tunnel puts an HTTP request on a container's hypervisor tunnel.
//
// Tunnels terminate at the provisioner. During the dual-track window a container
// whose image predates the move still connects to the bus, so a 404 (or an
// unreachable provisioner) falls through to the bus, which relays in turn. Once
// every container runs the new image the second endpoint goes away.
package tunnel

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"gitee.com/kobeyoung81/nanoprotocol"
)

// ErrOffline means no endpoint has a connection for that container: the agent is
// not running (or not yet restarted onto the new image anywhere).
var ErrOffline = errors.New("the agent container is not reachable")

// Client forwards one request through whichever endpoint holds the connection.
type Client struct {
	endpoints []string
	token     string
	http      *http.Client
	// stream has no whole-request timeout: a large download is legitimate, and
	// the caller's context still ends it when the browser leaves.
	stream *http.Client
}

// RelayErrorHeader marks an answer the relay produced itself, so the caller does
// not mistake it for the container's status. Values: offline, busy, too_large,
// failed.
const RelayErrorHeader = "X-Tunnel-Relay-Error"

// New builds a client from the provisioner and bus base URLs, in the order they
// are tried.
func New(provisionerURL, busURL, token string) *Client {
	endpoints := make([]string, 0, 2)
	for _, base := range []string{provisionerURL, busURL} {
		if base = strings.TrimRight(strings.TrimSpace(base), "/"); base != "" {
			endpoints = append(endpoints, base)
		}
	}
	return &Client{
		endpoints: endpoints,
		token:     token,
		// A forwarded request waits for the container's bridge, which itself
		// allows 60s: the client must not cut it off earlier.
		http:   &http.Client{Timeout: 90 * time.Second},
		stream: &http.Client{Transport: &http.Transport{ResponseHeaderTimeout: 60 * time.Second}},
	}
}

// Do sends req to hypervisor-<userID> and returns the container's answer.
func (c *Client) Do(ctx context.Context, userID string, req nanoprotocol.TunnelRequest) (*nanoprotocol.TunnelResponse, error) {
	if len(c.endpoints) == 0 {
		return nil, fmt.Errorf("no tunnel endpoint is configured")
	}
	name := "hypervisor-" + userID
	path := "/api/v1/internal/tunnels/" + url.PathEscape(name) + "/request"
	payload, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}

	var lastErr error
	for _, base := range c.endpoints {
		resp, status, err := c.post(ctx, base+path, payload)
		switch {
		case err == nil:
			return resp, nil
		case status == http.StatusNotFound:
			// Not connected here; the next endpoint may hold the connection.
			lastErr = ErrOffline
			continue
		default:
			// A transport error is worth one more try (the provisioner may be
			// restarting while the bus still serves the old container). A real
			// failure from a reachable endpoint is final.
			if status == 0 {
				lastErr = err
				continue
			}
			return nil, err
		}
	}
	if lastErr == nil {
		lastErr = ErrOffline
	}
	return nil, lastErr
}

func (c *Client) post(ctx context.Context, endpoint string, payload []byte) (*nanoprotocol.TunnelResponse, int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("forward to %s: %w", endpoint, err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode >= http.StatusBadRequest {
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, resp.StatusCode, fmt.Errorf("tunnel endpoint answered %d: %s", resp.StatusCode, strings.TrimSpace(string(detail)))
	}
	var out nanoprotocol.TunnelResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, resp.StatusCode, fmt.Errorf("decode tunnel response: %w", err)
	}
	return &out, resp.StatusCode, nil
}

// DoStream forwards one request through the streamed tunnel endpoint and returns
// the container's answer as an HTTP response. Unlike Do, the body is never
// buffered here: a large download is read from the tunnel as the browser
// consumes it, and the size of a file stops being the size of a request body.
func (c *Client) DoStream(ctx context.Context, userID, method, path string, header http.Header, body io.Reader, contentLength int64) (*http.Response, error) {
	if len(c.endpoints) == 0 {
		return nil, fmt.Errorf("no tunnel endpoint is configured")
	}
	name := "hypervisor-" + userID
	query := url.Values{}
	query.Set("method", method)
	query.Set("path", path)
	target := "/api/v1/internal/tunnels/" + url.PathEscape(name) + "/proxy?" + query.Encode()

	resp, err := c.proxy(ctx, c.endpoints[0]+target, header, body, contentLength)
	if err != nil || len(c.endpoints) == 1 {
		return resp, err
	}
	// Only an empty-bodied request may be retried on the second endpoint: the
	// body is a stream, and a second attempt would send an empty one.
	if contentLength > 0 || resp == nil {
		return resp, err
	}
	if !isRelayOffline(resp) {
		return resp, nil
	}
	_ = resp.Body.Close()

	second, err := c.proxy(ctx, c.endpoints[1]+target, header, body, contentLength)
	if err != nil {
		return nil, err
	}
	// The bus relays inline requests only and has no /proxy route; a bare 404
	// from it means "no endpoint has this container", not "the file is gone".
	if second.StatusCode == http.StatusNotFound && second.Header.Get(RelayErrorHeader) == "" {
		_ = second.Body.Close()
		return nil, ErrOffline
	}
	return second, nil
}

// isRelayOffline reports whether an answer came from the relay rather than the
// container and says no tunnel is reachable.
func isRelayOffline(resp *http.Response) bool {
	if resp == nil {
		return false
	}
	if resp.Header.Get(RelayErrorHeader) == "offline" {
		return true
	}
	// Older relays answered a missing tunnel with a plain 404 and no marker.
	return resp.StatusCode == http.StatusNotFound && resp.Header.Get(RelayErrorHeader) == ""
}

func (c *Client) proxy(ctx context.Context, endpoint string, header http.Header, body io.Reader, contentLength int64) (*http.Response, error) {
	if body == nil {
		body = http.NoBody
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, body)
	if err != nil {
		return nil, err
	}
	req.ContentLength = contentLength
	for key, values := range header {
		if hopByHopHeader(key) || strings.EqualFold(key, "Authorization") {
			continue
		}
		for _, value := range values {
			req.Header.Add(key, value)
		}
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	return c.stream.Do(req)
}

func hopByHopHeader(key string) bool {
	switch http.CanonicalHeaderKey(key) {
	case "Connection", "Keep-Alive", "Proxy-Authenticate", "Proxy-Authorization",
		"Te", "Trailer", "Transfer-Encoding", "Upgrade", "Content-Length", "Host":
		return true
	}
	return false
}
