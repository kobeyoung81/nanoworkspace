package goal

import (
	"errors"
	"testing"
)

// TestValidate_MatchesTheTable walks every pair of statuses: an edge must be
// accepted, and every other pair must be refused. Walking the whole grid is what
// keeps a new status from quietly becoming reachable from everywhere.
func TestValidate_MatchesTheTable(t *testing.T) {
	for _, from := range All() {
		for _, to := range All() {
			reason := PauseReason("")
			if to == Paused {
				reason = PauseUser
			}
			err := Validate(from, to, reason)
			want := CanTransition(from, to)
			switch {
			case want && err != nil:
				t.Errorf("%s → %s should be allowed, got %v", from, to, err)
			case !want && err == nil:
				t.Errorf("%s → %s should be refused", from, to)
			case !want && !errors.Is(err, ErrIllegalTransition):
				t.Errorf("%s → %s should be refused as illegal, got %v", from, to, err)
			}
		}
	}
}

// TestValidate_TerminalStatesHaveNoExit pins the three ends of the lifecycle.
func TestValidate_TerminalStatesHaveNoExit(t *testing.T) {
	for _, s := range All() {
		if Terminal(s) != (len(transitions[s]) == 0) {
			t.Errorf("%s: Terminal() disagrees with the table", s)
		}
	}
	for _, from := range []Status{Achieved, Failed, Cancelled} {
		for _, to := range All() {
			if CanTransition(from, to) {
				t.Errorf("%s → %s must not exist", from, to)
			}
		}
	}
}

// TestValidate_PauseNeedsItsReason covers the three ways to pause and the two
// ways to get the reason wrong.
func TestValidate_PauseNeedsItsReason(t *testing.T) {
	for _, reason := range []PauseReason{PauseUser, PauseStuck, PauseBudget} {
		if err := Validate(Running, Paused, reason); err != nil {
			t.Errorf("running → paused (%s) refused: %v", reason, err)
		}
	}
	for _, reason := range []PauseReason{"", "bored", "USER"} {
		if err := Validate(Running, Paused, reason); !errors.Is(err, ErrPauseReason) {
			t.Errorf("running → paused (%q) should fail with ErrPauseReason, got %v", reason, err)
		}
	}
	// A reason is only meaningful for a pause: carrying one into running would
	// make "why did this stop" answerable for a goal that never stopped.
	if err := Validate(Paused, Running, PauseUser); !errors.Is(err, ErrPauseReason) {
		t.Errorf("paused → running with a reason should fail with ErrPauseReason, got %v", err)
	}
}

// TestValidate_UnknownStatus rejects a value that is not a status at all.
func TestValidate_UnknownStatus(t *testing.T) {
	if err := Validate("running", Running, ""); err == nil {
		t.Fatal("a bare string should be refused")
	}
	if err := Validate(Running, "done", ""); err == nil {
		t.Fatal("an unknown target should be refused")
	}
}
