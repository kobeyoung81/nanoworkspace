// Package goal holds the long-running goal state machine.
//
// The goal itself (its condition, rounds and summaries) lives in the store; this
// package answers the one question every caller asks before writing: may the
// goal move from here to there, and if it stops, who stopped it. Keeping the
// table here means the scheduler, the HTTP endpoints and the sweeper cannot each
// invent their own edges.
package goal

import (
	"errors"
	"fmt"
)

// Status is the lifecycle position of one goal.
type Status string

const (
	// Draft is a goal being assembled: the user is still answering the six
	// acceptance questions. Nothing is dispatched from here.
	Draft Status = "draft"
	// Validating is a submitted draft whose condition and proof are being
	// checked. It may go back to Draft with what is missing.
	Validating Status = "validating"
	// Ready is a complete goal that has not started. The user confirms it.
	Ready Status = "ready"
	// Running is the normal state between rounds.
	Running Status = "running"
	// Paused is a stop with a reason: the user paused it, the agent got stuck,
	// or the budget ran out. It never advances on its own.
	Paused Status = "paused"
	// Verifying is the extra round that re-proves a "met" verdict.
	Verifying Status = "verifying"
	// Cancelling is a stop in progress. The agent is asked to stop; the sweeper
	// moves it to Cancelled after the grace period even if it never answers.
	Cancelling Status = "cancelling"
	// Achieved, Failed and Cancelled are terminal: no edge leaves them.
	Achieved  Status = "achieved"
	Failed    Status = "failed"
	Cancelled Status = "cancelled"
)

// PauseReason says why a goal is paused. The value is stored and shown, never
// parsed by the scheduler: what matters there is "paused", not the flavour.
type PauseReason string

const (
	// PauseUser is the user pressing pause.
	PauseUser PauseReason = "user"
	// PauseStuck is the agent reporting no progress for several rounds.
	PauseStuck PauseReason = "stuck"
	// PauseBudget is a round or wall-clock budget running out.
	PauseBudget PauseReason = "budget"
)

// ErrIllegalTransition is returned for an edge the table does not contain.
var ErrIllegalTransition = errors.New("illegal goal transition")

// ErrPauseReason is returned when a pause carries no reason, or a non-pause
// carries one.
var ErrPauseReason = errors.New("pause reason")

// transitions is the whole lifecycle. A missing entry is a refused edge; the
// three terminal states map to nothing at all.
var transitions = map[Status]map[Status]bool{
	Draft:      {Validating: true},
	Validating: {Ready: true, Draft: true},
	Ready:      {Running: true, Cancelling: true},
	Running:    {Paused: true, Verifying: true, Cancelling: true, Achieved: true, Failed: true},
	Paused:     {Running: true, Cancelling: true, Failed: true},
	Verifying:  {Achieved: true, Running: true, Failed: true},
	Cancelling: {Cancelled: true},
	Achieved:   {},
	Failed:     {},
	Cancelled:  {},
}

// All returns every status, for table-driven tests and validation.
func All() []Status {
	return []Status{Draft, Validating, Ready, Running, Paused, Verifying, Cancelling, Achieved, Failed, Cancelled}
}

// CanTransition reports whether from→to is one of the lifecycle's edges.
func CanTransition(from, to Status) bool {
	return transitions[from][to]
}

// Terminal reports whether a status has no outgoing edge.
func Terminal(s Status) bool {
	return s == Achieved || s == Failed || s == Cancelled
}

// Validate checks a transition together with its pause reason.
//
// The reason is part of the transition, not an annotation: pausing without one
// would leave a goal nobody can explain later, and a reason on a non-pause would
// make "why did this stop" ambiguous.
func Validate(from, to Status, reason PauseReason) error {
	if err := ValidateStatus(from); err != nil {
		return err
	}
	if err := ValidateStatus(to); err != nil {
		return err
	}
	if !CanTransition(from, to) {
		return fmt.Errorf("%w: %s → %s", ErrIllegalTransition, from, to)
	}
	if to == Paused {
		switch reason {
		case PauseUser, PauseStuck, PauseBudget:
			return nil
		case "":
			return fmt.Errorf("%w: pausing requires user, stuck or budget", ErrPauseReason)
		default:
			return fmt.Errorf("%w: %q is not user, stuck or budget", ErrPauseReason, reason)
		}
	}
	if reason != "" {
		return fmt.Errorf("%w: %q belongs to paused, not %s", ErrPauseReason, reason, to)
	}
	return nil
}

// ValidateStatus rejects a value that is not one of the ten statuses.
func ValidateStatus(s Status) error {
	if _, ok := transitions[s]; !ok {
		return fmt.Errorf("unknown goal status %q", s)
	}
	return nil
}
