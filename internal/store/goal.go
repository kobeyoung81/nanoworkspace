package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"gitee.com/kobeyoung81/nanoworkspace/internal/goal"
)

const goalsCollection = "workspace_goals"

// roundSummaryLimit caps the embedded summaries. The design bounds a goal
// document at roughly 10 KB: the rounds are what a panel shows, the evidence
// stays in the conversation.
const roundSummaryLimit = 40

var (
	// ErrNotFound is returned when the goal does not exist, or belongs to a
	// different user — the two are the same answer on purpose.
	ErrNotFound = errors.New("goal not found")
	// ErrConflict is returned when a conditional write matched no row: the goal
	// moved (status, round or claim) after the caller read it.
	ErrConflict = errors.New("goal changed")
	// ErrDuplicate is returned when (user_id, id) already exists.
	ErrDuplicate = errors.New("goal already exists")
)

// ProofStep is one way the condition will be shown to hold. The kinds match the
// evidence a round report may carry, so the creator and the judge speak the same
// vocabulary.
type ProofStep struct {
	Kind    string `bson:"kind" json:"kind"` // command | file | note
	Command string `bson:"command,omitempty" json:"command,omitempty"`
	Path    string `bson:"path,omitempty" json:"path,omitempty"`
	Note    string `bson:"note,omitempty" json:"note,omitempty"`
}

// Round is the summary of one round: what was judged and how many files moved.
// It never carries the evidence itself.
type Round struct {
	N       int       `bson:"n" json:"n"`
	Verdict string    `bson:"verdict" json:"verdict"`
	Files   int       `bson:"files" json:"files"`
	At      time.Time `bson:"at" json:"at"`
}

// Result is the one-line ending a finished goal carries.
type Result struct {
	Verdict string    `bson:"verdict" json:"verdict"`
	Reason  string    `bson:"reason" json:"reason"`
	Rounds  int       `bson:"rounds" json:"rounds"`
	Minutes int       `bson:"minutes" json:"minutes"`
	At      time.Time `bson:"at" json:"at"`
}

// Goal is one workspace_goals document (design §04).
//
// The binding is session_key, the base key without the segment suffix: a
// compaction splits the session into :vN+1 and the goal has to survive it.
type Goal struct {
	ID      string `bson:"id" json:"id"`
	UserID  string `bson:"user_id" json:"user_id"`
	AgentID string `bson:"agent_id" json:"agent_id"`

	Channel    string `bson:"channel" json:"channel"`
	ChatID     string `bson:"chat_id" json:"chat_id"`
	SessionKey string `bson:"session_key" json:"session_key"`
	// WorkspaceRoot is where the agent works; shown in the confirmation card.
	WorkspaceRoot string `bson:"workspace_root,omitempty" json:"workspace_root,omitempty"`

	Origin      string      `bson:"origin" json:"origin"` // manual | plan
	Title       string      `bson:"title" json:"title"`
	Condition   string      `bson:"condition" json:"condition"`
	Proof       []ProofStep `bson:"proof" json:"proof"`
	Constraints []string    `bson:"constraints" json:"constraints"`
	PlanRef     string      `bson:"plan_ref,omitempty" json:"plan_ref,omitempty"`
	// Mode is the mode the rounds run in (build), not the mode the goal was
	// created from.
	Mode string `bson:"mode" json:"mode"`

	Status       goal.Status `bson:"status" json:"status"`
	StatusReason string      `bson:"status_reason,omitempty" json:"status_reason,omitempty"`
	QueueState   string      `bson:"queue_state,omitempty" json:"queue_state,omitempty"`
	Round        int         `bson:"round" json:"round"`
	MaxRounds    int         `bson:"max_rounds" json:"max_rounds"`
	MaxMinutes   int         `bson:"max_minutes" json:"max_minutes"`
	StartedAt    *time.Time  `bson:"started_at,omitempty" json:"started_at,omitempty"`

	VerifyRound  int    `bson:"verify_round" json:"verify_round"`
	VerifyResult string `bson:"verify_result,omitempty" json:"verify_result,omitempty"`
	// PauseReason is the structured reason a goal stopped (user|stuck|budget).
	// status_reason is for humans; this field is what resume/budget code reads.
	PauseReason string `bson:"pause_reason,omitempty" json:"pause_reason,omitempty"`
	// EvidenceDigest is the sorted command+exit list of the last work round. The
	// verification round is compared against it: same commands, same codes.
	EvidenceDigest string `bson:"evidence_digest,omitempty" json:"evidence_digest,omitempty"`
	ResumeCount    int    `bson:"resume_count" json:"resume_count"`
	StuckReason    string `bson:"stuck_reason,omitempty" json:"stuck_reason,omitempty"`
	BudgetRaised   int    `bson:"budget_raised" json:"budget_raised"`

	Rounds []Round `bson:"rounds" json:"rounds"`
	Result *Result `bson:"result,omitempty" json:"result,omitempty"`

	SpentTokens int64  `bson:"spent_tokens" json:"spent_tokens"`
	LastVerdict string `bson:"last_verdict,omitempty" json:"last_verdict,omitempty"`
	LastReason  string `bson:"last_reason,omitempty" json:"last_reason,omitempty"`
	// LastMissing is the previous round's "still missing" list; the next round's
	// injection quotes the first few items.
	LastMissing      []string `bson:"last_missing,omitempty" json:"last_missing,omitempty"`
	NoProgressRounds int      `bson:"no_progress_rounds" json:"no_progress_rounds"`

	NextRoundAt       *time.Time `bson:"next_round_at,omitempty" json:"next_round_at,omitempty"`
	ClaimedAt         *time.Time `bson:"claimed_at,omitempty" json:"claimed_at,omitempty"`
	CancelRequestedAt *time.Time `bson:"cancel_requested_at,omitempty" json:"cancel_requested_at,omitempty"`
	CreatedAt         time.Time  `bson:"created_at" json:"created_at"`
	UpdatedAt         time.Time  `bson:"updated_at" json:"updated_at"`
	EndedAt           *time.Time `bson:"ended_at,omitempty" json:"ended_at,omitempty"`
}

// Create inserts a goal. (user_id, id) is unique, so a retried create fails the
// same way a concurrent one does.
func (s *Store) Create(ctx context.Context, g *Goal) error {
	now := time.Now().UTC()
	if g.CreatedAt.IsZero() {
		g.CreatedAt = now
	}
	g.UpdatedAt = now
	if _, err := s.db.Collection(goalsCollection).InsertOne(ctx, g); err != nil {
		if mongo.IsDuplicateKeyError(err) {
			return ErrDuplicate
		}
		return fmt.Errorf("create goal: %w", err)
	}
	return nil
}

// Get reads one goal. A goal belonging to another user is reported as missing:
// the caller has no business learning that the id exists.
func (s *Store) Get(ctx context.Context, userID, id string) (*Goal, error) {
	var g Goal
	err := s.db.Collection(goalsCollection).FindOne(ctx, bson.D{
		{Key: "user_id", Value: userID},
		{Key: "id", Value: id},
	}).Decode(&g)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get goal: %w", err)
	}
	return &g, nil
}

// GetByID reads one goal without an owner filter. Only the internal surface uses
// it: a round report arrives from the agent container, which has no user token,
// and the goal id it carries is the whole binding.
func (s *Store) GetByID(ctx context.Context, id string) (*Goal, error) {
	var g Goal
	err := s.db.Collection(goalsCollection).FindOne(ctx, bson.D{{Key: "id", Value: id}}).Decode(&g)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get goal: %w", err)
	}
	return &g, nil
}

// ListByUser returns a user's goals, newest first.
func (s *Store) ListByUser(ctx context.Context, userID string, limit int) ([]*Goal, error) {
	if limit <= 0 || limit > 200 {
		limit = 200
	}
	cur, err := s.db.Collection(goalsCollection).Find(ctx,
		bson.D{{Key: "user_id", Value: userID}},
		options.Find().SetSort(bson.D{{Key: "updated_at", Value: -1}}).SetLimit(int64(limit)))
	if err != nil {
		return nil, fmt.Errorf("list goals: %w", err)
	}
	defer func() { _ = cur.Close(ctx) }()

	out := make([]*Goal, 0, 8)
	for cur.Next(ctx) {
		var g Goal
		if err := cur.Decode(&g); err != nil {
			return nil, fmt.Errorf("decode goal: %w", err)
		}
		out = append(out, &g)
	}
	return out, cur.Err()
}

// ClaimRound takes the exclusive right to dispatch round N of a goal.
//
// The condition carries the round number and an expiring claim, so a ticker
// retry, a second replica or a manual re-dispatch can never start the same round
// twice: the first write matches and every later one matches zero rows.
func (s *Store) ClaimRound(ctx context.Context, userID, id string, round int, now time.Time, lease time.Duration) (bool, error) {
	expired := now.Add(-lease)
	result, err := s.db.Collection(goalsCollection).UpdateOne(ctx,
		bson.D{
			{Key: "user_id", Value: userID},
			{Key: "id", Value: id},
			{Key: "status", Value: goal.Running},
			{Key: "round", Value: round},
			{Key: "$or", Value: bson.A{
				bson.D{{Key: "claimed_at", Value: nil}},
				bson.D{{Key: "claimed_at", Value: bson.D{{Key: "$lt", Value: expired}}}},
			}},
		},
		bson.D{{Key: "$set", Value: bson.D{
			{Key: "claimed_at", Value: now.UTC()},
			{Key: "queue_state", Value: "running"},
			{Key: "updated_at", Value: now.UTC()},
		}}})
	if err != nil {
		return false, fmt.Errorf("claim round: %w", err)
	}
	return result.MatchedCount == 1, nil
}

// SetStatus moves a goal from one of the allowed statuses to the target.
//
// The read-then-write is guarded by the status in the filter, so a pause that
// raced a verdict reports ErrConflict instead of reviving a finished goal.
// Pausing and stopping also clear the schedule: a paused goal must not be found
// by the next tick.
func (s *Store) SetStatus(ctx context.Context, userID, id string, from []goal.Status, to goal.Status, reason goal.PauseReason, statusReason string, now time.Time) error {
	if len(from) == 0 {
		return fmt.Errorf("set goal status: no source status")
	}
	allowed := false
	for _, f := range from {
		if goal.Validate(f, to, reason) == nil {
			allowed = true
			break
		}
	}
	if !allowed {
		if err := goal.Validate(from[0], to, reason); err != nil {
			return err
		}
		return fmt.Errorf("%w: %s → %s", goal.ErrIllegalTransition, from, to)
	}

	sources := make(bson.A, 0, len(from))
	for _, f := range from {
		sources = append(sources, string(f))
	}

	set := bson.D{
		{Key: "status", Value: to},
		{Key: "status_reason", Value: statusReason},
		{Key: "updated_at", Value: now.UTC()},
	}
	if reason != "" {
		set = append(set, bson.E{Key: "pause_reason", Value: reason})
	} else {
		set = append(set, bson.E{Key: "pause_reason", Value: ""})
	}
	if to == goal.Running || to == goal.Verifying {
		set = append(set, bson.E{Key: "queue_state", Value: "idle"})
	} else {
		set = append(set, bson.E{Key: "queue_state", Value: ""})
	}
	switch to {
	case goal.Paused, goal.Cancelling:
		set = append(set, bson.E{Key: "next_round_at", Value: nil})
	case goal.Cancelled, goal.Achieved, goal.Failed:
		set = append(set, bson.E{Key: "next_round_at", Value: nil})
		set = append(set, bson.E{Key: "claimed_at", Value: nil})
		set = append(set, bson.E{Key: "ended_at", Value: now.UTC()})
	}

	result, err := s.db.Collection(goalsCollection).UpdateOne(ctx,
		bson.D{
			{Key: "user_id", Value: userID},
			{Key: "id", Value: id},
			{Key: "status", Value: bson.D{{Key: "$in", Value: sources}}},
		},
		bson.D{{Key: "$set", Value: set}})
	if err != nil {
		return fmt.Errorf("set goal status: %w", err)
	}
	if result.MatchedCount == 0 {
		return ErrConflict
	}
	return nil
}

// AppendRound records one round's summary and clears the claim.
//
// The claim is cleared in the same write that records the round: an observation
// that arrives after the claim expired must not leave the goal looking busy
// until the lease runs out again.
func (s *Store) AppendRound(ctx context.Context, userID, id string, r Round, lastVerdict, lastReason string, now time.Time) error {
	result, err := s.db.Collection(goalsCollection).UpdateOne(ctx,
		bson.D{{Key: "user_id", Value: userID}, {Key: "id", Value: id}},
		bson.D{
			{Key: "$push", Value: bson.D{{Key: "rounds", Value: bson.D{
				{Key: "$each", Value: bson.A{r}},
				{Key: "$slice", Value: -roundSummaryLimit},
			}}}},
			{Key: "$set", Value: bson.D{
				{Key: "last_verdict", Value: lastVerdict},
				{Key: "last_reason", Value: lastReason},
				{Key: "claimed_at", Value: nil},
				{Key: "queue_state", Value: "idle"},
				{Key: "updated_at", Value: now.UTC()},
			}},
		})
	if err != nil {
		return fmt.Errorf("append round: %w", err)
	}
	if result.MatchedCount == 0 {
		return ErrNotFound
	}
	return nil
}

// DueGoals returns the goals whose next round is due, soonest first.
//
// A goal with no next round time is not due: that is how a paused or finished
// goal stays out of the scheduler without a second condition.
func (s *Store) DueGoals(ctx context.Context, now time.Time, limit int) ([]*Goal, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	cur, err := s.db.Collection(goalsCollection).Find(ctx,
		bson.D{
			{Key: "status", Value: bson.D{{Key: "$in", Value: bson.A{string(goal.Running), string(goal.Verifying)}}}},
			{Key: "next_round_at", Value: bson.D{
				{Key: "$ne", Value: nil},
				{Key: "$lte", Value: now.UTC()},
			}},
		},
		options.Find().SetSort(bson.D{{Key: "next_round_at", Value: 1}}).SetLimit(int64(limit)))
	if err != nil {
		return nil, fmt.Errorf("list due goals: %w", err)
	}
	defer func() { _ = cur.Close(ctx) }()

	out := make([]*Goal, 0, 8)
	for cur.Next(ctx) {
		var g Goal
		if err := cur.Decode(&g); err != nil {
			return nil, fmt.Errorf("decode goal: %w", err)
		}
		out = append(out, &g)
	}
	return out, cur.Err()
}

// Outcome is everything one report changes on a goal document.
//
// It is written in a single conditional update so a pause that races a report
// cannot be half-applied: either the goal was in an expected status and at the
// expected round, or nothing moves.
type Outcome struct {
	From        []goal.Status
	ExpectRound int // -1 skips the round check (pauses and resumes)
	Status      goal.Status
	// StatusReason is the human-facing line; PauseReason the structured one.
	StatusReason  string
	PauseReason   goal.PauseReason
	Round         *int
	NextRoundAt   *time.Time
	ClearSchedule bool
	VerifyResult  *string
	Evidence      *string
	Missing       *[]string
	NoProgress    *int
	Result        *Result
	Summary       *Round
}

// ApplyOutcome writes one report's consequences.
func (s *Store) ApplyOutcome(ctx context.Context, userID, id string, o Outcome, now time.Time) error {
	if len(o.From) == 0 {
		return fmt.Errorf("apply outcome: no source status")
	}
	sources := make(bson.A, 0, len(o.From))
	for _, f := range o.From {
		sources = append(sources, string(f))
	}
	filter := bson.D{
		{Key: "user_id", Value: userID},
		{Key: "id", Value: id},
		{Key: "status", Value: bson.D{{Key: "$in", Value: sources}}},
	}
	if o.ExpectRound >= 0 {
		filter = append(filter, bson.E{Key: "round", Value: o.ExpectRound})
	}

	set := bson.D{
		{Key: "status", Value: o.Status},
		{Key: "status_reason", Value: o.StatusReason},
		{Key: "pause_reason", Value: o.PauseReason},
		{Key: "updated_at", Value: now.UTC()},
	}
	if o.Round != nil {
		set = append(set, bson.E{Key: "round", Value: *o.Round})
	}
	if o.ClearSchedule {
		set = append(set, bson.E{Key: "next_round_at", Value: nil})
		set = append(set, bson.E{Key: "claimed_at", Value: nil})
	} else if o.NextRoundAt != nil {
		set = append(set, bson.E{Key: "next_round_at", Value: o.NextRoundAt.UTC()})
		set = append(set, bson.E{Key: "claimed_at", Value: nil})
	}
	if o.VerifyResult != nil {
		set = append(set, bson.E{Key: "verify_result", Value: *o.VerifyResult})
	}
	if o.Evidence != nil {
		set = append(set, bson.E{Key: "evidence_digest", Value: *o.Evidence})
	}
	if o.Missing != nil {
		set = append(set, bson.E{Key: "last_missing", Value: *o.Missing})
	}
	if o.NoProgress != nil {
		set = append(set, bson.E{Key: "no_progress_rounds", Value: *o.NoProgress})
	}
	if o.Result != nil {
		set = append(set, bson.E{Key: "result", Value: o.Result})
		set = append(set, bson.E{Key: "ended_at", Value: now.UTC()})
	}
	if o.Status == goal.Cancelling {
		set = append(set, bson.E{Key: "cancel_requested_at", Value: now.UTC()})
	}
	if o.Status == goal.Running || o.Status == goal.Verifying {
		set = append(set, bson.E{Key: "queue_state", Value: "idle"})
	} else {
		set = append(set, bson.E{Key: "queue_state", Value: ""})
	}

	update := bson.D{{Key: "$set", Value: set}}
	if o.Summary != nil {
		update = append(update, bson.E{Key: "$push", Value: bson.D{{Key: "rounds", Value: bson.D{
			{Key: "$each", Value: bson.A{*o.Summary}},
			{Key: "$slice", Value: -roundSummaryLimit},
		}}}})
	}

	result, err := s.db.Collection(goalsCollection).UpdateOne(ctx, filter, update)
	if err != nil {
		return fmt.Errorf("apply outcome: %w", err)
	}
	if result.MatchedCount == 0 {
		return ErrConflict
	}
	return nil
}

// ReleaseClaim gives a claim back without touching the round.
//
// It is used when a round could not be delivered at all: holding the claim would
// make the scheduler wait out the whole lease before retrying a message that
// never left the process.
func (s *Store) ReleaseClaim(ctx context.Context, userID, id string) error {
	_, err := s.db.Collection(goalsCollection).UpdateOne(ctx,
		bson.D{{Key: "user_id", Value: userID}, {Key: "id", Value: id}},
		bson.D{{Key: "$set", Value: bson.D{
			{Key: "claimed_at", Value: nil},
			{Key: "queue_state", Value: "idle"},
		}}})
	if err != nil {
		return fmt.Errorf("release claim: %w", err)
	}
	return nil
}

// OverdueCancellations returns goals that asked to stop before the deadline and
// are still waiting for the agent to acknowledge it.
func (s *Store) OverdueCancellations(ctx context.Context, before time.Time, limit int) ([]*Goal, error) {
	if limit <= 0 {
		limit = 100
	}
	cur, err := s.db.Collection(goalsCollection).Find(ctx,
		bson.D{
			{Key: "status", Value: goal.Cancelling},
			{Key: "cancel_requested_at", Value: bson.D{{Key: "$ne", Value: nil}, {Key: "$lte", Value: before.UTC()}}},
		},
		options.Find().SetLimit(int64(limit)))
	if err != nil {
		return nil, fmt.Errorf("list overdue cancellations: %w", err)
	}
	defer func() { _ = cur.Close(ctx) }()

	out := make([]*Goal, 0, 4)
	for cur.Next(ctx) {
		var g Goal
		if err := cur.Decode(&g); err != nil {
			return nil, fmt.Errorf("decode goal: %w", err)
		}
		out = append(out, &g)
	}
	return out, cur.Err()
}

// CountActiveForAgent reports how many of an agent's goals hold the execution
// slot. The scheduler uses it to keep one round at a time per agent: two goals
// would edit the same working tree.
func (s *Store) CountActiveForAgent(ctx context.Context, agentID string) (int64, error) {
	n, err := s.db.Collection(goalsCollection).CountDocuments(ctx, bson.D{
		{Key: "agent_id", Value: agentID},
		{Key: "queue_state", Value: "running"},
	})
	if err != nil {
		return 0, fmt.Errorf("count active goals: %w", err)
	}
	return n, nil
}
