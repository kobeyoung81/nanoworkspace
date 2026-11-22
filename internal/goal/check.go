package goal

import (
	"fmt"
	"strings"
)

// The six things a goal needs before it may start (design §13). The first five
// come from the draft; the sixth is answered by the host, which can see the
// build belt.
const (
	CheckCondition   = "condition"
	CheckProof       = "proof"
	CheckApproach    = "approach"
	CheckConstraints = "constraints"
	CheckBudget      = "budget"
	CheckPermission  = "permissions"
)

// CheckNames is the order the confirmation card shows them in.
var CheckNames = []string{
	CheckCondition, CheckProof, CheckApproach, CheckConstraints, CheckBudget, CheckPermission,
}

// checkLabels are the human names used in "还差：…" lines.
var checkLabels = map[string]string{
	CheckCondition:   "完成条件",
	CheckProof:       "怎么证明",
	CheckApproach:    "怎么走",
	CheckConstraints: "不许动",
	CheckBudget:      "预算",
	CheckPermission:  "需要你开的权限",
}

// checkAliases maps what a caller may say onto the six keys.
//
// The intake turn speaks Chinese to the user and English to the tool, so both
// arrive here: a model that writes `check: "怎么证明"` must land on `proof`
// instead of a 400 that costs a whole round of questions.
var checkAliases = map[string]string{
	"condition": CheckCondition, "criteria": CheckCondition, "acceptance": CheckCondition,
	"完成条件": CheckCondition, "验收": CheckCondition, "验收条件": CheckCondition, "怎么算做完": CheckCondition,
	"proof": CheckProof, "evidence": CheckProof,
	"证据": CheckProof, "怎么证明": CheckProof, "证明": CheckProof,
	"approach": CheckApproach, "steps": CheckApproach, "plan": CheckApproach,
	"怎么走": CheckApproach, "步骤": CheckApproach, "做法": CheckApproach,
	"constraints": CheckConstraints, "constraint": CheckConstraints, "limits": CheckConstraints,
	"不许动": CheckConstraints, "约束": CheckConstraints, "限制": CheckConstraints,
	"budget": CheckBudget,
	"预算":     CheckBudget, "轮次": CheckBudget,
	"permissions": CheckPermission, "permission": CheckPermission,
	"权限": CheckPermission, "需要你开": CheckPermission, "需要你开的权限": CheckPermission,
}

// NormalizeCheck turns a key or a label into one of the six names.
//
// It exists because the same six are named three ways: the key in the API, the
// label on the card, and whatever the model decides to write. Anything else is
// refused, so a typo cannot silently write into the wrong field.
func NormalizeCheck(raw string) (string, bool) {
	key := strings.ToLower(strings.TrimSpace(raw))
	key = strings.TrimSuffix(key, "：")
	key = strings.TrimSuffix(key, ":")
	if name, ok := checkAliases[key]; ok {
		return name, true
	}
	return "", false
}

// CheckKeys is the list NormalizeCheck accepts, for an error a model can act on.
func CheckKeys() string {
	return strings.Join([]string{CheckCondition, CheckProof, CheckApproach, CheckConstraints, CheckBudget}, "|")
}

// DraftFields is what an unfinished goal carries while the user is filling it in.
type DraftFields struct {
	Title       string
	Condition   string
	Proof       []string
	Constraints []string
	Approach    string
	MaxRounds   int
	MaxMinutes  int
	// PermissionNeeded is the host's answer for the sixth check: true when the
	// build belt can still ask, which would block an unattended round.
	PermissionNeeded bool
}

// Verdict is the result of the intake check.
type Verdict struct {
	Filled   []string `json:"filled"`
	Missing  []string `json:"missing"`
	Blockers []string `json:"blockers"`
	// Risks are the read-only lines the confirmation card shows. They explain
	// what the user is agreeing to, not what is wrong.
	Risks []string `json:"risks"`
}

// Ready reports whether the goal may start: nothing missing and no blocker.
func (v Verdict) Ready() bool { return len(v.Missing) == 0 && len(v.Blockers) == 0 }

// Progress is "补全 3/6".
func (v Verdict) Progress() int {
	return len(v.Filled)
}

// Intake runs the six checks.
//
// It is a pure function so the card, the "还差什么" line and the start button all
// read one answer; a second implementation in the UI would drift.
func Intake(d DraftFields) Verdict {
	var v Verdict
	mark := func(name string, ok bool) {
		if ok {
			v.Filled = append(v.Filled, name)
			return
		}
		v.Missing = append(v.Missing, name)
	}

	mark(CheckCondition, strings.TrimSpace(d.Condition) != "")
	mark(CheckProof, len(nonEmpty(d.Proof)) > 0)
	mark(CheckApproach, strings.TrimSpace(d.Approach) != "")
	mark(CheckConstraints, len(nonEmpty(d.Constraints)) > 0)
	mark(CheckBudget, d.MaxRounds > 0 && d.MaxMinutes > 0)
	// The sixth is the host's: a belt that can ask would block a round with no
	// user behind it, so it is a blocker rather than a missing field.
	if d.PermissionNeeded {
		v.Blockers = append(v.Blockers, "build 的工具策略里还有「询问」项：无人值守时会卡住，先把它们改成允许或拒绝")
	} else {
		v.Filled = append(v.Filled, CheckPermission)
	}

	v.Risks = append(v.Risks,
		"跑起来后无人值守：不是你一步我一步，而是它自己一轮一轮往下走",
		"你看不到没被贴出来的结果：判定员只读这一轮交上来的证据",
	)
	if d.PermissionNeeded {
		v.Risks = append(v.Risks, "需要额外权限：有一项工具策略是「询问」，无人值守时不会有人回答")
	}
	return v
}

// MissingLine renders "目标补全 3/6 · 还差：怎么证明、预算".
func (v Verdict) MissingLine() string {
	if len(v.Missing) == 0 {
		return fmt.Sprintf("目标补全 %d/6", v.Progress())
	}
	labels := make([]string, 0, len(v.Missing))
	for _, name := range v.Missing {
		if label, ok := checkLabels[name]; ok {
			labels = append(labels, label)
			continue
		}
		labels = append(labels, name)
	}
	return fmt.Sprintf("目标补全 %d/6 · 还差：%s", v.Progress(), strings.Join(labels, "、"))
}

func nonEmpty(items []string) []string {
	out := make([]string, 0, len(items))
	for _, item := range items {
		if strings.TrimSpace(item) != "" {
			out = append(out, item)
		}
	}
	return out
}
