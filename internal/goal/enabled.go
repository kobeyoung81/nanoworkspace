package goal

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"sync"
	"time"
)

// enabledKey is the platform switch, read from the admin module's "agent"
// component. Configuration belongs to admin (the bus stopped serving it), so
// this service asks admin over HTTP like the bus does.
//
// The key has no component prefix: the seeder stores the name the entry was
// declared with, and the agent component already spells its own prefix on the
// entries that want one (agent.scheduledTaskMode) and not on this one.
const enabledKey = "goal.enabled"

// enabledTTL is how long a read is trusted. Thirty seconds is short enough that
// turning the switch off takes effect within one scheduler tick of a human
// noticing something wrong, and long enough that a 5s ticker does not hammer
// the admin module.
const enabledTTL = 30 * time.Second

// EnabledChecker answers one question: may the scheduler dispatch a round?
//
// It fails closed. A module that cannot be reached, a missing key and an
// unparseable value all mean "off": the switch exists so a bad deployment stops,
// never so a broken one keeps running.
type EnabledChecker struct {
	adminURL string
	token    string
	client   *http.Client

	mu     sync.Mutex
	value  bool
	readAt time.Time
	read   bool

	// now is overridable in tests; production uses time.Now.
	now func() time.Time
}

// NewEnabled builds a checker for one admin URL and internal token.
func NewEnabled(adminURL, token string) *EnabledChecker {
	return &EnabledChecker{
		adminURL: adminURL,
		token:    token,
		client:   &http.Client{Timeout: 5 * time.Second},
		now:      time.Now,
	}
}

// Enabled reports the platform switch, cached for enabledTTL.
func (c *EnabledChecker) Enabled(ctx context.Context) bool {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := c.now()
	if c.read && now.Sub(c.readAt) < enabledTTL {
		return c.value
	}
	value, err := c.fetch(ctx)
	if err != nil {
		slog.Warn("goal switch unreadable; goals stay off for this tick", "error", err)
	}
	c.value, c.readAt, c.read = value, now, true
	return value
}

// fetch reads the agent component and picks the switch out of it.
func (c *EnabledChecker) fetch(ctx context.Context) (bool, error) {
	if c.adminURL == "" {
		return false, fmt.Errorf("admin url is not configured")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.adminURL+"/api/v1/config/agent", nil)
	if err != nil {
		return false, err
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return false, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("admin answered %d", resp.StatusCode)
	}
	var payload struct {
		Items []struct {
			Key   string `json:"key"`
			Value string `json:"value"`
		} `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return false, fmt.Errorf("decode config: %w", err)
	}
	for _, item := range payload.Items {
		if item.Key != enabledKey {
			continue
		}
		on, err := strconv.ParseBool(item.Value)
		if err != nil {
			return false, fmt.Errorf("%s = %q is not a bool", enabledKey, item.Value)
		}
		return on, nil
	}
	return false, fmt.Errorf("%s is not present", enabledKey)
}
