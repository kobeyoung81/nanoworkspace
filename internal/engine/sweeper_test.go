package engine

import (
	"context"
	"testing"
	"time"

	"gitee.com/kobeyoung81/nanoworkspace/internal/goal"
	"gitee.com/kobeyoung81/nanoworkspace/internal/store"
)

// TestSweep_FinishesAnUnacknowledgedStop is assertion #9: a goal stuck in
// cancelling is moved to cancelled by the host after the grace period, and the
// round it interrupted is recorded as such.
func TestSweep_FinishesAnUnacknowledgedStop(t *testing.T) {
	requested := time.Now().UTC().Add(-2 * time.Minute)
	g := &store.Goal{
		ID: "g_1", UserID: "u1", AgentID: "a1",
		Status: goal.Cancelling, Round: 5, CancelRequestedAt: &requested,
	}
	st := &fakeStore{overdue: []*store.Goal{g}}
	e := New(st, &fakeBus{}, fakeSwitch{on: true}, DefaultConfig())
	if err := e.Sweep(context.Background()); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if st.outcomes != 1 {
		t.Fatalf("outcomes = %d, want 1", st.outcomes)
	}
	if st.lastValue.Status != goal.Cancelled {
		t.Errorf("status = %s, want cancelled", st.lastValue.Status)
	}
	if !st.lastValue.ClearSchedule {
		t.Error("a cancelled goal must lose its schedule")
	}
	if st.lastValue.Summary == nil || st.lastValue.Summary.Verdict != "interrupted" {
		t.Errorf("summary = %+v, want an interrupted round", st.lastValue.Summary)
	}
	if st.lastValue.Summary != nil && st.lastValue.Summary.N != 5 {
		t.Errorf("summary round = %d, want the round that was interrupted", st.lastValue.Summary.N)
	}
}

// TestSweep_NothingToDoIsQuiet keeps the normal tick free of writes.
func TestSweep_NothingToDoIsQuiet(t *testing.T) {
	st := &fakeStore{}
	e := New(st, &fakeBus{}, fakeSwitch{on: true}, DefaultConfig())
	if err := e.Sweep(context.Background()); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if st.outcomes != 0 {
		t.Fatal("the sweeper wrote to a goal it should not have touched")
	}
}
