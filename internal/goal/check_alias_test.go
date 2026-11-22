package goal

import "testing"

// TestNormalizeCheck pins the three names each check travels under. The intake
// turn shows the user Chinese labels while the tool wants keys, so a model that
// writes "怎么证明" has to land on proof instead of spending a round on a 400.
func TestNormalizeCheck(t *testing.T) {
	cases := []struct {
		raw  string
		want string
		ok   bool
	}{
		{"proof", CheckProof, true},
		{"PROOF", CheckProof, true},
		{"  proof  ", CheckProof, true},
		{"怎么证明", CheckProof, true},
		{"证据", CheckProof, true},
		{"完成条件", CheckCondition, true},
		{"验收：", CheckCondition, true},
		{"怎么算做完", CheckCondition, true},
		{"怎么走", CheckApproach, true},
		{"不许动", CheckConstraints, true},
		{"预算", CheckBudget, true},
		{"权限", CheckPermission, true},
		{"permissions", CheckPermission, true},
		{"", "", false},
		{"how_to_prove", "", false},
		{"proofs", "", false},
	}
	for _, c := range cases {
		got, ok := NormalizeCheck(c.raw)
		if got != c.want || ok != c.ok {
			t.Errorf("NormalizeCheck(%q) = %q/%v, want %q/%v", c.raw, got, ok, c.want, c.ok)
		}
	}
}
