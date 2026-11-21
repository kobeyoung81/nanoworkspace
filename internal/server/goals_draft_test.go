package server

import (
	"testing"

	"gitee.com/kobeyoung81/nanoworkspace/internal/goal"
	"gitee.com/kobeyoung81/nanoworkspace/internal/store"
)

// TestParseBudget covers the one-line budget answer the card offers.
func TestParseBudget(t *testing.T) {
	cases := []struct {
		in      string
		rounds  int
		minutes int
	}{
		{"40 轮 / 180 分钟", 40, 180},
		{"20 轮，60 分钟", 20, 60},
		{"30", 30, 180},
		{"", 40, 180},
	}
	for _, tc := range cases {
		rounds, minutes := parseBudget(tc.in)
		if rounds != tc.rounds || minutes != tc.minutes {
			t.Errorf("parseBudget(%q) = %d/%d, want %d/%d", tc.in, rounds, minutes, tc.rounds, tc.minutes)
		}
	}
}

// TestDraftView_ShowsWhatIsMissing keeps the card and the start button reading
// the same six checks.
func TestDraftView_ShowsWhatIsMissing(t *testing.T) {
	s := &Server{}
	g := &store.Goal{
		Title:       "迁移 token",
		Condition:   "",
		Constraints: []string{"不改测试"},
		MaxRounds:   40,
		MaxMinutes:  180,
	}
	v := s.draftView(g).Verdict
	if v.Ready() {
		t.Fatal("a draft without a condition must not be ready")
	}
	found := false
	for _, m := range v.Missing {
		if m == goal.CheckCondition {
			found = true
		}
	}
	if !found {
		t.Fatalf("missing = %v, want the condition", v.Missing)
	}

	g.Condition = "没有 OldToken 调用"
	g.Proof = []store.ProofStep{{Kind: "command", Command: "go build ./..."}}
	v = s.draftView(g).Verdict
	if !v.Ready() {
		t.Fatalf("complete draft not ready: missing=%v", v.Missing)
	}
	if v.Progress() != 6 {
		t.Errorf("progress = %d, want 6", v.Progress())
	}
}
