package engine

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"gitee.com/kobeyoung81/nanoprotocol"
	"gitee.com/kobeyoung81/nanoworkspace/internal/goal"
	"gitee.com/kobeyoung81/nanoworkspace/internal/store"
)

// PlanReader supplies the head of a goal's plan file for the injection. The file
// lives in the agent container's volume, so the production reader goes through
// the tunnel; a nil reader simply omits that block.
type PlanReader interface {
	PlanLines(ctx context.Context, g *store.Goal) ([]string, error)
}

// Store is the persistence the engine needs. It is an interface so the tick and
// the sweeper can be tested without a database: what matters here is which call
// is made with which argument, not how Mongo stores it.
type Store interface {
	DueGoals(ctx context.Context, now time.Time, limit int) ([]*store.Goal, error)
	CountActiveForAgent(ctx context.Context, agentID string) (int64, error)
	ClaimRound(ctx context.Context, userID, id string, round int, now time.Time, lease time.Duration) (bool, error)
	ReleaseClaim(ctx context.Context, userID, id string) error
	SetStatus(ctx context.Context, userID, id string, from []goal.Status, to goal.Status, reason goal.PauseReason, statusReason string, now time.Time) error
	ApplyOutcome(ctx context.Context, userID, id string, o store.Outcome, now time.Time) error
	OverdueCancellations(ctx context.Context, before time.Time, limit int) ([]*store.Goal, error)
}

// Switch is the platform on/off switch.
type Switch interface {
	Enabled(ctx context.Context) bool
}

// Publisher posts one inbound message.
type Publisher interface {
	PostInbound(ctx context.Context, msg nanoprotocol.InboundMessage) error
}

// Config is the engine's policy.
type Config struct {
	// Lease is how long a claim is honoured before the round may be dispatched
	// again. It must exceed a normal round; a slow round that loses its claim is
	// re-dispatched with the same round number, which the claim makes safe.
	Lease time.Duration
	// Interval is the scheduler tick.
	Interval time.Duration
	// Verify enables the verification round after a "met" verdict.
	Verify bool
	// MaxMinutes is the wall-clock budget when a goal does not set one.
	MaxMinutes int
}

// DefaultConfig returns the deployment's values.
func DefaultConfig() Config {
	return Config{
		Lease:      5 * time.Minute,
		Interval:   5 * time.Second,
		Verify:     true,
		MaxMinutes: 180,
	}
}

// Engine is the goal loop.
type Engine struct {
	Store   Store
	Bus     Publisher
	Enabled Switch
	Plan    PlanReader

	Config Config

	// Now is overridable in tests.
	Now func() time.Time
}

// New builds an engine with defaults filled in.
func New(st Store, b Publisher, enabled Switch, cfg Config) *Engine {
	if cfg.Lease <= 0 {
		cfg.Lease = DefaultConfig().Lease
	}
	if cfg.Interval <= 0 {
		cfg.Interval = DefaultConfig().Interval
	}
	if cfg.MaxMinutes <= 0 {
		cfg.MaxMinutes = DefaultConfig().MaxMinutes
	}
	return &Engine{Store: st, Bus: b, Enabled: enabled, Config: cfg, Now: time.Now}
}

// Run ticks until the context is cancelled.
func (e *Engine) Run(ctx context.Context) {
	ticker := time.NewTicker(e.Config.Interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if _, err := e.Tick(ctx); err != nil {
				slog.Warn("goal tick failed", "error", err)
			}
			if err := e.Sweep(ctx); err != nil {
				slog.Warn("goal sweeper failed", "error", err)
			}
		}
	}
}

// Tick dispatches every round that is due. It returns how many were sent.
func (e *Engine) Tick(ctx context.Context) (int, error) {
	if e.Enabled == nil || !e.Enabled.Enabled(ctx) {
		return 0, nil
	}
	now := e.Now().UTC()
	due, err := e.Store.DueGoals(ctx, now, 100)
	if err != nil {
		return 0, err
	}

	sent := 0
	busy := map[string]bool{}
	for _, g := range due {
		if busy[g.AgentID] {
			continue
		}
		// The queue field says whether this goal is mid-round; a round already
		// dispatched but not reported keeps its claim, so this is a cheap guard
		// for the state the document already carries.
		if g.QueueState != "" && g.QueueState != "idle" {
			continue
		}
		// One round at a time per agent: two goals would edit the same working
		// tree. The loser stays queued for the next tick.
		if active, err := e.Store.CountActiveForAgent(ctx, g.AgentID); err != nil {
			slog.Warn("count active goals", "agent", g.AgentID, "error", err)
		} else if active > 0 {
			busy[g.AgentID] = true
			continue
		}
		if paused := e.budgetCheck(ctx, g, now); paused {
			busy[g.AgentID] = true
			continue
		}

		claimed, err := e.Store.ClaimRound(ctx, g.UserID, g.ID, g.Round, now, e.Config.Lease)
		if err != nil {
			return sent, err
		}
		if !claimed {
			continue
		}
		if err := e.dispatch(ctx, g); err != nil {
			// The round was not delivered: release the claim so the next tick
			// retries instead of waiting out the lease.
			if relErr := e.Store.ReleaseClaim(ctx, g.UserID, g.ID); relErr != nil {
				slog.Warn("release claim after a failed dispatch", "goal", g.ID, "error", relErr)
			}
			slog.Error("goal round not dispatched", "goal", g.ID, "round", g.Round, "error", err)
			continue
		}
		busy[g.AgentID] = true
		sent++
	}
	return sent, nil
}

// budgetCheck pauses a goal that has run out of rounds, wall clock or patience.
// It reports whether it paused the goal (so the agent is not dispatched again
// this tick).
func (e *Engine) budgetCheck(ctx context.Context, g *store.Goal, now time.Time) bool {
	var (
		reason goal.PauseReason
		text   string
	)
	switch {
	case g.MaxRounds > 0 && g.Round >= g.MaxRounds:
		reason, text = goal.PauseBudget, fmt.Sprintf("轮数用尽（%d 轮）", g.MaxRounds)
	case e.maxMinutes(g) > 0 && g.StartedAt != nil && now.Sub(*g.StartedAt) > time.Duration(e.maxMinutes(g))*time.Minute:
		reason, text = goal.PauseBudget, fmt.Sprintf("墙钟用尽（%d 分钟）", e.maxMinutes(g))
	case g.NoProgressRounds >= 3:
		reason, text = goal.PauseStuck, "连续 3 轮没有可观察的进展"
	default:
		return false
	}
	if err := e.Store.SetStatus(ctx, g.UserID, g.ID,
		[]goal.Status{goal.Running, goal.Verifying}, goal.Paused, reason, text, now); err != nil {
		slog.Warn("pause on budget failed", "goal", g.ID, "error", err)
		return false
	}
	slog.Info("goal paused", "goal", g.ID, "reason", reason, "text", text)
	return true
}

func (e *Engine) maxMinutes(g *store.Goal) int {
	if g.MaxMinutes > 0 {
		return g.MaxMinutes
	}
	return e.Config.MaxMinutes
}

// dispatch posts one round's inbound message.
func (e *Engine) dispatch(ctx context.Context, g *store.Goal) error {
	verify := g.Status == goal.Verifying
	in := Input{Goal: g, Verify: verify, Mismatch: g.VerifyResult == "mismatch"}
	if e.Plan != nil && !verify {
		if lines, err := e.Plan.PlanLines(ctx, g); err != nil {
			slog.Warn("plan excerpt unavailable", "goal", g.ID, "error", err)
		} else {
			in.PlanLines = lines
		}
	}
	content := Build(in, DefaultLimits())

	msg := nanoprotocol.InboundMessage{
		UserID:  g.UserID,
		AgentID: g.AgentID,
		// The conversation's key carries no channel (the shell strips `web:`), so
		// the round is addressed to the session the reader is actually in.
		SessionID: goal.DispatchSessionID(g.SessionKey, g.Channel),
		Channel:   g.Channel,
		ChatID:    g.ChatID,
		SenderID:  "goal",
		Content:   content,
		Timestamp: e.Now().UTC(),
		Metadata: map[string]any{
			"source":     "goal",
			"goal_id":    g.ID,
			"round":      g.Round,
			"agent_mode": "build",
			"verify":     verify,
		},
	}
	return e.Bus.PostInbound(ctx, msg)
}
