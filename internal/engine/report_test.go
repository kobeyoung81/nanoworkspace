package engine

import (
	"errors"
	"testing"
	"time"

	"gitee.com/kobeyoung81/nanoworkspace/internal/goal"
	"gitee.com/kobeyoung81/nanoworkspace/internal/store"
)

func runningGoal() *store.Goal {
	started := time.Now().UTC().Add(-30 * time.Minute)
	return &store.Goal{
		ID: "g_1", UserID: "u1", AgentID: "a1",
		Status: goal.Running, Round: 3, MaxRounds: 40,
		StartedAt: &started,
	}
}

func cmdEvidence(cmd string, exit int) []Evidence {
	return []Evidence{{Kind: "command", Cmd: cmd, Exit: &exit}}
}

// TestDecide_NotYetAdvancesTheRound is the ordinary round-to-round step.
func TestDecide_NotYetAdvancesTheRound(t *testing.T) {
	g := runningGoal()
	now := time.Now().UTC()
	out, err := Decide(g, Report{
		Round: 3, Verdict: VerdictNotYet, Reason: "还差 4 处",
		Evidence: cmdEvidence("go build ./...", 1), Missing: []string{"refresh.go"},
	}, now, true)
	if err != nil {
		t.Fatalf("decide: %v", err)
	}
	if out.Status != goal.Running || out.Round == nil || *out.Round != 4 {
		t.Fatalf("not_yet should advance to round 4, got %+v", out)
	}
	if out.NextRoundAt == nil {
		t.Error("the next round needs a time, or the scheduler never picks it up")
	}
	if out.Missing == nil || len(*out.Missing) != 1 {
		t.Error("the remaining list did not reach the goal")
	}
	if out.Summary == nil || out.Summary.Verdict != VerdictNotYet {
		t.Error("the round summary is missing")
	}
}

// TestDecide_MetStartsVerification pins that a "met" verdict is proven before it
// is believed: the goal moves to verifying and does not advance the round.
func TestDecide_MetStartsVerification(t *testing.T) {
	g := runningGoal()
	out, err := Decide(g, Report{
		Round: 3, Verdict: VerdictMet, Reason: "全部通过",
		Evidence: cmdEvidence("go build ./...", 0),
	}, time.Now().UTC(), true)
	if err != nil {
		t.Fatalf("decide: %v", err)
	}
	if out.Status != goal.Verifying {
		t.Fatalf("status = %s, want verifying", out.Status)
	}
	if out.Round != nil {
		t.Error("the verification round must not spend a round number")
	}
	if out.VerifyResult == nil || *out.VerifyResult != "pending" {
		t.Error("verification was not marked pending")
	}
}

// TestDecide_MetWithoutVerifyAchieves covers the switch being off.
func TestDecide_MetWithoutVerifyAchieves(t *testing.T) {
	out, err := Decide(runningGoal(), Report{
		Round: 3, Verdict: VerdictMet, Evidence: cmdEvidence("go build ./...", 0),
	}, time.Now().UTC(), false)
	if err != nil {
		t.Fatalf("decide: %v", err)
	}
	if out.Status != goal.Achieved || out.Result == nil {
		t.Fatalf("status = %s, want achieved with a result", out.Status)
	}
}

// TestDecide_VerificationAgrees is the happy ending: same commands, same codes.
func TestDecide_VerificationAgrees(t *testing.T) {
	g := runningGoal()
	g.Status = goal.Verifying
	g.VerifyResult = "pending"
	g.EvidenceDigest = Digest(cmdEvidence("go build ./...", 0))
	out, err := Decide(g, Report{
		Round: 3, Verify: true, Verdict: VerdictMet,
		Evidence: cmdEvidence("go build ./...", 0),
	}, time.Now().UTC(), true)
	if err != nil {
		t.Fatalf("decide: %v", err)
	}
	if out.Status != goal.Achieved {
		t.Fatalf("status = %s, want achieved", out.Status)
	}
}

// TestDecide_VerificationDisagrees is assertion #8: a report whose evidence the
// verification round cannot reproduce sends the goal back to running, and the
// next injection says so.
func TestDecide_VerificationDisagrees(t *testing.T) {
	g := runningGoal()
	g.Status = goal.Verifying
	g.VerifyResult = "pending"
	g.EvidenceDigest = Digest(cmdEvidence("go build ./...", 0))
	out, err := Decide(g, Report{
		Round: 3, Verify: true, Verdict: VerdictMet,
		Evidence: cmdEvidence("go build ./...", 1),
	}, time.Now().UTC(), true)
	if err != nil {
		t.Fatalf("decide: %v", err)
	}
	if out.Status != goal.Running {
		t.Fatalf("status = %s, want running: a mismatch is not a completion", out.Status)
	}
	if out.VerifyResult == nil || *out.VerifyResult != "mismatch" {
		t.Error("the mismatch was not recorded")
	}
	if out.Round == nil || *out.Round != 4 {
		t.Error("the goal must continue with the next round")
	}

	// The next injection states the disagreement.
	text := Build(Input{Goal: g, Mismatch: out.VerifyResult != nil && *out.VerifyResult == "mismatch"}, DefaultLimits())
	if !contains(text, "不符") {
		t.Error("the next round does not mention the mismatch")
	}
}

// TestDecide_ImpossibleFails covers the one verdict that ends a goal.
func TestDecide_ImpossibleFails(t *testing.T) {
	out, err := Decide(runningGoal(), Report{
		Round: 3, Verdict: VerdictImpossible, Reason: "判据自相矛盾",
		Evidence: []Evidence{{Kind: "list", Items: []ListItem{{Text: "x", Done: false}}}},
	}, time.Now().UTC(), true)
	if err != nil {
		t.Fatalf("decide: %v", err)
	}
	if out.Status != goal.Failed || out.Result == nil {
		t.Fatalf("status = %s, want failed", out.Status)
	}
}

// TestDecide_BudgetPausesInsteadOfFailing pins the product rule: the last round
// pauses the goal so a human can raise the budget; it does not fail it.
func TestDecide_BudgetPausesInsteadOfFailing(t *testing.T) {
	g := runningGoal()
	g.Round = 39
	g.MaxRounds = 40
	out, err := Decide(g, Report{
		Round: 39, Verdict: VerdictNotYet,
		Evidence: cmdEvidence("go build ./...", 1),
	}, time.Now().UTC(), true)
	if err != nil {
		t.Fatalf("decide: %v", err)
	}
	if out.Status != goal.Paused {
		t.Fatalf("status = %s, want paused", out.Status)
	}
	if out.PauseReason != goal.PauseBudget {
		t.Errorf("pause reason = %q, want budget", out.PauseReason)
	}
	if out.Result != nil {
		t.Error("a paused goal is not over: it must not carry a result")
	}
}

// TestDecide_NoWorkCountsAsNoProgress covers the host-side signal: a round that
// ran no command and changed no file adds to the stuck counter, and real work
// resets it.
func TestDecide_NoWorkCountsAsNoProgress(t *testing.T) {
	g := runningGoal()
	g.NoProgressRounds = 2
	out, err := Decide(g, Report{
		Round: 3, Verdict: VerdictNotYet,
		Evidence: []Evidence{{Kind: "list", Items: []ListItem{{Text: "think", Done: true}}}},
	}, time.Now().UTC(), true)
	if err != nil {
		t.Fatalf("decide: %v", err)
	}
	if out.NoProgress == nil || *out.NoProgress != 3 {
		t.Fatalf("no_progress = %v, want 3", out.NoProgress)
	}

	out, err = Decide(g, Report{
		Round: 3, Verdict: VerdictNotYet, Evidence: cmdEvidence("go build ./...", 1),
	}, time.Now().UTC(), true)
	if err != nil {
		t.Fatalf("decide: %v", err)
	}
	if out.NoProgress == nil || *out.NoProgress != 0 {
		t.Fatalf("no_progress = %v, want 0 after real work", out.NoProgress)
	}
}

// TestDecide_StaleRoundIsRefused keeps a retried old report from overwriting a
// newer round.
func TestDecide_StaleRoundIsRefused(t *testing.T) {
	_, err := Decide(runningGoal(), Report{Round: 2, Verdict: VerdictNotYet}, time.Now().UTC(), true)
	if !errors.Is(err, ErrStaleRound) {
		t.Fatalf("err = %v, want ErrStaleRound", err)
	}
}

// TestDecide_VerifyNeedsTheVerifyingStatus keeps a work-shaped report from
// driving the verification branch (and vice versa).
func TestDecide_VerifyNeedsTheVerifyingStatus(t *testing.T) {
	if _, err := Decide(runningGoal(), Report{Round: 3, Verify: true, Verdict: VerdictMet}, time.Now().UTC(), true); err == nil {
		t.Fatal("a verification report on a running goal must be refused")
	}
	g := runningGoal()
	g.Status = goal.Verifying
	if _, err := Decide(g, Report{Round: 3, Verdict: VerdictNotYet}, time.Now().UTC(), true); err == nil {
		t.Fatal("a work report on a verifying goal must be refused")
	}
}

func contains(s, sub string) bool {
	return len(sub) == 0 || (len(s) >= len(sub) && indexOf(s, sub) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
