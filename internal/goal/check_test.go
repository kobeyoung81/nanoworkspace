package goal

import (
	"strings"
	"testing"
)

func fullDraft() DraftFields {
	return DraftFields{
		Title:       "迁移 token",
		Condition:   "没有 OldToken 调用",
		Proof:       []string{"go build ./..."},
		Constraints: []string{"不改测试"},
		Approach:    "先建接口，再逐个替换",
		MaxRounds:   40,
		MaxMinutes:  180,
	}
}

// TestIntake_CompleteIsReady is the happy path: six filled, no blocker.
func TestIntake_CompleteIsReady(t *testing.T) {
	v := Intake(fullDraft())
	if !v.Ready() {
		t.Fatalf("a complete draft is not ready: missing=%v blockers=%v", v.Missing, v.Blockers)
	}
	if v.Progress() != 6 {
		t.Errorf("progress = %d, want 6", v.Progress())
	}
	if len(v.Risks) < 2 {
		t.Errorf("risks = %v, want the two standing lines", v.Risks)
	}
}

// TestIntake_EachMissingFieldIsNamed keeps "还差什么" honest: every field the
// card needs has its own check.
func TestIntake_EachMissingFieldIsNamed(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*DraftFields)
		want   string
	}{
		{"condition", func(d *DraftFields) { d.Condition = "  " }, CheckCondition},
		{"proof", func(d *DraftFields) { d.Proof = nil }, CheckProof},
		{"approach", func(d *DraftFields) { d.Approach = "" }, CheckApproach},
		{"constraints", func(d *DraftFields) { d.Constraints = []string{" "} }, CheckConstraints},
		{"budget", func(d *DraftFields) { d.MaxRounds = 0 }, CheckBudget},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d := fullDraft()
			tc.mutate(&d)
			v := Intake(d)
			if v.Ready() {
				t.Fatal("an incomplete draft must not be ready")
			}
			found := false
			for _, m := range v.Missing {
				if m == tc.want {
					found = true
				}
			}
			if !found {
				t.Fatalf("missing = %v, want %q", v.Missing, tc.want)
			}
			if line := v.MissingLine(); !strings.Contains(line, "/6") {
				t.Errorf("line = %q, want the progress denominator", line)
			}
		})
	}
}

// TestIntake_AskPermissionBlocks covers the sixth check: a belt that can still
// ask would hang a round with nobody behind it, so it blocks the start.
func TestIntake_AskPermissionBlocks(t *testing.T) {
	d := fullDraft()
	d.PermissionNeeded = true
	v := Intake(d)
	if v.Ready() {
		t.Fatal("a goal that can block on a question must not start")
	}
	if len(v.Blockers) != 1 {
		t.Fatalf("blockers = %v", v.Blockers)
	}
	if len(v.Missing) != 0 {
		t.Errorf("a blocker is not a missing field: %v", v.Missing)
	}
	if len(v.Risks) != 3 {
		t.Errorf("risks = %v, want the extra permission line", v.Risks)
	}
}
