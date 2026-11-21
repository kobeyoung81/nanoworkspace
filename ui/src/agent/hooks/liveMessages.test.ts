import { describe, expect, it } from 'vitest'
import type { AgentMessage } from './useAgent'
import { finalizeStaleBlocks, isStaleStreamingBlock } from './liveMessages'

const answer = (content: string, streaming: boolean): AgentMessage => ({
  id: `a-${content}`,
  role: 'assistant',
  kind: 'content',
  content,
  streaming,
})

const thought = (streaming: boolean): AgentMessage => ({
  id: 't-1',
  role: 'assistant',
  kind: 'thought',
  content: 'reasoning',
  streaming,
  startedAt: 1000,
})

const toolGroup = (streaming: boolean): AgentMessage => ({
  id: 'g-1',
  role: 'assistant',
  kind: 'tool_group',
  tools: [{ name: 'bash', args: '{}', result: '' }],
  streaming,
  folded: false,
})

const question = (streaming: boolean): AgentMessage => ({
  id: 'q-1',
  role: 'assistant',
  kind: 'question',
  args: '{}',
  result: '',
  streaming,
})

const user = (content: string): AgentMessage => ({ id: `u-${content}`, role: 'user', content, streaming: false })

describe('finalizeStaleBlocks', () => {
  it('closes a thought block and records how long it ran', () => {
    const [closed] = finalizeStaleBlocks([thought(true)], 4000)
    expect(closed.role === 'assistant' && closed.kind === 'thought' && closed.streaming).toBe(false)
    expect(closed.role === 'assistant' && closed.kind === 'thought' && closed.elapsedMs).toBe(3000)
  })

  it('closes tool and answer blocks', () => {
    const merged = finalizeStaleBlocks([toolGroup(true), answer('half', true)], 4000)
    expect(merged.every((m) => m.role !== 'assistant' || !m.streaming)).toBe(true)
  })

  it('drops an empty answer bubble it would otherwise leave behind', () => {
    expect(finalizeStaleBlocks([answer('   ', true)], 4000)).toEqual([])
  })

  it('never turns an awaiting question into an unanswered one', () => {
    const merged = finalizeStaleBlocks([question(true)], 4000)
    expect(merged).toHaveLength(1)
    expect(merged[0].role === 'assistant' && merged[0].kind === 'question' && merged[0].streaming).toBe(true)
  })

  it('leaves user bubbles untouched', () => {
    expect(finalizeStaleBlocks([user('hi'), answer('done', false)], 4000)).toEqual([
      user('hi'),
      answer('done', false),
    ])
  })

  it('classifies only the stream-owned kinds as stale', () => {
    expect(isStaleStreamingBlock(answer('x', true))).toBe(true)
    expect(isStaleStreamingBlock(question(true))).toBe(false)
    expect(isStaleStreamingBlock(answer('x', false))).toBe(false)
    expect(isStaleStreamingBlock(user('hi'))).toBe(false)
  })
})
