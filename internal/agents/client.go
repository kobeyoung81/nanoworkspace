// Package agents asks the portal who owns an agent.
//
// The workspace serves file and git requests by agent id, and the portal owns
// the agent rows. Rather than reading another module's collection, the question
// is one internal HTTP call — the same shape every other cross-module lookup in
// this platform uses.
package agents

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Client calls the portal's internal agent endpoint.
type Client struct {
	baseURL string
	token   string
	http    *http.Client
}

// New returns a client. An empty base URL leaves it disabled and every call
// fails loudly.
func New(baseURL, token string) *Client {
	return &Client{
		baseURL: strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		token:   token,
		http:    &http.Client{Timeout: 10 * time.Second},
	}
}

// Enabled reports whether a portal URL was configured.
func (c *Client) Enabled() bool { return c != nil && c.baseURL != "" }

// Owner returns the user id an agent belongs to. found=false means the portal
// does not know that id (a deleted agent or a stale tab).
func (c *Client) Owner(ctx context.Context, agentID string) (owner string, found bool, err error) {
	if !c.Enabled() {
		return "", false, fmt.Errorf("the portal is not configured")
	}
	endpoint := c.baseURL + "/internal/v1/agents/" + url.PathEscape(agentID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", false, err
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return "", false, fmt.Errorf("ask portal for the agent: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode == http.StatusNotFound {
		return "", false, nil
	}
	if resp.StatusCode != http.StatusOK {
		return "", false, fmt.Errorf("portal answered %d for the agent", resp.StatusCode)
	}
	var payload struct {
		Agent struct {
			ID     string `json:"id"`
			UserID string `json:"user_id"`
		} `json:"agent"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return "", false, fmt.Errorf("decode portal agent: %w", err)
	}
	if payload.Agent.UserID == "" {
		return "", false, fmt.Errorf("portal returned an agent without an owner")
	}
	return payload.Agent.UserID, true, nil
}
