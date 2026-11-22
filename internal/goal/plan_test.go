package goal

import "testing"

const samplePlan = `# 把 auth 迁到新 token 接口

## 背景

旧接口散在三个文件里。

## 验收
internal/auth 下不再出现 OldToken 调用，且构建与测试均通过

## 证据
1. ` + "`cd internal/auth && rg -c 'OldToken'` 退出码 1（零命中）" + `
2. ` + "`go test ./internal/auth/...` 退出码 0" + `
- 文件 internal/auth/token.go 不再 import 旧包

## 步骤
1. 替换 token 入口
2. 处理 refresh 的四处调用
3. 中间件换签名
4. 跑全量测试

## 风险

第三方生成的代码里还有两处。
`

// TestParsePlan_ReadsTheThreeSections is the contract with the plan prompt: the
// headings it asks for are the ones this parser matches.
func TestParsePlan_ReadsTheThreeSections(t *testing.T) {
	p := ParsePlan(samplePlan)
	if !p.OK() {
		t.Fatalf("plan not usable: %+v", p)
	}
	if p.Condition != "internal/auth 下不再出现 OldToken 调用，且构建与测试均通过" {
		t.Errorf("condition = %q", p.Condition)
	}
	if len(p.Proof) != 3 {
		t.Fatalf("proof = %#v, want three items", p.Proof)
	}
	if len(p.Steps) != 4 {
		t.Fatalf("steps = %#v, want four", p.Steps)
	}
	if p.Steps[0] != "替换 token 入口" {
		t.Errorf("step list kept its numbering: %q", p.Steps[0])
	}
}

// TestParsePlan_EnglishHeadings covers a plan written in English.
func TestParsePlan_EnglishHeadings(t *testing.T) {
	p := ParsePlan("## Acceptance\nall tests pass\n\n## Evidence\n- exit code 0\n\n## Steps\n1. do it")
	if !p.OK() || p.Condition != "all tests pass" || len(p.Steps) != 1 {
		t.Fatalf("english plan = %+v", p)
	}
}

// TestParsePlan_WithoutAcceptanceIsNotUsable is the fallback case: an old plan
// (written before the prompt asked for the sections) must not be guessed at.
func TestParsePlan_WithoutAcceptanceIsNotUsable(t *testing.T) {
	p := ParsePlan("# 计划\n\n## 步骤\n1. 先做这个\n")
	if p.OK() {
		t.Fatalf("a plan without 验收 must not be usable: %+v", p)
	}
	if len(p.Steps) != 1 {
		t.Errorf("steps are still read: %#v", p.Steps)
	}
}

// TestParsePlan_StopsAtTheNextSection keeps one section from swallowing the
// next: the risk paragraph must not become evidence.
func TestParsePlan_StopsAtTheNextSection(t *testing.T) {
	p := ParsePlan("## 验收\nall green\n## 证据\n- exit 0\n## 步骤\n1. one\n## 风险\n会改 12 个文件")
	for _, item := range p.Proof {
		if item == "会改 12 个文件" {
			t.Fatalf("the risk line leaked into evidence: %#v", p.Proof)
		}
	}
	for _, item := range p.Steps {
		if item == "会改 12 个文件" {
			t.Fatalf("the risk line leaked into steps: %#v", p.Steps)
		}
	}
}

// TestParsePlan_TruncatesSteps bounds what the card quotes.
func TestParsePlan_TruncatesSteps(t *testing.T) {
	body := "## 验收\nok\n## 证据\n- exit 0\n## 步骤\n"
	for i := 0; i < 30; i++ {
		body += "1. step\n"
	}
	if got := len(ParsePlan(body).Steps); got != maxPlanSteps {
		t.Fatalf("steps = %d, want %d", got, maxPlanSteps)
	}
}

// TestParsePlan_StepWithoutASpace covers "3、中间件换签名": a Chinese enumeration
// mark is often written with no space after it, and the card counts these steps.
func TestParsePlan_StepWithoutASpace(t *testing.T) {
	p := ParsePlan("# 计划\n\n## 验收\n全部通过\n\n## 步骤\n1. 替换入口\n2、处理调用\n3．换签名\n")
	if len(p.Steps) != 3 {
		t.Fatalf("steps = %#v, want three", p.Steps)
	}
	if p.Steps[1] != "处理调用" || p.Steps[2] != "换签名" {
		t.Errorf("steps = %#v", p.Steps)
	}
}
