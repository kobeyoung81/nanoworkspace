package server

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"

	"gitee.com/kobeyoung81/nanoworkspace/internal/auth"
)

// The scheduled-task half of the panel is read-only on purpose (user's call,
// 2026-11-21): cron.json has exactly one writer — the agent's own cron service,
// which loads it at start-up and keeps the schedule in memory. Flipping
// `enabled` from here would be overwritten by the agent's next save, so the panel
// shows the tasks and leaves starting/stopping to the conversation, where the
// cron tool owns the file.

// cronTaskView is what the panel needs from one job.
type cronTaskView struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Enabled   bool   `json:"enabled"`
	Schedule  string `json:"schedule,omitempty"`
	NextRunAt *int64 `json:"next_run_at_ms,omitempty"`
}

// handleCronList reads the agent's cron.json through the tunnel.
func (s *Server) handleCronList(w http.ResponseWriter, r *http.Request) {
	identity, ok := auth.FromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	agentID := strings.TrimSpace(r.URL.Query().Get("agent_id"))
	if agentID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "agent_id is required"})
		return
	}
	owner, found, err := s.agents.Owner(r.Context(), agentID)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "agent lookup failed"})
		return
	}
	if !found || owner != identity.UserID {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "not the agent owner"})
		return
	}

	raw, err := s.readPlanFile(r.Context(), agentID, owner, "agent/cron.json")
	if err != nil {
		// No cron.json is not an error: an agent that never scheduled anything
		// has no file, and the panel simply shows no tasks.
		slog.Debug("read cron.json", "agent", agentID, "error", err)
		writeJSON(w, http.StatusOK, map[string]any{"tasks": []cronTaskView{}})
		return
	}

	var persisted struct {
		Jobs []struct {
			ID       string `json:"id"`
			Name     string `json:"name"`
			Enabled  bool   `json:"enabled"`
			Schedule struct {
				Kind string `json:"kind"`
				Expr string `json:"expr,omitempty"`
				AtMS *int64 `json:"at_ms,omitempty"`
			} `json:"schedule"`
			State struct {
				NextRunAtMS *int64 `json:"next_run_at_ms"`
			} `json:"state"`
		} `json:"jobs"`
	}
	if err := json.Unmarshal([]byte(raw), &persisted); err != nil {
		slog.Warn("parse cron.json", "agent", agentID, "error", err)
		writeJSON(w, http.StatusOK, map[string]any{"tasks": []cronTaskView{}})
		return
	}

	out := make([]cronTaskView, 0, len(persisted.Jobs))
	for _, job := range persisted.Jobs {
		out = append(out, cronTaskView{
			ID:        job.ID,
			Name:      job.Name,
			Enabled:   job.Enabled,
			Schedule:  job.Schedule.Expr,
			NextRunAt: job.State.NextRunAtMS,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"tasks": out})
}
