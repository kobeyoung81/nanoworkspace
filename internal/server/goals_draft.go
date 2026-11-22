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
//
// Value is raw JSON because a caller may send the plain text the user typed or
// the structure the same field keeps (proof steps with their kind, a budget as
// {"rounds":3,"minutes":10}); decoding both here keeps one wire shape.
type draftAnswer struct {
	Check string          `json:"check"`
	Value json.RawMessage `json:"value"`
	// UserID is only honoured on an internal call (the intake turn has no
	// browser token and writes on behalf of the conversation's owner).
	UserID string `json:"user_id,omitempty"`
}

// draftAnswers is the batch body: one intake round's answers in one write.
type draftAnswers struct {
	Answers []draftAnswer `json:"answers"`
	UserID  string        `json:"user_id,omitempty"`
}

// draftView is what the card renders: the draft plus the six-check verdict.
type draftView struct {
	Draft   *store.Goal  `json:"draft"`
	Verdict goal.Verdict `json:"verdict"`
	// Stored says, per check, what actually landed. It exists because a write
	// can succeed and change nothing the checks accept — a budget of "you
	// decide" parses to zero rounds, so the model would be told "saved" and the
	// user would be asked the same question again.
	Stored map[string]string `json:"stored,omitempty"`
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

// handleDraftAnswer writes one answer (the card's own inline edit).
func (s *Server) handleDraftAnswer(w http.ResponseWriter, r *http.Request) {
	var a draftAnswer
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&a); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	s.applyDraftAnswers(w, r, []draftAnswer{a}, strings.TrimSpace(a.UserID))
}

// handleDraftAnswers writes one intake round's answers in one write.
//
// One call per round instead of one per question: the model gets the answers
// together, and a round that fills three checks costs one request, not three.
func (s *Server) handleDraftAnswers(w http.ResponseWriter, r *http.Request) {
	var body draftAnswers
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 128<<10)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if len(body.Answers) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "answers is required"})
		return
	}
	if len(body.Answers) > len(goal.CheckNames) {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": fmt.Sprintf("at most %d answers, one per check", len(goal.CheckNames)),
		})
		return
	}
	s.applyDraftAnswers(w, r, body.Answers, strings.TrimSpace(body.UserID))
}

// handleDraftGet is the confirmation card's read.
//
// Polling it is what keeps the card from showing the snapshot it happened to
// open with: the intake turn writes into the same server object behind the
// card's back.
//
// It reads a goal in any status on purpose. The card is a view: once the goal
// starts, a poll that was already in flight would otherwise answer 409 and put a
// red line in a console where nothing is wrong. Writes stay gated in
// loadDraftFor.
func (s *Server) handleDraftGet(w http.ResponseWriter, r *http.Request) {
	if !s.goalsReady(w) {
		return
	}
	identity, ok := auth.FromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	g, err := s.goals.Get(r.Context(), identity.UserID, r.PathValue("id"))
	if err != nil {
		s.writeGoalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, s.draftView(g))
}

// applyDraftAnswers validates every answer, writes the lot in one update, and
// answers with the new view plus what each field actually holds.
func (s *Server) applyDraftAnswers(w http.ResponseWriter, r *http.Request, answers []draftAnswer, internalUserID string) {
	g, ok := s.loadDraftFor(w, r, internalUserID)
	if !ok {
		return
	}
	patch := store.DraftPatch{}
	stored := map[string]string{}
	for _, a := range answers {
		check, known := goal.NormalizeCheck(a.Check)
		if !known {
			writeJSON(w, http.StatusBadRequest, map[string]string{
				"error": fmt.Sprintf("check %q is not one of %s", a.Check, goal.CheckKeys()),
			})
			return
		}
		if err := fillAnswer(check, a.Value, &patch, stored); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
	}
	if patchEmpty(patch) {
		writeJSON(w, http.StatusOK, s.draftViewWith(g, stored))
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
	writeJSON(w, http.StatusOK, s.draftViewWith(updated, stored))
}

// fillAnswer turns one answer into draft fields and records what landed.
//
// An answer that carries nothing is not written at all: writing first and
// letting the check fail afterwards is how a budget of "you decide" used to
// overwrite a good one with zero.
func fillAnswer(check string, raw json.RawMessage, patch *store.DraftPatch, stored map[string]string) error {
	switch check {
	case goal.CheckCondition:
		v, err := answerText(raw)
		if err != nil {
			return err
		}
		if v == "" {
			stored[check] = "空，未写入"
			return nil
		}
		patch.Condition = &v
		stored[check] = v
	case goal.CheckProof:
		steps, err := answerProof(raw)
		if err != nil {
			return err
		}
		if len(steps) == 0 {
			stored[check] = "空，未写入"
			return nil
		}
		patch.Proof = &steps
		stored[check] = fmt.Sprintf("%d 条", len(steps))
	case goal.CheckApproach:
		v, err := answerText(raw)
		if err != nil {
			return err
		}
		if v == "" {
			stored[check] = "空，未写入"
			return nil
		}
		patch.Title = &v
		stored[check] = v
	case goal.CheckConstraints:
		items, err := answerLines(raw)
		if err != nil {
			return err
		}
		if len(items) == 0 {
			stored[check] = "空，未写入"
			return nil
		}
		patch.Constraints = &items
		stored[check] = fmt.Sprintf("%d 条", len(items))
	case goal.CheckBudget:
		rounds, minutes, given, err := answerBudget(raw)
		if err != nil {
			return err
		}
		if rounds <= 0 || minutes <= 0 {
			stored[check] = "空，未写入"
			return nil
		}
		patch.MaxRounds, patch.MaxMinutes = &rounds, &minutes
		stored[check] = fmt.Sprintf("%d 轮 / %d 分钟", rounds, minutes)
		if !given {
			// "你定" is an answer: it takes the default, and the caller is told
			// which numbers it got instead of guessing.
			stored[check] += "（默认）"
		}
	case goal.CheckPermission:
		// The sixth check is the host's answer; nothing to store.
		stored[check] = "host"
	}
	return nil
}

// patchEmpty reports whether an answer round changed no field at all.
func patchEmpty(p store.DraftPatch) bool {
	return p.Title == nil && p.Condition == nil && p.Proof == nil &&
		p.Constraints == nil && p.PlanRef == nil && p.Mode == nil &&
		p.MaxRounds == nil && p.MaxMinutes == nil
}

// answerText reads a value that is one string, or a list joined by newlines.
func answerText(raw json.RawMessage) (string, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return "", fmt.Errorf("value is required")
	}
	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		return strings.TrimSpace(text), nil
	}
	lines, err := answerLines(raw)
	if err != nil {
		return "", fmt.Errorf("value must be a string or a list of strings")
	}
	return strings.Join(lines, "\n"), nil
}

// answerLines reads a list of items, or a string with one item per line.
func answerLines(raw json.RawMessage) ([]string, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, fmt.Errorf("value is required")
	}
	var items []string
	if err := json.Unmarshal(raw, &items); err == nil {
		out := make([]string, 0, len(items))
		for _, item := range items {
			if item = strings.TrimSpace(item); item != "" {
				out = append(out, item)
			}
		}
		return out, nil
	}
	var text string
	if err := json.Unmarshal(raw, &text); err != nil {
		return nil, fmt.Errorf("value must be a string or a list of strings")
	}
	out := make([]string, 0, 4)
	for _, line := range strings.Split(text, "\n") {
		if line = strings.TrimSpace(line); line != "" {
			out = append(out, line)
		}
	}
	return out, nil
}

// answerProof reads the structured steps the intake tool sends, or the plain
// text the card sends (one step per line).
func answerProof(raw json.RawMessage) ([]store.ProofStep, error) {
	if len(raw) > 0 && string(raw) != "null" {
		var steps []store.ProofStep
		if err := json.Unmarshal(raw, &steps); err == nil && len(steps) > 0 {
			out := make([]store.ProofStep, 0, len(steps))
			for _, step := range steps {
				if step.Kind == "" {
					step.Kind = "note"
				}
				out = append(out, step)
			}
			return out, nil
		}
	}
	lines, err := answerLines(raw)
	if err != nil {
		return nil, err
	}
	return proofSteps(lines), nil
}

// answerBudget reads {"rounds":3,"minutes":10} or the text the user typed. The
// third result says whether the text carried numbers at all: "你定" is a real
// answer, and it takes the default rather than leaving the check empty.
func answerBudget(raw json.RawMessage) (rounds, minutes int, given bool, err error) {
	if len(raw) > 0 && string(raw) != "null" {
		var obj struct {
			Rounds  int `json:"rounds"`
			Minutes int `json:"minutes"`
		}
		if err := json.Unmarshal(raw, &obj); err == nil && (obj.Rounds > 0 || obj.Minutes > 0) {
			return obj.Rounds, obj.Minutes, true, nil
		}
	}
	text, err := answerText(raw)
	if err != nil {
		return 0, 0, false, err
	}
	if text == "" {
		return 0, 0, false, nil
	}
	rounds, minutes = parseBudget(text)
	return rounds, minutes, budgetPattern.MatchString(text), nil
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

// draftViewWith is draftView with what the last write actually stored.
func (s *Server) draftViewWith(g *store.Goal, stored map[string]string) draftView {
	view := s.draftView(g)
	if len(stored) > 0 {
		view.Stored = stored
	}
	return view
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

// handleGoalDelete removes a goal outright (user's call: physical, any status).
//
// A round still in flight reports to a 404 afterwards; the report endpoint counts
// that as a judge failure and changes nothing else.
func (s *Server) handleGoalDelete(w http.ResponseWriter, r *http.Request) {
	if !s.goalsReady(w) {
		return
	}
	identity, ok := auth.FromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	if err := s.goals.DeleteGoal(r.Context(), identity.UserID, r.PathValue("id")); err != nil {
		s.writeGoalError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
