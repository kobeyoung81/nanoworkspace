package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"gitee.com/kobeyoung81/nanoprotocol"
	"gitee.com/kobeyoung81/nanoworkspace/internal/auth"
	"gitee.com/kobeyoung81/nanoworkspace/internal/goal"
	"gitee.com/kobeyoung81/nanoworkspace/internal/store"
)

// The creation surface (design §13): a draft is a server object, so the user can
// fill it on one device, read the confirmation card on another, and start it
// when the six checks pass.

type draftRequest struct {
	AgentID    string `json:"agent_id"`
	SessionKey string `json:"session_key"`
	Channel    string `json:"channel"`
	ChatID     string `json:"chat_id"`
	Origin     string `json:"origin"`
	PlanRef    string `json:"plan_ref,omitempty"`
	Title      string `json:"title,omitempty"`
	Condition  string `json:"condition,omitempty"`
	Approach   string `json:"approach,omitempty"`
	MaxRounds  int    `json:"max_rounds,omitempty"`
	MaxMinutes int    `json:"max_minutes,omitempty"`
}

// draftPatch is the partial edit the card sends on every keystroke.
type draftPatch struct {
	Title       *string            `json:"title,omitempty"`
	Condition   *string            `json:"condition,omitempty"`
	Approach    *string            `json:"approach,omitempty"`
	Proof       *[]store.ProofStep `json:"proof,omitempty"`
	Constraints *[]string          `json:"constraints,omitempty"`
	PlanRef     *string            `json:"plan_ref,omitempty"`
	MaxRounds   *int               `json:"max_rounds,omitempty"`
	MaxMinutes  *int               `json:"max_minutes,omitempty"`
}

// draftAnswer is one answer to one of the six checks.
type draftAnswer struct {
	Check string `json:"check"`
	Value string `json:"value"`
	// UserID is only honoured on an internal call (the intake turn has no
	// browser token and writes on behalf of the conversation's owner).
	UserID string `json:"user_id,omitempty"`
}

// draftView is what the card renders: the draft plus the six-check verdict.
type draftView struct {
	Draft   *store.Goal  `json:"draft"`
	Verdict goal.Verdict `json:"verdict"`
	// Approach is stored on the goal's title field? No: it is derived from the
	// plan reference and the condition's "how", so it is returned separately.
	Approach string `json:"approach,omitempty"`
}

func (s *Server) handleDraftCreate(w http.ResponseWriter, r *http.Request) {
	if !s.goalsReady(w) {
		return
	}
	identity, ok := auth.FromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	var req draftRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	req.AgentID = strings.TrimSpace(req.AgentID)
	req.SessionKey = strings.TrimSpace(req.SessionKey)
	if req.AgentID == "" || req.SessionKey == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "agent_id and session_key are required"})
		return
	}
	owner, found, err := s.agents.Owner(r.Context(), req.AgentID)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "agent lookup failed"})
		return
	}
	if !found || owner != identity.UserID {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "not the agent owner"})
		return
	}

	// Idempotent: the same conversation reuses its unfinished draft, so opening
	// the card twice does not leave two of them behind.
	if existing, err := s.goals.FindDraft(r.Context(), identity.UserID, req.SessionKey); err == nil {
		writeJSON(w, http.StatusOK, s.draftView(existing))
		return
	} else if !errors.Is(err, store.ErrNotFound) {
		slog.Error("find draft", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	if req.Channel == "" {
		req.Channel = channelOf(req.SessionKey)
	}
	if req.ChatID == "" {
		req.ChatID = chatOf(req.SessionKey)
	}
	if req.Origin == "" {
		req.Origin = "manual"
	}
	if req.MaxRounds <= 0 {
		req.MaxRounds = 40
	}
	if req.MaxMinutes <= 0 {
		req.MaxMinutes = 180
	}

	// A plan-backed draft is pre-filled from the file: the condition and the
	// evidence are exactly what a plan written under the current Plan prompt
	// carries.
	var parts goal.PlanParts
	if ref := strings.TrimSpace(req.PlanRef); ref != "" {
		if md, err := s.readPlanFile(r.Context(), req.AgentID, identity.UserID, ref); err != nil {
			slog.Warn("read plan for the draft", "plan", ref, "error", err)
		} else {
			parts = goal.ParsePlan(md)
		}
	}

	g := &store.Goal{
		ID:         "g_" + randomHex(6),
		UserID:     identity.UserID,
		AgentID:    req.AgentID,
		Channel:    req.Channel,
		ChatID:     req.ChatID,
		SessionKey: req.SessionKey,
		Origin:     req.Origin,
		Title:      firstNonEmpty(req.Title, req.Approach, planApproach(parts)),
		Condition:  firstNonEmpty(req.Condition, parts.Condition),
		Proof:      proofSteps(parts.Proof),
		PlanRef:    req.PlanRef,
		Mode:       "build",
		Status:     goal.Draft,
		MaxRounds:  req.MaxRounds,
		MaxMinutes: req.MaxMinutes,
	}
	if err := s.goals.Create(r.Context(), g); err != nil {
		slog.Error("create draft", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	writeJSON(w, http.StatusOK, s.draftView(g))
}

func (s *Server) handleDraftPatch(w http.ResponseWriter, r *http.Request) {
	g, ok := s.loadDraft(w, r)
	if !ok {
		return
	}
	var p draftPatch
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&p); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	patch := store.DraftPatch{
		Title: p.Title, Condition: p.Condition, PlanRef: p.PlanRef,
		Proof: p.Proof, Constraints: p.Constraints,
		MaxRounds: p.MaxRounds, MaxMinutes: p.MaxMinutes,
	}
	if p.Approach != nil {
		// The approach is carried in the goal's title until the confirmation card
		// has a dedicated field; the API keeps it separate for callers.
		if g.Title == "" {
			patch.Title = p.Approach
		}
	}
	if err := s.goals.UpdateDraft(r.Context(), g.UserID, g.ID, patch); err != nil {
		s.writeGoalError(w, err)
		return
	}
	updated, err := s.goals.Get(r.Context(), g.UserID, g.ID)
	if err != nil {
		s.writeGoalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, s.draftView(updated))
}

func (s *Server) handleDraftAnswer(w http.ResponseWriter, r *http.Request) {
	var a draftAnswer
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&a); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	// The intake turn runs in the agent container and writes the answers back, so
	// this endpoint accepts the internal token as well as a browser session.
	g, ok := s.loadDraftFor(w, r, strings.TrimSpace(a.UserID))
	if !ok {
		return
	}
	value := strings.TrimSpace(a.Value)
	patch := store.DraftPatch{}
	switch a.Check {
	case goal.CheckCondition:
		patch.Condition = &value
	case goal.CheckProof:
		steps := []store.ProofStep{}
		for _, line := range strings.Split(value, "\n") {
			if line = strings.TrimSpace(line); line != "" {
				steps = append(steps, store.ProofStep{Kind: "note", Note: line})
			}
		}
		patch.Proof = &steps
	case goal.CheckApproach:
		patch.Title = &value
	case goal.CheckConstraints:
		items := []string{}
		for _, line := range strings.Split(value, "\n") {
			if line = strings.TrimSpace(line); line != "" {
				items = append(items, line)
			}
		}
		patch.Constraints = &items
	case goal.CheckBudget:
		rounds, minutes := parseBudget(value)
		patch.MaxRounds, patch.MaxMinutes = &rounds, &minutes
	case goal.CheckPermission:
		// The sixth check is the host's answer; nothing to store.
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown check " + a.Check})
		return
	}
	if err := s.goals.UpdateDraft(r.Context(), g.UserID, g.ID, patch); err != nil {
		s.writeGoalError(w, err)
		return
	}
	updated, err := s.goals.Get(r.Context(), g.UserID, g.ID)
	if err != nil {
		s.writeGoalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, s.draftView(updated))
}

// handleDraftStart runs the six checks and, when they pass, hands the goal to
// the scheduler. A refused start returns the reason, never a bare 400.
func (s *Server) handleDraftStart(w http.ResponseWriter, r *http.Request) {
	g, ok := s.loadDraft(w, r)
	if !ok {
		return
	}
	v := s.draftView(g).Verdict
	if !v.Ready() {
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":    "目标还不能开始",
			"missing":  v.Missing,
			"blockers": v.Blockers,
			"verdict":  v,
		})
		return
	}
	now := time.Now().UTC()
	if err := s.goals.StartDraft(r.Context(), g.UserID, g.ID, now); err != nil {
		s.writeGoalError(w, err)
		return
	}
	if err := s.goals.PromoteToRunning(r.Context(), g.UserID, g.ID, now); err != nil {
		s.writeGoalError(w, err)
		return
	}
	started, err := s.goals.Get(r.Context(), g.UserID, g.ID)
	if err != nil {
		s.writeGoalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, started)
}

// handleGoalBudget raises the two limits; a budget pause is lifted by the raise.
func (s *Server) handleGoalBudget(w http.ResponseWriter, r *http.Request) {
	if !s.goalsReady(w) {
		return
	}
	identity, ok := auth.FromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	var body struct {
		MaxRounds  int `json:"max_rounds"`
		MaxMinutes int `json:"max_minutes"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	g, err := s.goals.Get(r.Context(), identity.UserID, r.PathValue("id"))
	if err != nil {
		s.writeGoalError(w, err)
		return
	}
	if body.MaxRounds <= 0 {
		body.MaxRounds = g.MaxRounds
	}
	if body.MaxMinutes <= 0 {
		body.MaxMinutes = g.MaxMinutes
	}
	if err := s.goals.UpdateBudget(r.Context(), g.UserID, g.ID, body.MaxRounds, body.MaxMinutes, time.Now().UTC()); err != nil {
		s.writeGoalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"max_rounds": body.MaxRounds, "max_minutes": body.MaxMinutes})
}

// handleGoalFork copies a goal into a new one. "Changing the condition" is a new
// goal, not a state transition (design §05): the old one keeps its history.
func (s *Server) handleGoalFork(w http.ResponseWriter, r *http.Request) {
	if !s.goalsReady(w) {
		return
	}
	identity, ok := auth.FromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	src, err := s.goals.Get(r.Context(), identity.UserID, r.PathValue("id"))
	if err != nil {
		s.writeGoalError(w, err)
		return
	}
	var body struct {
		Condition string `json:"condition"`
	}
	_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&body)
	now := time.Now().UTC()
	forked := *src
	forked.ID = "g_" + randomHex(6)
	forked.Condition = strings.TrimSpace(body.Condition)
	if forked.Condition == "" {
		forked.Condition = src.Condition
	}
	forked.Status = goal.Draft
	forked.StatusReason = ""
	forked.Round = 0
	forked.VerifyRound = 0
	forked.VerifyResult = ""
	forked.Rounds = nil
	forked.Result = nil
	forked.StartedAt = nil
	forked.NextRoundAt = nil
	forked.EndedAt = nil
	forked.Rounds = []store.Round{}
	forked.CreatedAt = now
	forked.UpdatedAt = now
	if err := s.goals.Create(r.Context(), &forked); err != nil {
		s.writeGoalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, s.draftView(&forked))
}

// readPlanFile reads a plan through the container tunnel: the file lives in the
// agent's volume, which this service never mounts.
func (s *Server) readPlanFile(ctx context.Context, agentID, userID, planRef string) (string, error) {
	if s.tunnels == nil {
		return "", fmt.Errorf("no tunnel client")
	}
	path := "/api/v1/files/" + url.PathEscape(agentID) + "/content?path=" + url.QueryEscape(planRef)
	resp, err := s.tunnels.Do(ctx, userID, nanoprotocol.TunnelRequest{
		Method: http.MethodGet, Path: path, Headers: map[string][]string{},
	})
	if err != nil {
		return "", err
	}
	if resp.Status != http.StatusOK {
		return "", fmt.Errorf("tunnel answered %d", resp.Status)
	}
	return string(resp.Body), nil
}

// proofSteps turns the plan's evidence lines into the goal's proof steps. A line
// that names an exit code is stored as a command; anything else is a note.
func proofSteps(lines []string) []store.ProofStep {
	if len(lines) == 0 {
		return nil
	}
	out := make([]store.ProofStep, 0, len(lines))
	for _, line := range lines {
		step := store.ProofStep{Kind: "note", Note: line}
		if strings.Contains(line, "退出码") || strings.Contains(line, "exit") {
			step = store.ProofStep{Kind: "command", Command: line}
		}
		out = append(out, step)
	}
	return out
}

// planApproach is the "怎么走" line a plan-backed draft starts with: the step
// count, because the card expands the plan itself for the detail.
func planApproach(p goal.PlanParts) string {
	if len(p.Steps) == 0 {
		return ""
	}
	return fmt.Sprintf("%d 步（来自计划）", len(p.Steps))
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// loadDraft resolves the caller's draft (or refuses).
func (s *Server) loadDraft(w http.ResponseWriter, r *http.Request) (*store.Goal, bool) {
	return s.loadDraftFor(w, r, "")
}

// loadDraftFor is loadDraft with an owner supplied by an internal caller.
func (s *Server) loadDraftFor(w http.ResponseWriter, r *http.Request, internalUserID string) (*store.Goal, bool) {
	if !s.goalsReady(w) {
		return nil, false
	}
	userID := internalUserID
	if userID == "" {
		identity, ok := auth.FromContext(r.Context())
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return nil, false
		}
		userID = identity.UserID
	} else if !isInternalCall(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "a user id is only accepted on an internal call"})
		return nil, false
	}
	g, err := s.goals.Get(r.Context(), userID, r.PathValue("id"))
	if err != nil {
		s.writeGoalError(w, err)
		return nil, false
	}
	if g.Status != goal.Draft {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "目标已经开始，草稿接口不再适用"})
		return nil, false
	}
	return g, true
}

// draftView fills the six-check verdict for one draft.
//
// The permission check is answered by the host: this service does not hold the
// agent type's policy, and P0's build belt has no "ask" rule, so the answer is
// "nothing needed". A deployment that adds one has to teach this function — the
// field exists so that change is one place, not a card rewrite.
func (s *Server) draftView(g *store.Goal) draftView {
	d := goal.DraftFields{
		Title:       g.Title,
		Condition:   g.Condition,
		Constraints: g.Constraints,
		MaxRounds:   g.MaxRounds,
		MaxMinutes:  g.MaxMinutes,
		Approach:    g.Title,
	}
	for _, step := range g.Proof {
		d.Proof = append(d.Proof, step.Note+" "+step.Command+" "+step.Path)
	}
	if d.Approach == "" && g.PlanRef != "" {
		d.Approach = g.PlanRef
	}
	return draftView{Draft: g, Verdict: goal.Intake(d)}
}

func (s *Server) writeGoalError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "goal not found"})
	case errors.Is(err, store.ErrConflict):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "goal changed"})
	default:
		slog.Error("goal request", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
	}
}

func channelOf(sessionKey string) string {
	if i := strings.Index(sessionKey, ":"); i > 0 {
		return sessionKey[:i]
	}
	return "web"
}

func chatOf(sessionKey string) string {
	if i := strings.Index(sessionKey, ":"); i >= 0 {
		return sessionKey[i+1:]
	}
	return sessionKey
}

// budgetPattern reads one number and the word after it: "40 轮", "180 分钟".
var budgetPattern = regexp.MustCompile(`(\d+)\s*([^\d\s]*)`)

// parseBudget reads "40 轮 / 180 分钟", "20 轮，60 分钟" or a bare "30".
// An unlabelled number fills the round limit first, then the minutes.
func parseBudget(value string) (rounds, minutes int) {
	rounds, minutes = 40, 180
	unlabelled := 0
	for _, m := range budgetPattern.FindAllStringSubmatch(value, -1) {
		n, err := strconv.Atoi(m[1])
		if err != nil {
			continue
		}
		unit := m[2]
		switch {
		case strings.ContainsAny(unit, "分m"):
			minutes = n
		case strings.ContainsAny(unit, "轮r"):
			rounds = n
		default:
			if unlabelled == 0 {
				rounds = n
			} else {
				minutes = n
			}
			unlabelled++
		}
	}
	return rounds, minutes
}
