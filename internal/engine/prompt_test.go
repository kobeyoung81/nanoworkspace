package engine

import (
	"strings"
	"testing"

	"gitee.com/kobeyoung81/nanoworkspace/internal/store"
)

func sampleGoal() *store.Goal {
	return &store.Goal{
		ID:          "g_1",
		Condition:   "internal/auth 下不再出现 OldToken 调用，且 go build/test 退出 0",
		Constraints: []string{"不改已有测试", "不装新依赖"},
		Round:       6,
		MaxRounds:   40,
		LastMissing: []string{"refresh.go", "middleware.go", "两个测试夹具"},
	}
}

// TestBuild_CarriesTheFiveParts is the injection contract: the condition, the
// constraints, the plan excerpt, the previous round's remaining list and the
// user's interjection all reach the round.
func TestBuild_CarriesTheFiveParts(t *testing.T) {
	in := Input{
		Goal:         sampleGoal(),
		PlanLines:    []string{"# 计划", "1. 建立接口骨架", "2. 逐个替换调用点"},
		Interjection: "先别动 middleware，我要确认一下",
	}
	out := Build(in, DefaultLimits())
	for _, want := range []string{
		"internal/auth 下不再出现 OldToken 调用",
		"不改已有测试",
		"1. 建立接口骨架",
		"refresh.go",
		"先别动 middleware",
		"goal_report",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("injection is missing %q:\n%s", want, out)
		}
	}
}

// TestBuild_NeverTruncatesTheCondition pins the one part that is never cut: a
// summarised condition is a different goal.
func TestBuild_NeverTruncatesTheCondition(t *testing.T) {
	long := strings.Repeat("判据", 3000) // 6000 runes, beyond the budget on its own
	g := sampleGoal()
	g.Condition = long
	in := Input{
		Goal:         g,
		PlanLines:    []string{strings.Repeat("x", 5000)},
		Interjection: strings.Repeat("y", 5000),
	}
	out := Build(in, Limits{MaxPlanLines: 60, MaxRemaining: 5, MaxInterjectionChars: 2000, MaxTotalChars: 8000})
	if !strings.Contains(out, long) {
		t.Fatal("the condition was truncated")
	}
	if strings.Contains(out, strings.Repeat("x", 5000)) {
		t.Error("the plan survived a budget that only fits the condition")
	}
}

// TestBuild_DropsInOrder pins the truncation order: plan, then interjection,
// then the remaining list.
func TestBuild_DropsInOrder(t *testing.T) {
	g := sampleGoal()
	in := Input{
		Goal:         g,
		PlanLines:    []string{strings.Repeat("p", 400)},
		Interjection: strings.Repeat("i", 400),
	}
	// The budget fits everything except the plan: the injection without a plan
	// or an interjection, plus room for the interjection alone.
	base := Build(Input{Goal: g}, DefaultLimits())
	limits := Limits{MaxPlanLines: 60, MaxRemaining: 5, MaxInterjectionChars: 2000, MaxTotalChars: len(base) + 450}
	out := Build(in, limits)
	if strings.Contains(out, strings.Repeat("p", 400)) {
		t.Error("the plan should be dropped first")
	}
	if !strings.Contains(out, strings.Repeat("i", 400)) {
		t.Error("the interjection should survive the plan")
	}
}

// TestBuild_VerifyWording covers the verification round: it asks for a re-run
// and forbids quoting the earlier round.
func TestBuild_VerifyWording(t *testing.T) {
	out := Build(Input{Goal: sampleGoal(), Verify: true}, DefaultLimits())
	if !strings.Contains(out, "复验轮") {
		t.Errorf("no verification heading:\n%s", out)
	}
	if !strings.Contains(out, "不要引用上一轮的任何输出") {
		t.Errorf("the verification round may quote the first round:\n%s", out)
	}
}

// TestBuild_MismatchIsStated pins the promise that a disagreement between the
// report and its verification reaches the next round in words.
func TestBuild_MismatchIsStated(t *testing.T) {
	out := Build(Input{Goal: sampleGoal(), Mismatch: true}, DefaultLimits())
	if !strings.Contains(out, "不符") {
		t.Errorf("the mismatch is not stated:\n%s", out)
	}
}
