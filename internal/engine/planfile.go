package engine

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"gitee.com/kobeyoung81/nanoprotocol"
	"gitee.com/kobeyoung81/nanoworkspace/internal/store"
	"gitee.com/kobeyoung81/nanoworkspace/internal/tunnel"
)

// TunnelPlanReader reads the head of a goal's plan file through the container
// tunnel. The file lives in the agent's volume, which this service never mounts.
type TunnelPlanReader struct {
	Tunnels *tunnel.Client
	// MaxLines caps the excerpt; the prompt builder has its own limit, but
	// reading a whole large file to throw most of it away is waste.
	MaxLines int
}

// PlanLines returns the first MaxLines lines of the goal's plan file.
func (p TunnelPlanReader) PlanLines(ctx context.Context, g *store.Goal) ([]string, error) {
	if p.Tunnels == nil || g == nil || strings.TrimSpace(g.PlanRef) == "" {
		return nil, nil
	}
	path := "/api/v1/files/" + url.PathEscape(g.AgentID) + "/content?path=" + url.QueryEscape(g.PlanRef)
	resp, err := p.Tunnels.Do(ctx, g.UserID, nanoprotocol.TunnelRequest{
		Method:  http.MethodGet,
		Path:    path,
		Headers: map[string][]string{},
	})
	if err != nil {
		return nil, err
	}
	if resp.Status != http.StatusOK {
		return nil, fmt.Errorf("read plan %s: tunnel answered %d", g.PlanRef, resp.Status)
	}
	lines := strings.Split(string(resp.Body), "\n")
	if max := p.MaxLines; max > 0 && len(lines) > max {
		lines = lines[:max]
	}
	return lines, nil
}
