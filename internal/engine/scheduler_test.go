package engine

import (
	"context"
	"errors"
	"testing"
	"time"

	"gitee.com/kobeyoung81/nanoprotocol"
	"gitee.com/kobeyoung81/nanoworkspace/internal/goal"
	"gitee.com/kobeyoung81/nanoworkspace/internal/store"
)

type fakeSwitch struct{ on bool }

func (f fakeSwitch) Enabled(context.Context) bool { return f.on }

type fakeBus struct {
	sent []nanoprotocol.InboundMessage
	err  error
}

func (f *fakeBus) PostInbound(_ context.Context, msg nanoprotocol.InboundMessage) error {
	if f.err != nil {
		return f.err
	}
	f.sent = append(f.sent, msg)
	return nil
}

type statusCall struct {
	id     string
	to     goal.Status
	reason goal.PauseReason
}

type fakeStore struct {
	due       []*store.Goal
	claimOK   bool
	claimed   []string
	released  []string
	statuses  []statusCall
	outcomes  int
	overdue   []*store.Goal
	lastValue store.Outcome
	active    int64
}

func (f *fakeStore) DueGoals(_ context.Context, _ time.Time, _ int) ([]*store.Goal, error) {
	return f.due, nil
}

func (f *fakeStore) CountActiveForAgent(_ context.Context, _ string) (int64, error) {
	return f.active, nil
}

func (f *fakeStore) ClaimRound(_ context.Context, _ string, id string, _ int, _ time.Time, _ time.Duration) (bool, error) {
	if !f.claimOK {
		return false, nil
	}
	f.claimed = append(f.claimed, id)
	return true, nil
}

func (f *fakeStore) ReleaseClaim(_ context.Context, _ string, id string) error {
	f.released = append(f.released, id)
	return nil
}

func (f *fakeStore) SetStatus(_ context.Context, _ string, id string, _ []goal.Status, to goal.Status, reason goal.PauseReason, _ string, _ time.Time) error {
	f.statuses = append(f.statuses, statusCall{id: id, to: to, reason: reason})
	return nil
}

func (f *fakeStore) ApplyOutcome(_ context.Context, _ string, _ string, o store.Outcome, _ time.Time) error {
	f.outcomes++
	f.lastValue = o
	return nil
}

func (f *fakeStore) OverdueCancellations(_ context.Context, _ time.Time, _ int) ([]*store.Goal, error) {
	return f.overdue, nil
}

func dueGoal() *store.Goal {
	started := time.Now().UTC()
	next := started.Add(-time.Second)
	return &store.Goal{
		ID: "g_1", UserID: "u1", AgentID: "a1",
		Channel: "web", ChatID: "c1", SessionKey: "web:c1",
		Status: goal.Running, Round: 7, MaxRounds: 40,
		StartedAt: &started, NextRoundAt: &next, QueueState: "idle",
		Condition: "all tests pass",
	}
}

// TestTick_DisabledSendsNothing is assertion #10: with the platform switch off,
// a due goal dispatches nothing at all.
func TestTick_DisabledSendsNothing(t *testing.T) {
	st := &fakeStore{due: []*store.Goal{dueGoal()}, claimOK: true}
	bus := &fakeBus{}
	e := New(st, bus, fakeSwitch{on: false}, DefaultConfig())
	sent, err := e.Tick(context.Background())
	if err != nil {
		t.Fatalf("tick: %v", err)
	}
	if sent != 0 || len(bus.sent) != 0 {
		t.Fatalf("sent %d with the switch off", len(bus.sent))
	}
	if len(st.claimed) != 0 {
		t.Fatal("a claim was taken with the switch off")
	}
}

// TestTick_DispatchCarriesTheMetadata is assertion #6: the inbound carries the
// four keys, and dropping agent_mode must be visible in this test.
func TestTick_DispatchCarriesTheMetadata(t *testing.T) {
	st := &fakeStore{due: []*store.Goal{dueGoal()}, claimOK: true}
	bus := &fakeBus{}
	e := New(st, bus, fakeSwitch{on: true}, DefaultConfig())
	if sent, err := e.Tick(context.Background()); err != nil || sent != 1 {
		t.Fatalf("tick = %d, %v; want 1", sent, err)
	}
	if len(bus.sent) != 1 {
		t.Fatalf("sent %d messages", len(bus.sent))
	}
	msg := bus.sent[0]
	if msg.SessionID != "web:c1" || msg.ChatID != "c1" || msg.Channel != "web" || msg.SenderID != "goal" {
		t.Errorf("the round is not addressed to the base key: %+v", msg)
	}
	for key, want := range map[string]any{
		"source": "goal", "goal_id": "g_1", "round": 7, "agent_mode": "build",
	} {
		got, ok := msg.Metadata[key]
		if !ok {
			t.Errorf("metadata is missing %q", key)
			continue
		}
		if got != want {
			t.Errorf("metadata[%q] = %v, want %v", key, got, want)
		}
	}
	if msg.Content == "" {
		t.Error("the round carries no instructions")
	}
}

// TestTick_ClaimLostSendsNothing keeps two schedulers from double-dispatching.
func TestTick_ClaimLostSendsNothing(t *testing.T) {
	st := &fakeStore{due: []*store.Goal{dueGoal()}, claimOK: false}
	bus := &fakeBus{}
	e := New(st, bus, fakeSwitch{on: true}, DefaultConfig())
	if sent, _ := e.Tick(context.Background()); sent != 0 || len(bus.sent) != 0 {
		t.Fatal("a lost claim still dispatched a round")
	}
}

// TestTick_BudgetPauses covers the three ways a due goal stops instead of
// running: rounds spent, wall clock spent, patience spent.
func TestTick_BudgetPauses(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*store.Goal)
		want   goal.PauseReason
	}{
		{"rounds", func(g *store.Goal) { g.Round = 40 }, goal.PauseBudget},
		{"clock", func(g *store.Goal) {
			old := time.Now().UTC().Add(-4 * time.Hour)
			g.StartedAt = &old
		}, goal.PauseBudget},
		{"stuck", func(g *store.Goal) { g.NoProgressRounds = 3 }, goal.PauseStuck},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			g := dueGoal()
			tc.mutate(g)
			st := &fakeStore{due: []*store.Goal{g}, claimOK: true}
			bus := &fakeBus{}
			e := New(st, bus, fakeSwitch{on: true}, DefaultConfig())
			sent, err := e.Tick(context.Background())
			if err != nil {
				t.Fatalf("tick: %v", err)
			}
			if sent != 0 || len(bus.sent) != 0 {
				t.Fatal("a goal over budget was dispatched")
			}
			if len(st.statuses) != 1 || st.statuses[0].to != goal.Paused || st.statuses[0].reason != tc.want {
				t.Fatalf("status calls = %+v, want one pause(%s)", st.statuses, tc.want)
			}
		})
	}
}

// TestTick_ReleasesTheClaimWhenTheBusRefuses keeps a failed post from blocking
// the goal for the whole lease.
func TestTick_ReleasesTheClaimWhenTheBusRefuses(t *testing.T) {
	st := &fakeStore{due: []*store.Goal{dueGoal()}, claimOK: true}
	bus := &fakeBus{err: errors.New("bus down")}
	e := New(st, bus, fakeSwitch{on: true}, DefaultConfig())
	if sent, _ := e.Tick(context.Background()); sent != 0 {
		t.Fatal("a failed dispatch counted as sent")
	}
	if len(st.released) != 1 {
		t.Fatalf("claim releases = %v, want one", st.released)
	}
}

// TestTick_VerifyingRoundIsMarked proves the verifying status changes the
// instruction and the metadata rather than only the wording.
func TestTick_VerifyingRoundIsMarked(t *testing.T) {
	g := dueGoal()
	g.Status = goal.Verifying
	st := &fakeStore{due: []*store.Goal{g}, claimOK: true}
	bus := &fakeBus{}
	e := New(st, bus, fakeSwitch{on: true}, DefaultConfig())
	if _, err := e.Tick(context.Background()); err != nil {
		t.Fatalf("tick: %v", err)
	}
	if len(bus.sent) != 1 {
		t.Fatalf("sent %d", len(bus.sent))
	}
	if v, _ := bus.sent[0].Metadata["verify"].(bool); !v {
		t.Error("the verification round is not marked verify=true")
	}
	if !contains(bus.sent[0].Content, "复验轮") {
		t.Error("the verification round uses the work wording")
	}
}

// TestTick_OneGoalPerAgent keeps two of an agent's goals from editing the same
// working tree at once: the second waits for the next tick.
func TestTick_OneGoalPerAgent(t *testing.T) {
	second := dueGoal()
	second.ID = "g_2"
	st := &fakeStore{due: []*store.Goal{dueGoal(), second}, claimOK: true, active: 1}
	bus := &fakeBus{}
	e := New(st, bus, fakeSwitch{on: true}, DefaultConfig())
	if sent, err := e.Tick(context.Background()); err != nil || sent != 0 {
		t.Fatalf("tick = %d, %v; want 0 while the agent is busy", sent, err)
	}
	if len(bus.sent) != 0 {
		t.Fatal("a round was dispatched for an agent that already has one running")
	}
}
