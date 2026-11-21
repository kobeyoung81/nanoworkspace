// Package bus posts inbound messages to the bus.
//
// The scheduler's only outbound call is this one: a goal round is a normal
// inbound message, so the bus, the agent and the conversation all keep working
// the way they already do. The workspace never talks to an agent directly.
package bus

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"gitee.com/kobeyoung81/nanoprotocol"
)

// Client posts to the bus's REST surface with the platform's internal token.
type Client struct {
	baseURL string
	token   string
	http    *http.Client
}

// New builds a client. An empty base URL disables it (every call fails loudly
// rather than silently dropping a round).
func New(baseURL, token string) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		token:   token,
		http:    &http.Client{Timeout: 10 * time.Second},
	}
}

// PostInbound enqueues one message for an agent. The bus answers 202.
func (c *Client) PostInbound(ctx context.Context, msg nanoprotocol.InboundMessage) error {
	if c.baseURL == "" {
		return fmt.Errorf("bus url is not configured")
	}
	if msg.Timestamp.IsZero() {
		msg.Timestamp = time.Now().UTC()
	}
	body, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("encode inbound: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/v1/inbound", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("post inbound: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusAccepted {
		return fmt.Errorf("post inbound: bus answered %d", resp.StatusCode)
	}
	return nil
}
