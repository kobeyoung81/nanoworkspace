package engine

import (
	"context"
	"log/slog"
	"time"

	"gitee.com/kobeyoung81/nanoworkspace/internal/goal"
	"gitee.com/kobeyoung81/nanoworkspace/internal/store"
)

// CancelGrace is how long a goal may stay in cancelling before the host finishes
// the stop by itself. The agent is asked first (the round in flight sees the
// stop), but a container that died mid-round never answers.
const CancelGrace = 60 * time.Second

// Sweep finishes stops nobody acknowledged.
func (e *Engine) Sweep(ctx context.Context) error {
	now := e.Now().UTC()
	overdue, err := e.Store.OverdueCancellations(ctx, now.Add(-CancelGrace), 100)
	if err != nil {
		return err
	}
	for _, g := range overdue {
		summary := &store.Round{N: g.Round, Verdict: "interrupted", At: now}
		out := store.Outcome{
			From:          []goal.Status{goal.Cancelling},
			ExpectRound:   -1,
			Status:        goal.Cancelled,
			StatusReason:  "已停止（60 秒内未收到应答，由平台收尾）",
			ClearSchedule: true,
			Summary:       summary,
		}
		if err := e.Store.ApplyOutcome(ctx, g.UserID, g.ID, out, now); err != nil {
			slog.Warn("sweep cancellation failed", "goal", g.ID, "error", err)
			continue
		}
		slog.Info("goal cancelled by sweeper", "goal", g.ID)
	}
	return nil
}
