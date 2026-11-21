package goal

import (
	"regexp"
	"strings"
)

// PlanParts is what the intake reads out of a plan file: the acceptance
// condition, how it is proven, and the steps. Nothing else is used — the goal
// document stores pointers, not a copy of the plan (design §14).
type PlanParts struct {
	Condition string
	Proof     []string
	Steps     []string
}

// OK reports whether the plan carries enough for a goal: a condition and at
// least one proof. Without both, the card falls back to asking the user.
func (p PlanParts) OK() bool {
	return strings.TrimSpace(p.Condition) != "" && len(p.Proof) > 0
}

// headingPattern matches a level-1..3 heading and captures its title, so the
// section lookup does not depend on the exact number of hashes the model chose.
var headingPattern = regexp.MustCompile(`^#{1,3}\s*(.+?)\s*$`)

// stepPattern strips "1." / "1、" / "-" / "*" from a list line.
var stepPattern = regexp.MustCompile(`^\s*(?:[-*+]|\d+[.)、．])\s+(.*\S)\s*$`)

// planSections names the headings this parser understands. The plan prompt asks
// for the Chinese ones; the English ones are accepted because a model that
// writes in English may translate the heading instead of quoting it.
var planSections = map[string]string{
	"验收": "condition", "完成条件": "condition", "acceptance": "condition",
	"证据": "proof", "怎么证明": "proof", "evidence": "proof",
	"步骤": "steps", "steps": "steps",
}

// maxPlanSteps bounds the quoted steps. The card shows three and the rest stays
// in the file, so a twenty-step plan is not an error — it is just truncated here.
const maxPlanSteps = 12

// ParsePlan extracts the three sections a goal needs.
//
// Headings are matched literally (the plan prompt says so); a plan written
// before that prompt existed simply yields an empty result and the card falls
// back to the interview.
func ParsePlan(md string) PlanParts {
	var out PlanParts
	current := ""
	for _, line := range strings.Split(md, "\n") {
		if m := headingPattern.FindStringSubmatch(line); m != nil {
			name := strings.ToLower(strings.TrimSpace(m[1]))
			current = planSections[name]
			continue
		}
		body := strings.TrimSpace(line)
		if body == "" {
			continue
		}
		switch current {
		case "condition":
			if out.Condition == "" {
				out.Condition = body
			}
		case "proof":
			if item := stepItem(body); item != "" {
				out.Proof = append(out.Proof, item)
			}
		case "steps":
			if len(out.Steps) >= maxPlanSteps {
				continue
			}
			if item := stepItem(body); item != "" {
				out.Steps = append(out.Steps, item)
			}
		}
	}
	return out
}

// stepItem reads one list line, or a plain sentence when the section is written
// as prose. Headings and fenced code are not items.
func stepItem(body string) string {
	if strings.HasPrefix(body, "```") {
		return ""
	}
	if m := stepPattern.FindStringSubmatch(body); m != nil {
		return strings.TrimSpace(m[1])
	}
	if strings.HasPrefix(body, "#") {
		return ""
	}
	return body
}
