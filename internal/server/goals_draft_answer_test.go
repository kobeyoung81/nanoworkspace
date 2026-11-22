package server

import (
	"encoding/json"
	"testing"

	"gitee.com/kobeyoung81/nanoworkspace/internal/goal"
	"gitee.com/kobeyoung81/nanoworkspace/internal/store"
)

func raw(s string) json.RawMessage { return json.RawMessage(s) }

// TestFillAnswer covers the three shapes a value can arrive in: the text the
// card sends, the list an API caller may send, and the structured steps the
// intake tool sends. What matters for the caller is `stored`: it is how a model
// learns that "you decide" did not become a budget.
func TestFillAnswer(t *testing.T) {
	cases := []struct {
		name    string
		check   string
		value   string
		wantErr bool
		stored  string
		wantSet bool
		patched func(p store.DraftPatch) bool
	}{
		{name: "condition text", check: goal.CheckCondition, value: `"迁移完成"`, stored: "迁移完成", wantSet: true,
			patched: func(p store.DraftPatch) bool { return p.Condition != nil && *p.Condition == "迁移完成" }},
		{name: "condition empty is not written", check: goal.CheckCondition, value: `"   "`, stored: "空，未写入"},
		{name: "proof lines", check: goal.CheckProof, value: `"go build ./... 退出码 0\ncat a.txt"`, stored: "2 条", wantSet: true,
			patched: func(p store.DraftPatch) bool { return p.Proof != nil && len(*p.Proof) == 2 }},
		{name: "proof structured keeps its kind", check: goal.CheckProof,
			value: `[{"kind":"command","command":"ls","command_exit":0}]`, wantSet: true, stored: "1 条",
			patched: func(p store.DraftPatch) bool { return p.Proof != nil && (*p.Proof)[0].Kind == "command" }},
		{name: "constraints list", check: goal.CheckConstraints, value: `["不动测试","不升级依赖"]`, stored: "2 条", wantSet: true,
			patched: func(p store.DraftPatch) bool { return p.Constraints != nil && len(*p.Constraints) == 2 }},
		{name: "budget text", check: goal.CheckBudget, value: `"3 轮 / 10 分钟"`, stored: "3 轮 / 10 分钟", wantSet: true,
			patched: func(p store.DraftPatch) bool { return p.MaxRounds != nil && *p.MaxRounds == 3 && *p.MaxMinutes == 10 }},
		{name: "budget object", check: goal.CheckBudget, value: `{"rounds":5,"minutes":30}`, stored: "5 轮 / 30 分钟", wantSet: true,
			patched: func(p store.DraftPatch) bool { return p.MaxRounds != nil && *p.MaxRounds == 5 }},
		{name: "budget without numbers takes the default", check: goal.CheckBudget, value: `"你定"`,
			stored: "40 轮 / 180 分钟（默认）", wantSet: true,
			patched: func(p store.DraftPatch) bool { return p.MaxRounds != nil && *p.MaxRounds == 40 }},
		{name: "budget empty is not written", check: goal.CheckBudget, value: `""`, stored: "空，未写入"},
		{name: "permissions is the host's", check: goal.CheckPermission, value: `"x"`, stored: "host"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var patch store.DraftPatch
			stored := map[string]string{}
			if err := fillAnswer(c.check, raw(c.value), &patch, stored); err != nil {
				if !c.wantErr {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if c.wantErr {
				t.Fatalf("expected an error")
			}
			if got := stored[c.check]; got != c.stored {
				t.Errorf("stored = %q, want %q", got, c.stored)
			}
			if c.wantSet && patchEmpty(patch) {
				t.Errorf("nothing was written")
			}
			if !c.wantSet && !patchEmpty(patch) {
				t.Errorf("an empty answer was written: %+v", patch)
			}
			if c.patched != nil && !c.patched(patch) {
				t.Errorf("patch is not what the check expects: %+v", patch)
			}
		})
	}
}

// TestFillAnswer_RefusesAnUnreadableValue keeps a malformed body from being
// stored as a check that looks filled.
func TestFillAnswer_RefusesAnUnreadableValue(t *testing.T) {
	var patch store.DraftPatch
	if err := fillAnswer(goal.CheckProof, raw(`{"nope":1}`), &patch, map[string]string{}); err == nil {
		t.Fatal("a value that is neither text nor a list must be refused")
	}
	if err := fillAnswer(goal.CheckCondition, raw(`null`), &patch, map[string]string{}); err == nil {
		t.Fatal("a null value must be refused")
	}
}
