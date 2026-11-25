package engine

import (
	"strings"
	"testing"

	"gitee.com/kobeyoung81/nanoworkspace/internal/store"
)

// sampleGoal is a goal in the middle of its run: round 7 is about to start, so
// the previous round is 6 and both its verdict and its missing list are known.
func sampleGoal() *store.Goal {
	return &store.Goal{
		ID:          "g_1",
		Condition:   "internal/auth 下不再出现 OldToken 调用，且 go build/test 退出 0",
		Constraints: []string{"不改已有测试", "不装新依赖"},
		Round:       6,
		MaxRounds:   40,
		LastVerdict: "not_yet",
		LastReason:  "refresh.go 还有两处调用",
		LastMissing: []string{"refresh.go", "middleware.go", "两个测试夹具"},
	}
}

// firstRoundGoal is a goal whose first round has not run yet: no previous round,
// so the briefing must not pretend there is one.
func firstRoundGoal() *store.Goal {
	g := sampleGoal()
	g.Round = 0
	g.LastVerdict = ""
	g.LastReason = ""
	g.LastMissing = nil
	return g
}

// TestBuild_CarriesTheBrief pins the briefing's parts, in order: the goal, the
// boundaries, the plan excerpt, the missing list and the user's interjection all
// reach the round.
func TestBuild_CarriesTheBrief(t *testing.T) {
	in := Input{
		Goal:         sampleGoal(),
		PlanLines:    []string{"# 计划", "1. 建立接口骨架", "2. 逐个替换调用点"},
		Interjection: "先别动 middleware，我要确认一下",
	}
	out := Build(in, DefaultLimits())
	for _, want := range []string{
		"internal/auth 下不再出现 OldToken 调用",
		"要守住的边界",
		"不改已有测试",
		"计划（节选）",
		"1. 建立接口骨架",
		"判定员认为还差",
		"refresh.go",
		"你在轮末说过",
		"先别动 middleware",
		"goal_report",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("the brief is missing %q:\n%s", want, out)
		}
	}
	// The order is the product's (§5.4), not the order the fields happen to be
	// filled in: a brief whose "still missing" comes before the goal reads wrong.
	if i, j := strings.Index(out, "\n目标\n"), strings.Index(out, "判定员认为还差"); i < 0 || j < i {
		t.Errorf("the goal does not come before the missing list:\n%s", out)
	}
}

// TestBuild_SecondRoundCarriesTheLastRound is the whole point of the briefing:
// the second round is told what the judge said and what the agent itself claimed.
func TestBuild_SecondRoundCarriesTheLastRound(t *testing.T) {
	in := Input{Goal: sampleGoal(), LastSummary: "把 token 的读取换成了新接口，剩下 refresh 没动"}
	out := Build(in, DefaultLimits())
	for _, want := range []string{
		"上一轮（第 6 轮）",
		"判定员：还没有",
		"refresh.go 还有两处调用",
		"它自己的说法：",
		"把 token 的读取换成了新接口",
		"这一轮先处理「refresh.go」",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("the second round's brief is missing %q:\n%s", want, out)
		}
	}
}

// TestBuild_FirstRoundHasNoPreviousRound keeps the first round honest: it must
// not claim a verdict or a missing list that does not exist yet.
func TestBuild_FirstRoundHasNoPreviousRound(t *testing.T) {
	out := Build(Input{Goal: firstRoundGoal()}, DefaultLimits())
	if strings.Contains(out, "上一轮（第") {
		t.Errorf("the first round claims a previous round:\n%s", out)
	}
	if strings.Contains(out, "判定员认为还差") {
		t.Errorf("the first round claims a missing list:\n%s", out)
	}
	if !strings.Contains(out, "这是第一轮") {
		t.Errorf("the first round does not say so:\n%s", out)
	}
	// The briefing still carries the goal and the boundaries.
	if !strings.Contains(out, "要守住的边界") {
		t.Errorf("the first round dropped the boundaries:\n%s", out)
	}
}

// TestBuild_NoMissingListStillNamesAStep covers a round whose judge returned no
// missing items: the brief has to say what to do anyway.
func TestBuild_NoMissingListStillNamesAStep(t *testing.T) {
	g := sampleGoal()
	g.LastMissing = nil
	out := Build(Input{Goal: g}, DefaultLimits())
	if strings.Contains(out, "这一轮先处理「") {
		t.Errorf("the brief names a missing item that does not exist:\n%s", out)
	}
	if !strings.Contains(out, "把目标整条再过一遍") {
		t.Errorf("the brief gives no instruction at all:\n%s", out)
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
	// Room for everything except the plan.
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

// TestBuild_DropsTheMissingListLast covers the third slot: when even the
// interjection is gone and the budget is still short, the list goes too — but the
// line naming the first item stays, because it quotes that item.
func TestBuild_DropsTheMissingListLast(t *testing.T) {
	g := sampleGoal()
	base := Build(Input{Goal: g}, DefaultLimits())
	// A budget that fits neither the interjection nor the missing list.
	limits := Limits{MaxPlanLines: 60, MaxRemaining: 5, MaxInterjectionChars: 2000, MaxTotalChars: len(base) - 60}
	out := Build(Input{Goal: g, Interjection: strings.Repeat("i", 400)}, limits)
	if strings.Contains(out, "判定员认为还差") {
		t.Errorf("the remaining list survived a budget that dropped everything:\n%s", out)
	}
	if !strings.Contains(out, "这一轮先处理「refresh.go」") {
		t.Errorf("the instruction to take the first item went with the list:\n%s", out)
	}
}

// TestBuild_VerifyWording covers the verification round: it asks for a re-run
// and forbids quoting the earlier round.
func TestBuild_VerifyWording(t *testing.T) {
	out := Build(Input{Goal: sampleGoal(), Verify: true}, DefaultLimits())
	if !strings.Contains(out, "复验轮") {
		t.Errorf("no verification heading:\n%s", out)
	}
	if !strings.Contains(out, "是复核") {
		t.Errorf("the round does not say it is a re-check:\n%s", out)
	}
	if !strings.Contains(out, "不要引用上一轮的任何输出") {
		t.Errorf("the verification round may quote the first round:\n%s", out)
	}
	// The judge's "met" is what sent this round, and saying so is the context it
	// needs to re-prove the claim.
	if !strings.Contains(out, "判定员认为达成了") {
		t.Errorf("the verification round does not say why it is here:\n%s", out)
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

// TestClipRunes pins the two properties the brief relies on: runes are counted
// one by one (not bytes), and a cut is visible.
func TestClipRunes(t *testing.T) {
	if got := clipRunes("短", 10); got != "短" {
		t.Errorf("a short string was changed: %q", got)
	}
	long := strings.Repeat("判", 10)
	got := clipRunes(long, 4)
	if got != "判判判判…" {
		t.Errorf("clipRunes = %q, want four runes and an ellipsis", got)
	}
	if got := clipRunes("  多行 \n 文本  ", 40); got != "多行 文本" {
		t.Errorf("clipRunes did not collapse the whitespace: %q", got)
	}
	if got := clipRunes("x", 0); got != "" {
		t.Errorf("clipRunes(_, 0) = %q, want empty", got)
	}
}
