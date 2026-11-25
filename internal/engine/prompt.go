// Package engine runs the long-running goal loop: the 5-second scheduler, the
// prompt it injects, the decisions a round report produces, and the sweeper that
// finishes a stop nobody acknowledged.
//
// It lives outside internal/goal because it needs the store, and the store
// already imports the state machine. The state machine stays dependency-free;
// everything that reads or writes documents is here.
package engine

import (
	"fmt"
	"strings"

	"gitee.com/kobeyoung81/nanoworkspace/internal/store"
)

// Limits bounds what one round's instructions may carry. They exist because the
// injected text has to stay small enough to travel as one inbound message and
// leave room for the conversation it lands in.
type Limits struct {
	// MaxPlanLines is how much of the plan file is quoted.
	MaxPlanLines int
	// MaxRemaining is how many items of the previous round's "still missing"
	// survive.
	MaxRemaining int
	// MaxInterjectionChars is how much of the user's last message is quoted.
	MaxInterjectionChars int
	// MaxTotalChars is the budget for the whole injection. When it is exceeded
	// the plan goes first, then the interjection, then the remaining list; the
	// condition is never cut.
	MaxTotalChars int
}

// DefaultLimits are the values the deployment uses.
func DefaultLimits() Limits {
	return Limits{
		MaxPlanLines:         60,
		MaxRemaining:         5,
		MaxInterjectionChars: 2000,
		MaxTotalChars:        8000,
	}
}

// Input is everything one injection needs.
type Input struct {
	Goal      *store.Goal
	PlanLines []string
	// LastSummary is the agent's own account of the previous round, quoted back
	// to it as "what it said it did".
	LastSummary  string
	Interjection string
	// Verify asks for the verification wording instead of the work wording.
	Verify bool
	// Mismatch is set when the previous report and its verification disagreed:
	// the next work round has to say so.
	Mismatch bool
}

// Build renders the round's brief.
//
// It reads as a briefing, not as a command re-issued every round: the goal, the
// boundaries, what the judge said last time and what the agent itself claimed,
// what the judge still finds missing, and the one item to take first. The
// condition is quoted verbatim and never truncated: it is the only definition of
// "done", and a summarised condition is a different goal.
func Build(in Input, limits Limits) string {
	if limits.MaxTotalChars <= 0 {
		limits = DefaultLimits()
	}
	g := in.Goal

	head := headingBlock(in, g)
	plan := planBlock(in.PlanLines, limits.MaxPlanLines)
	inter := interjectionBlock(in.Interjection, limits.MaxInterjectionChars)
	remaining := missingBlock(g, limits.MaxRemaining)

	// Appearance order, then the order the budget drops them in. The plan goes
	// first, then the user's words, then the remaining list (product §5.4).
	blocks := []string{head.before, remaining, head.after, plan, inter}
	return fit(blocks, []int{3, 4, 1}, limits.MaxTotalChars)
}

// parts is the brief split around the one droppable section inside it: the
// previous round's "still missing" list sits between the two halves, and the
// budget may remove it without taking the instructions with it.
type parts struct {
	before string
	after  string
}

// headingBlock renders everything that is never dropped: the heading, the goal,
// the boundaries, the previous round and this round's instruction.
func headingBlock(in Input, g *store.Goal) parts {
	var before, after strings.Builder

	if in.Verify {
		before.WriteString("【长程目标 · 复验轮】\n")
	} else {
		fmt.Fprintf(&before, "【长程目标 · 第 %d 轮】\n", g.Round+1)
	}
	before.WriteString("\n目标\n")
	before.WriteString(g.Condition)
	before.WriteString("\n")
	if len(g.Constraints) > 0 {
		before.WriteString("\n要守住的边界\n")
		for _, c := range g.Constraints {
			fmt.Fprintf(&before, "- %s\n", c)
		}
	}

	if in.Verify {
		before.WriteString("\n上一轮判定员认为达成了")
		if r := oneLine(g.LastReason); r != "" {
			fmt.Fprintf(&before, " —— %s", r)
		}
		before.WriteString("\n")
		after.WriteString("\n这一轮不继续做，是复核：用自己的话复述上面的目标，然后重新执行能证明它的命令，")
		after.WriteString("贴出这一次的退出码与输出。不要引用上一轮的任何输出。\n")
		after.WriteString(reportTail)
		return parts{before: before.String(), after: after.String()}
	}

	if g.Round > 0 || g.LastVerdict != "" {
		fmt.Fprintf(&before, "\n上一轮（第 %d 轮）\n", g.Round)
		if r := oneLine(g.LastReason); r != "" {
			fmt.Fprintf(&before, "判定员：还没有达成 —— %s\n", r)
		} else {
			before.WriteString("判定员：还没有达成\n")
		}
		if s := oneLine(in.LastSummary); s != "" {
			fmt.Fprintf(&before, "它自己的说法：%s\n", s)
		} else {
			before.WriteString("它自己的说法：（这一轮没有留下总结）\n")
		}
		if in.Mismatch {
			before.WriteString("\n上一轮的报告与复验不符：先说明差异，再补齐能支撑结论的证据。\n")
		}
		// The remaining list itself follows as its own block.
		after.WriteString("\n")
		after.WriteString(focusLine(g.LastMissing))
	} else {
		before.WriteString("\n这是第一轮：先确认现状，再按计划推进。\n")
	}
	after.WriteString("\n")
	after.WriteString(reportTail)
	return parts{before: before.String(), after: after.String()}
}

// reportTail is the closing instruction, identical in both round kinds.
const reportTail = "结束时交一份带证据的报告（用 goal_report：命令与退出码 / 改动的文件 / 勾选清单），" +
	"没有证据不要声称完成。"

// focusLine names the one item to take first. It stays even when the list itself
// is dropped, because it repeats that item rather than pointing at the list.
func focusLine(missing []string) string {
	if len(missing) == 0 {
		return "这一轮把目标整条再过一遍，贴出能直接对应它的证据。\n"
	}
	return fmt.Sprintf(
		"这一轮先处理「%s」。如果你判断该先做别的，按你的判断做，但要在报告里说明理由。\n",
		oneLine(missing[0]),
	)
}

func planBlock(lines []string, max int) string {
	if len(lines) == 0 {
		return ""
	}
	if max <= 0 {
		max = 60
	}
	if len(lines) > max {
		lines = lines[:max]
	}
	return "\n计划（节选）\n" + strings.Join(lines, "\n") + "\n"
}

func interjectionBlock(text string, max int) string {
	text = strings.TrimSpace(text)
	if text == "" {
		return ""
	}
	if max > 0 && len([]rune(text)) > max {
		text = string([]rune(text)[:max]) + "…"
	}
	return "\n你在轮末说过\n" + text + "\n"
}

func missingBlock(g *store.Goal, max int) string {
	if g == nil || len(g.LastMissing) == 0 {
		return ""
	}
	items := g.LastMissing
	if max > 0 && len(items) > max {
		items = items[:max]
	}
	var b strings.Builder
	b.WriteString("\n判定员认为还差\n")
	for _, item := range items {
		fmt.Fprintf(&b, "- %s\n", item)
	}
	return b.String()
}

// fit joins the blocks, dropping the optional ones in `drop` order until the
// budget holds. Every index in `drop` must be optional; the blocks it leaves
// alone are the goal, the boundaries and this round's instructions.
func fit(blocks []string, drop []int, budget int) string {
	total := 0
	for _, b := range blocks {
		total += len(b)
	}
	if budget > 0 {
		for _, i := range drop {
			if total <= budget {
				break
			}
			if i < 0 || i >= len(blocks) {
				continue
			}
			total -= len(blocks[i])
			blocks[i] = ""
		}
	}
	var b strings.Builder
	for _, part := range blocks {
		b.WriteString(part)
	}
	return b.String()
}

// clipRunes shortens a string to at most n runes, marking the cut with an
// ellipsis. It counts runes rather than bytes: these strings are Chinese, and a
// byte limit would cut a character in half.
func clipRunes(s string, n int) string {
	s = oneLine(s)
	if n <= 0 {
		return ""
	}
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}

// oneLine collapses whitespace runs into single spaces. Every place a stored
// string is quoted into another string needs it: a summary written across three
// lines would otherwise break the brief's layout.
func oneLine(s string) string {
	return strings.Join(strings.Fields(s), " ")
}
