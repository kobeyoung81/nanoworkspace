package server

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"gitee.com/kobeyoung81/nanoworkspace/internal/auth"
	"gitee.com/kobeyoung81/nanoworkspace/internal/engine"
	"gitee.com/kobeyoung81/nanoworkspace/internal/goal"
	"gitee.com/kobeyoung81/nanoworkspace/internal/metrics"
	"gitee.com/kobeyoung81/nanoworkspace/internal/store"
)

// SetGoals attaches the goal store and the internal token that the agent
// containers present when they report a round.
//
// It is a setter rather than a New parameter so the file and git surface keeps
// working (and testing) without a database.
func (s *Server) SetGoals(st *store.Store, internalToken string, verify bool) {
	s.goals = st
	s.internalToken = internalToken
	s.goalVerify = verify
}

// registerGoalRoutes mounts the goal surface under one prefix.
//
// The browser calls these with its own token; the agent container calls the
// report endpoint with the platform internal token. Both are on the same path
// because they act on the same resource — only the caller differs.
func (s *Server) registerGoalRoutes(mux *http.ServeMux, prefix string) {
	mux.HandleFunc("POST "+prefix+"/goals", s.handleGoalCreate)
	// The creation surface: a draft, its answers and the start button.
	mux.HandleFunc("POST "+prefix+"/goals/drafts", s.handleDraftCreate)
	mux.HandleFunc("PATCH "+prefix+"/goals/drafts/{id}", s.handleDraftPatch)
	mux.HandleFunc("POST "+prefix+"/goals/drafts/{id}/answer", s.handleDraftAnswer)
	mux.HandleFunc("POST "+prefix+"/goals/drafts/{id}/start", s.handleDraftStart)
	mux.HandleFunc("GET "+prefix+"/goals", s.handleGoalList)
	mux.HandleFunc("GET "+prefix+"/goals/{id}", s.handleGoalGet)
	mux.HandleFunc("POST "+prefix+"/goals/{id}/report", s.handleGoalReport)
	mux.HandleFunc("POST "+prefix+"/goals/{id}/pause", s.handleGoalPause)
	mux.HandleFunc("POST "+prefix+"/goals/{id}/resume", s.handleGoalResume)
	mux.HandleFunc("POST "+prefix+"/goals/{id}/cancel", s.handleGoalCancel)
	mux.HandleFunc("POST "+prefix+"/goals/{id}/budget", s.handleGoalBudget)
	mux.HandleFunc("POST "+prefix+"/goals/{id}/fork", s.handleGoalFork)
	mux.HandleFunc("DELETE "+prefix+"/goals/{id}", s.handleGoalDelete)
	// The scheduled-task half of the panel is read-only (see cron.go).
	mux.HandleFunc("GET "+prefix+"/goals/cron", s.handleCronList)
}

// goalsReady answers 503 before the store is attached.
func (s *Server) goalsReady(w http.ResponseWriter) bool {
	if s.goals == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "goals are not configured"})
		return false
	}
	return true
}

// isInternalCall reports whether the request authenticated with the platform
// token instead of a browser token.
func isInternalCall(r *http.Request) bool {
	_, ok := auth.InternalFromContext(r.Context())
	return ok
}

type createGoalRequest struct {
	// UserID is only honoured for an internal call: the agent container creates
	// a goal on behalf of its own user, and has no browser token to prove it.
	UserID      string   `json:"user_id,omitempty"`
	AgentID     string   `json:"agent_id"`
	SessionKey  string   `json:"session_key"`
	Channel     string   `json:"channel"`
	ChatID      string   `json:"chat_id"`
	Title       string   `json:"title"`
	Condition   string   `json:"condition"`
	Constraints []string `json:"constraints"`
	Mode        string   `json:"mode"`
	MaxRounds   int      `json:"max_rounds"`
	MaxMinutes  int      `json:"max_minutes"`
	Origin      string   `json:"origin"`
}

func (s *Server) handleGoalCreate(w http.ResponseWriter, r *http.Request) {
	if !s.goalsReady(w) {
		return
	}
	identity, hasIdentity := auth.FromContext(r.Context())
	if !hasIdentity && !isInternalCall(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	var req createGoalRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	req.AgentID = strings.TrimSpace(req.AgentID)
	req.SessionKey = strings.TrimSpace(req.SessionKey)
	req.Condition = strings.TrimSpace(req.Condition)
	req.UserID = strings.TrimSpace(req.UserID)
	if req.AgentID == "" || req.SessionKey == "" || req.Condition == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "agent_id, session_key and condition are required"})
		return
	}
	if isInternalCall(r) && req.UserID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "user_id is required on an internal create"})
		return
	}
	// The caller may only start a goal on its own agent: the browser's identity
	// for a browser call, the user the agent container names for an internal one.
	owner, found, err := s.agents.Owner(r.Context(), req.AgentID)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "agent lookup failed"})
		return
	}
	if !found {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "agent not found"})
		return
	}
	userID := req.UserID
	if hasIdentity {
		userID = identity.UserID
	}
	if owner != userID {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "not the agent owner"})
		return
	}
	if req.Channel == "" {
		if i := strings.Index(req.SessionKey, ":"); i > 0 {
			req.Channel = req.SessionKey[:i]
		} else {
			req.Channel = "web"
		}
	}
	if req.ChatID == "" {
		// A key with no channel in it is the chat id itself. Leaving it empty
		// made the agent's outbound posts fail with "channel and chat_id are
		// required", so the round ran but nothing it produced ever arrived.
		req.ChatID = chatOf(req.SessionKey)
	}
	if req.Mode == "" {
		req.Mode = "build"
	}
	if req.MaxRounds <= 0 {
		req.MaxRounds = 40
	}
	if req.MaxMinutes <= 0 {
		req.MaxMinutes = 180
	}
	if req.Origin == "" {
		req.Origin = "manual"
	}

	now := time.Now().UTC()
	g := &store.Goal{
		ID:          "g_" + randomHex(6),
		UserID:      userID,
		AgentID:     req.AgentID,
		Channel:     req.Channel,
		ChatID:      req.ChatID,
		SessionKey:  req.SessionKey,
		Origin:      req.Origin,
		Title:       req.Title,
		Condition:   req.Condition,
		Constraints: req.Constraints,
		Mode:        req.Mode,
		Status:      goal.Running,
		// A goal created through the command line starts immediately; the
		// confirmation flow that sets a human-chosen delay arrives with the
		// creation surface.
		StatusReason: "已创建，等待第一轮",
		Round:        0,
		MaxRounds:    req.MaxRounds,
		MaxMinutes:   req.MaxMinutes,
		StartedAt:    &now,
		NextRoundAt:  &now,
	}
	if err := s.goals.Create(r.Context(), g); err != nil {
		if errors.Is(err, store.ErrDuplicate) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "goal id collision"})
			return
		}
		slog.Error("create goal", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	writeJSON(w, http.StatusOK, g)
}

func (s *Server) handleGoalList(w http.ResponseWriter, r *http.Request) {
	if !s.goalsReady(w) {
		return
	}
	identity, ok := auth.FromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	// The banner asks for one conversation's goals; the panel asks for all of
	// them. Both are the same list, filtered by the base key when it is given.
	var (
		goals []*store.Goal
		err   error
	)
	key, mode := sessionKeyFilter(r.URL.Query())
	switch mode {
	case listAllGoals:
		goals, err = s.goals.ListByUser(r.Context(), identity.UserID, 200)
	case listNoGoals:
		goals = []*store.Goal{}
	default:
		goals, err = s.goals.ListBySession(r.Context(), identity.UserID, key)
	}
	if err != nil {
		slog.Error("list goals", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"goals": goals})
}

// The three ways a goal list can be filtered (see handleGoalList).
const (
	listAllGoals = iota
	listOneSession
	listNoGoals
)

// sessionKeyFilter reads the list filter from the query.
//
// The distinction matters: "no parameter" is the panel asking for everything,
// while an empty value is a conversation that has no key yet — treating that as
// "everything" made a brand-new conversation show another goal's progress.
func sessionKeyFilter(q url.Values) (key string, mode int) {
	raw, has := q["session_key"]
	if !has {
		return "", listAllGoals
	}
	if len(raw) == 0 {
		return "", listNoGoals
	}
	key = strings.TrimSpace(raw[0])
	if key == "" {
		return "", listNoGoals
	}
	return key, listOneSession
}

func (s *Server) handleGoalGet(w http.ResponseWriter, r *http.Request) {
	if !s.goalsReady(w) {
		return
	}
	identity, ok := auth.FromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	g, err := s.goals.Get(r.Context(), identity.UserID, r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "goal not found"})
		return
	}
	if err != nil {
		slog.Error("get goal", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	writeJSON(w, http.StatusOK, g)
}

// handleGoalReport takes one round's result from the agent container.
func (s *Server) handleGoalReport(w http.ResponseWriter, r *http.Request) {
	if !s.goalsReady(w) {
		return
	}
	if !isInternalCall(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "a round report is submitted by the agent, not the browser"})
		return
	}
	var rep engine.Report
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&rep); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	g, err := s.goals.GetByID(r.Context(), r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "goal not found"})
		return
	}
	if err != nil {
		slog.Error("load goal for report", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	started := time.Now()
	now := time.Now().UTC()
	out, err := engine.Decide(g, rep, now, s.goalVerify)
	switch {
	case errors.Is(err, engine.ErrStaleRound):
		metrics.GoalJudgeFailures.Inc()
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	case err != nil:
		metrics.GoalJudgeFailures.Inc()
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if err := s.goals.ApplyOutcome(r.Context(), g.UserID, g.ID, out, now); err != nil {
		metrics.GoalJudgeFailures.Inc()
		if errors.Is(err, store.ErrConflict) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "goal changed"})
			return
		}
		slog.Error("apply report", "goal", g.ID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	metrics.GoalRounds.WithLabelValues(rep.Verdict).Inc()
	metrics.GoalJudgeSeconds.Observe(time.Since(started).Seconds())
	writeJSON(w, http.StatusOK, map[string]any{"status": out.Status, "round": g.Round})
}

func (s *Server) handleGoalPause(w http.ResponseWriter, r *http.Request) {
	s.goalControl(w, r, func(now time.Time) (store.Outcome, bool) {
		return store.Outcome{
			From:         []goal.Status{goal.Running, goal.Verifying},
			ExpectRound:  -1,
			Status:       goal.Paused,
			StatusReason: "用户暂停",
			PauseReason:  goal.PauseUser,
		}, true
	})
}

func (s *Server) handleGoalResume(w http.ResponseWriter, r *http.Request) {
	s.goalControl(w, r, func(now time.Time) (store.Outcome, bool) {
		next := now
		return store.Outcome{
			From:         []goal.Status{goal.Paused},
			ExpectRound:  -1,
			Status:       goal.Running,
			StatusReason: "继续",
			NextRoundAt:  &next,
		}, true
	})
}

func (s *Server) handleGoalCancel(w http.ResponseWriter, r *http.Request) {
	s.goalControl(w, r, func(now time.Time) (store.Outcome, bool) {
		return store.Outcome{
			From:         []goal.Status{goal.Running, goal.Paused, goal.Verifying, goal.Ready},
			ExpectRound:  -1,
			Status:       goal.Cancelling,
			StatusReason: "用户叫停",
			PauseReason:  goal.PauseUser,
		}, true
	})
}

// goalControl runs one of the three user actions.
func (s *Server) goalControl(w http.ResponseWriter, r *http.Request, build func(now time.Time) (store.Outcome, bool)) {
	if !s.goalsReady(w) {
		return
	}
	identity, ok := auth.FromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	g, err := s.goals.Get(r.Context(), identity.UserID, r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "goal not found"})
		return
	}
	if err != nil {
		slog.Error("get goal", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	now := time.Now().UTC()
	out, _ := build(now)
	if err := s.goals.ApplyOutcome(r.Context(), g.UserID, g.ID, out, now); err != nil {
		if errors.Is(err, store.ErrConflict) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "goal is not in a state that allows this"})
			return
		}
		slog.Error("apply goal control", "goal", g.ID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": out.Status})
}

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return strings.Repeat("0", n*2)
	}
	return hex.EncodeToString(b)
}

// internalTokenMatches compares the presented token in constant time.
func internalTokenMatches(presented, want string) bool {
	if want == "" || presented == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(presented), []byte(want)) == 1
}
