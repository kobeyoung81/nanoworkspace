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
	Goal         *store.Goal
	PlanLines    []string
	Interjection string
	// Verify asks for the verification wording instead of the work wording.
	Verify bool
	// Mismatch is set when the previous report and its verification disagreed:
	// the next work round has to say so.
	Mismatch bool
}

// Build renders the round's instructions.
//
// The condition is quoted verbatim and never truncated: it is the only
// definition of "done", and a summarised condition is a different goal.
func Build(in Input, limits Limits) string {
	if limits.MaxTotalChars <= 0 {
		limits = DefaultLimits()
	}
	g := in.Goal

	var b strings.Builder
	if in.Verify {
		fmt.Fprintf(&b, "【长程目标 · 复验轮】\n判据：\n%s\n", g.Condition)
		if len(g.Constraints) > 0 {
			b.WriteString("\n约束：\n")
			for _, c := range g.Constraints {
				fmt.Fprintf(&b, "- %s\n", c)
			}
		}
		b.WriteString("\n用你自己的话复述上面的判据，然后重新执行证明它的命令，贴出新的退出码与输出。")
		b.WriteString("不要引用上一轮的任何输出。")
		b.WriteString("\n结束时调用 goal_report 交这一轮的证据。")
		return b.String()
	}

	fmt.Fprintf(&b, "【长程目标 · 第 %d 轮】\n", g.Round+1)
	fmt.Fprintf(&b, "判据（全部满足才算完成）：\n%s\n", g.Condition)
	if len(g.Constraints) > 0 {
		b.WriteString("\n约束：\n")
		for _, c := range g.Constraints {
			fmt.Fprintf(&b, "- %s\n", c)
		}
	}

	base := b.String()
	plan := planBlock(in.PlanLines, limits.MaxPlanLines)
	inter := interjectionBlock(in.Interjection, limits.MaxInterjectionChars)
	remaining := remainingBlock(g, limits.MaxRemaining)

	// Fixed slots, so the budget can drop them in a known order.
	blocks := [4]string{base, plan, inter, remaining}
	body := strings.Join(fit(blocks, limits.MaxTotalChars), "")
	var tail strings.Builder
	if in.Mismatch {
		tail.WriteString("\n上一轮的报告与复验不符：请先说明差异，再补齐能支撑结论的证据。\n")
	}
	tail.WriteString("\n这一轮继续推进；结束时调用 goal_report 交结构化证据（命令要带退出码），")
	tail.WriteString("没有证据不要声称完成。")
	return body + tail.String()
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
	return "\n计划（节选）：\n" + strings.Join(lines, "\n") + "\n"
}

func interjectionBlock(text string, max int) string {
	text = strings.TrimSpace(text)
	if text == "" {
		return ""
	}
	if max > 0 && len([]rune(text)) > max {
		text = string([]rune(text)[:max]) + "…"
	}
	return "\n你上次轮末之后说过：\n" + text + "\n"
}

func remainingBlock(g *store.Goal, max int) string {
	if g == nil || len(g.LastMissing) == 0 {
		return ""
	}
	items := g.LastMissing
	if max > 0 && len(items) > max {
		items = items[:max]
	}
	var b strings.Builder
	b.WriteString("\n上一轮还差的：\n")
	for _, item := range items {
		fmt.Fprintf(&b, "- %s\n", item)
	}
	return b.String()
}

// fit drops the optional blocks until the budget holds, in the order the product
// fixed: the plan goes first, then the interjection, then the remaining list.
// The first slot (condition and constraints) is never touched.
func fit(blocks [4]string, budget int) []string {
	total := 0
	for _, b := range blocks {
		total += len(b)
	}
	if budget > 0 {
		for _, i := range []int{1, 2, 3} {
			if total <= budget {
				break
			}
			total -= len(blocks[i])
			blocks[i] = ""
		}
	}
	out := make([]string, 0, 4)
	for _, b := range blocks {
		if b != "" {
			out = append(out, b)
		}
	}
	return out
}
