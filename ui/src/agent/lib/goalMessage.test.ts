import { describe, expect, it } from 'vitest'

import { parseGoalPrompt, parseJudgeResult } from './goalMessage'

// The heading and the JSON below are the shapes the platform itself produces:
// the brief is written by the scheduler's template and the result by the
// goal_report tool. Everything here is a contract with those two writers.
const brief = [
  '【长程目标 · 第 3 轮】',
  '',
  '目标',
  'internal/auth 下不再出现 OldToken 调用',
  '',
  '要守住的边界',
  '- 不改已有测试',
  '',
  '上一轮（第 2 轮）',
  '判定员：还没有达成 —— refresh.go 还有两处调用',
  '它自己的说法：换掉了 token 的读取',
  '',
  '判定员认为还差',
  '- refresh.go',
  '',
  '这一轮先处理「refresh.go」。',
].join('\n')

describe('parseGoalPrompt', () => {
  it('reads a work round and the goal line', () => {
    const prompt = parseGoalPrompt(brief)
    expect(prompt).toEqual({
      kind: 'work',
      round: 3,
      goal: 'internal/auth 下不再出现 OldToken 调用',
    })
  })

  it('reads a verification round', () => {
    const verify = ['【长程目标 · 复验轮】', '', '目标', '所有测试通过'].join('\n')
    expect(parseGoalPrompt(verify)).toEqual({ kind: 'verify', round: 0, goal: '所有测试通过' })
  })

  it('gives an empty goal when the heading has no 目标 section', () => {
    expect(parseGoalPrompt('【长程目标 · 第 2 轮】')?.goal).toBe('')
  })

  it('ignores an ordinary message, even one that mentions the goal', () => {
    expect(parseGoalPrompt('我看到【长程目标 · 第 3 轮】了，这是怎么回事？')).toBeNull()
    expect(parseGoalPrompt('')).toBeNull()
    expect(parseGoalPrompt('帮我看看 internal/auth')).toBeNull()
  })

  it('rejects a heading without a usable round number', () => {
    expect(parseGoalPrompt('【长程目标 · 第 0 轮】')).toBeNull()
    expect(parseGoalPrompt('【长程目标 · 第 轮】')).toBeNull()
  })
})

describe('parseJudgeResult', () => {
  it('reads a delivered verdict', () => {
    const out = JSON.stringify({ delivered: true, verdict: 'not_yet', reason: 'refresh.go 还差两处', round: 4 })
    expect(parseJudgeResult(out)).toEqual({
      delivered: true,
      verdict: 'not_yet',
      reason: 'refresh.go 还差两处',
      round: 4,
      verify: false,
    })
  })

  it('reads a verification verdict', () => {
    const out = JSON.stringify({ delivered: true, verdict: 'met', reason: '一致', round: 4, verify: true })
    expect(parseJudgeResult(out)?.verify).toBe(true)
    expect(parseJudgeResult(out)?.round).toBe(4)
  })

  it('shows no card for a repeat submission (there is no verdict to show)', () => {
    const out = JSON.stringify({ delivered: false, reason: '第 4 轮的工作报告已经提交过，不必重复提交。' })
    // The answer is a refusal, not a judgement: a judge card without a verdict
    // would be a card about nothing. The raw tool result stays in the group.
    expect(parseJudgeResult(out)).toBeNull()
  })

  it('returns null for the earlier sentence-shaped answer', () => {
    expect(parseJudgeResult('第 4 轮工作报告已提交，判定：met。tests pass')).toBeNull()
  })

  it('returns null for anything it cannot trust', () => {
    expect(parseJudgeResult('')).toBeNull()
    expect(parseJudgeResult('{')).toBeNull()
    expect(parseJudgeResult('{"delivered":true,"verdict":"maybe"}')).toBeNull()
    expect(parseJudgeResult('null')).toBeNull()
    expect(parseJudgeResult('["met"]')).toBeNull()
  })
})
