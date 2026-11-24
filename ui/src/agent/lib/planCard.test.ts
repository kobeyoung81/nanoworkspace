import { describe, expect, it } from 'vitest'

import { parsePlanCard, planPathOfResult } from './planCard'

// TestParsePlanCard pins the same rules the workspace's ParsePlan uses, so the
// card and the pre-filled condition read one plan the same way.
describe('parsePlanCard', () => {
  it('reads the title and the steps', () => {
    const plan = [
      '# 把 auth 迁到新 token 接口',
      '',
      '## 验收',
      'internal/auth 下不再出现旧接口调用',
      '',
      '## 步骤',
      '1. 替换 token 入口',
      '2. 处理 refresh 的四处调用',
      '3、中间件换签名',
      '- 跑全量测试',
      '',
      '## 证据',
      '- go build ./... 退出码 0',
    ].join('\n')
    const card = parsePlanCard(plan)
    expect(card.title).toBe('把 auth 迁到新 token 接口')
    expect(card.steps).toEqual(['替换 token 入口', '处理 refresh 的四处调用', '中间件换签名', '跑全量测试'])
  })

  it('accepts an English heading', () => {
    expect(parsePlanCard('# T\n\n## Steps\n1. one\n2. two').steps).toEqual(['one', 'two'])
  })

  it('returns no steps when the plan has none', () => {
    expect(parsePlanCard('# Only a title\n\nsome prose').steps).toEqual([])
    expect(parsePlanCard('').title).toBe('')
  })

  it('does not read list items outside the steps section', () => {
    const plan = ['# T', '## 验收', '- 不应算作步骤', '## 步骤', '1. 才算'].join('\n')
    expect(parsePlanCard(plan).steps).toEqual(['才算'])
  })
})

describe('planPathOfResult', () => {
  it('reads the path the tool answered with', () => {
    expect(
      planPathOfResult('Plan written to /home/nanosec/agents/nanosec/plans/a.md (812 bytes). Read it back with the read tool.'),
    ).toBe('/home/nanosec/agents/nanosec/plans/a.md')
  })

  it('is empty for anything else', () => {
    expect(planPathOfResult('')).toBe('')
    expect(planPathOfResult('Error: content is required')).toBe('')
    expect(planPathOfResult(undefined)).toBe('')
  })
})
