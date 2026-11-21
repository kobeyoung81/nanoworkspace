package engine

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"gitee.com/kobeyoung81/nanoworkspace/internal/goal"
	"gitee.com/kobeyoung81/nanoworkspace/internal/store"
)

// Verdicts the judge may return.
const (
	VerdictMet        = "met"
	VerdictNotYet     = "not_yet"
	VerdictImpossible = "impossible"
)

// ErrStaleRound is returned when a report arrives for a round the goal has
// already moved past: a retry of an old turn must not overwrite a newer one.
var ErrStaleRound = errors.New("report is for a different round")

// Evidence is one item of a round report, as the agent submitted it.
type Evidence struct {
	Kind  string     `json:"kind"`
	Cmd   string     `json:"cmd,omitempty"`
	Exit  *int       `json:"exit,omitempty"`
	Tail  string     `json:"tail,omitempty"`
	Path  string     `json:"path,omitempty"`
	Note  string     `json:"note,omitempty"`
	Items []ListItem `json:"items,omitempty"`
}

// ListItem is one checklist line.
type ListItem struct {
	Text string `json:"text"`
	Done bool   `json:"done"`
}

// Report is what goal_report posts when a round ends.
type Report struct {
	Round     int        `json:"round"`
	Verify    bool       `json:"verify,omitempty"`
	Summary   string     `json:"summary"`
	Evidence  []Evidence `json:"evidence"`
	Remaining []string   `json:"remaining,omitempty"`
	Verdict   string     `json:"verdict"`
	Reason    string     `json:"reason,omitempty"`
	Missing   []string   `json:"missing,omitempty"`
}

// validVerdict reports whether the judge's answer is one of the three.
func validVerdict(v string) bool {
	return v == VerdictMet || v == VerdictNotYet || v == VerdictImpossible
}

// Digest reduces the command evidence to a stable string: the sorted
// command=exit pairs. The verification round is compared against it, so two
// rounds that ran the same commands with the same codes agree regardless of
// order or of the output tail.
func Digest(evidence []Evidence) string {
	pairs := make([]string, 0, len(evidence))
	for _, e := range evidence {
		if e.Kind != "command" {
			continue
		}
		exit := "?"
		if e.Exit != nil {
			exit = strconv.Itoa(*e.Exit)
		}
		pairs = append(pairs, e.Cmd+"="+exit)
	}
	sort.Strings(pairs)
	sum := sha256.Sum256([]byte(strings.Join(pairs, "\n")))
	return hex.EncodeToString(sum[:])
}

// hasWork reports whether the round touched anything: a command it ran or a
// file it changed. A round of pure narration counts as no progress, which is how
// the host notices a goal that has stopped moving without the model admitting it.
func hasWork(evidence []Evidence) bool {
	for _, e := range evidence {
		if e.Kind == "command" || e.Kind == "file" {
			return true
		}
	}
	return false
}

// Decide turns a report into the goal's next state.
//
// It is a pure function of the goal and the report, so every branch — met, not
// yet, impossible, verification agreement and disagreement, the last round of
// the budget — is testable without a database.
func Decide(g *store.Goal, r Report, now time.Time, verifyEnabled bool) (store.Outcome, error) {
	if g == nil {
		return store.Outcome{}, fmt.Errorf("no goal")
	}
	if r.Round != g.Round {
		return store.Outcome{}, fmt.Errorf("%w: report round %d, goal round %d", ErrStaleRound, r.Round, g.Round)
	}
	if !validVerdict(r.Verdict) {
		return store.Outcome{}, fmt.Errorf("verdict %q is not met, not_yet or impossible", r.Verdict)
	}

	summary := &store.Round{N: g.Round, Verdict: r.Verdict, Files: countFiles(r.Evidence), At: now.UTC()}
	digest := Digest(r.Evidence)

	// The verification round re-proves a "met" verdict. Its own failure is not a
	// failure of the goal: it goes back to running with the note that the two
	// rounds disagreed.
	if r.Verify {
		if g.Status != goal.Verifying {
			return store.Outcome{}, fmt.Errorf("a verification report needs a goal in verifying, not %s", g.Status)
		}
		summary.Verdict = "verify_" + r.Verdict
		if digest == g.EvidenceDigest {
			res := &store.Result{
				Verdict: VerdictMet, Reason: r.Reason,
				Rounds: g.Round, Minutes: minutesSince(g, now), At: now.UTC(),
			}
			return store.Outcome{
				From: []goal.Status{goal.Verifying}, ExpectRound: g.Round,
				Status: goal.Achieved, StatusReason: "复验一致",
				VerifyResult: strPtr("ok"), Result: res,
				ClearSchedule: true, Summary: summary,
			}, nil
		}
		mismatch := "mismatch"
		next := now.UTC()
		round := g.Round + 1
		return store.Outcome{
			From: []goal.Status{goal.Verifying}, ExpectRound: g.Round,
			Status: goal.Running, StatusReason: "复验与上一轮报告不符，继续下一轮",
			VerifyResult: &mismatch, Round: &round, NextRoundAt: &next,
			Summary: summary,
		}, nil
	}

	// A work round.
	if g.Status != goal.Running {
		return store.Outcome{}, fmt.Errorf("a work report needs a goal in running, not %s", g.Status)
	}
	missing := r.Missing
	if len(missing) == 0 {
		missing = r.Remaining
	}

	switch r.Verdict {
	case VerdictImpossible:
		res := &store.Result{
			Verdict: VerdictImpossible, Reason: r.Reason,
			Rounds: g.Round, Minutes: minutesSince(g, now), At: now.UTC(),
		}
		return store.Outcome{
			From: []goal.Status{goal.Running}, ExpectRound: g.Round,
			Status: goal.Failed, StatusReason: "判据无法满足",
			ClearSchedule: true, Result: res, Summary: summary,
		}, nil

	case VerdictMet:
		if !verifyEnabled {
			res := &store.Result{
				Verdict: VerdictMet, Reason: r.Reason,
				Rounds: g.Round, Minutes: minutesSince(g, now), At: now.UTC(),
			}
			return store.Outcome{
				From: []goal.Status{goal.Running}, ExpectRound: g.Round,
				Status: goal.Achieved, StatusReason: "判定达成（未复验）",
				Result: res, ClearSchedule: true, Summary: summary,
			}, nil
		}
		// The verification round does not advance the counter and does not spend
		// budget: it proves, it does not progress.
		next := now.UTC()
		pending := "pending"
		return store.Outcome{
			From: []goal.Status{goal.Running}, ExpectRound: g.Round,
			Status: goal.Verifying, StatusReason: "判定达成，等待复验",
			VerifyResult: &pending, NextRoundAt: &next,
			Evidence: &digest, Missing: &missing,
			Summary: summary,
		}, nil
	}

	// not_yet: advance the round unless the budget is spent.
	noProgress := g.NoProgressRounds
	if hasWork(r.Evidence) {
		noProgress = 0
	} else {
		noProgress++
	}
	round := g.Round + 1
	if round >= g.MaxRounds && g.MaxRounds > 0 {
		out := store.Outcome{
			From: []goal.Status{goal.Running}, ExpectRound: g.Round,
			Status: goal.Paused, StatusReason: fmt.Sprintf("轮数用尽（%d 轮）", g.MaxRounds),
			PauseReason: goal.PauseBudget,
			Round:       &round, VerifyResult: strPtr(""), Evidence: &digest,
			Missing: &missing, NoProgress: &noProgress, ClearSchedule: true,
			Summary: summary,
		}
		return out, nil
	}
	next := now.UTC()
	return store.Outcome{
		From: []goal.Status{goal.Running}, ExpectRound: g.Round,
		Status: goal.Running, StatusReason: r.Reason,
		Round: &round, NextRoundAt: &next,
		Evidence: &digest, Missing: &missing, NoProgress: &noProgress,
		Summary: summary,
	}, nil
}

func countFiles(evidence []Evidence) int {
	n := 0
	for _, e := range evidence {
		if e.Kind == "file" {
			n++
		}
	}
	return n
}

func minutesSince(g *store.Goal, now time.Time) int {
	if g.StartedAt == nil {
		return 0
	}
	return int(now.Sub(*g.StartedAt).Minutes())
}

func strPtr(s string) *string { return &s }
