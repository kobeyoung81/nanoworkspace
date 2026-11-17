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
}

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
		http: &http.Client{Timeout: 90 * time.Second},
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
