import { describe, expect, it } from 'vitest'
import { applyLiveAttention, attentionKey, indexAttention, type ConversationAttention } from './attention'
import { EMPTY_SUMMARY, type ConversationTab, type TabSummary } from './store'

const T0 = '2026-11-21T00:00:00Z'
const T1 = '2026-11-21T01:00:00Z'
const T2 = '2026-11-21T02:00:00Z'

function row(agentId: string, chatId: string, updatedAt: string, running = false, awaiting = false): ConversationAttention {
  return { agent_id: agentId, chat_id: chatId, session_id: `web:${chatId}`, running, awaiting, updated_at: updatedAt }
}

function tab(id: string, agentId: string, chatId: string | null): ConversationTab {
  return {
    id,
    agentId,
    sessionId: chatId ? `web:${chatId}` : null,
    resumeSessionId: chatId ? `web:${chatId}` : null,
    chatId,
    agentName: agentId,
    openedAt: 0,
    lastActiveAt: 0,
  }
}

function summary(patch: Partial<TabSummary>): TabSummary {
  return { ...EMPTY_SUMMARY, connected: true, ...patch }
}

describe('indexAttention', () => {
  it('compares a conversation against the read mark', () => {
    const index = indexAttention([row('a1', 'c1', T2)], { [attentionKey('a1', 'c1')]: T1 })
    expect(index.conversations['a1|c1'].unread).toBe(true)

    const read = indexAttention([row('a1', 'c1', T1)], { [attentionKey('a1', 'c1')]: T1 })
    expect(read.conversations['a1|c1'].unread).toBe(false)
  })

  it('treats a conversation older than the baseline as history, not unread', () => {
    const index = indexAttention([row('a1', 'c1', T0)], {}, T1)
    expect(index.conversations['a1|c1'].unread).toBe(false)
  })

  it('marks a conversation that appeared after the baseline as unread', () => {
    // Started on another device (or a fresh conversation in a background tab).
    const index = indexAttention([row('a1', 'c1', T2)], {}, T1)
    expect(index.conversations['a1|c1'].unread).toBe(true)
    expect(index.agents['a1'].unread).toBe(true)
  })

  it('has no baseline to compare against on a browser that has never loaded', () => {
    const index = indexAttention([row('a1', 'c1', T2)], {}, '')
    expect(index.conversations['a1|c1'].unread).toBe(false)
  })
})

describe('applyLiveAttention', () => {
  it('keeps a background tab unread even though its socket is open', () => {
    const index = indexAttention([row('a1', 'c1', T2, false)], {}, T1)
    const live = applyLiveAttention(index, [tab('t1', 'a1', 'c1')], { t1: summary({ reading: false }) })

    expect(live.conversations['a1|c1'].unread).toBe(true)
    expect(live.agents['a1'].unread).toBe(true)
  })

  it('clears unread only for the conversation being read', () => {
    const index = indexAttention([row('a1', 'c1', T2)], {}, T1)
    const live = applyLiveAttention(index, [tab('t1', 'a1', 'c1')], { t1: summary({ reading: true }) })

    expect(live.conversations['a1|c1'].unread).toBe(false)
  })

  it('still lets the browser correct a stale "running" from the snapshot', () => {
    const index = indexAttention([row('a1', 'c1', T2, true)])
    const live = applyLiveAttention(index, [tab('t1', 'a1', 'c1')], { t1: summary({ busy: false, reading: true }) })

    expect(live.conversations['a1|c1'].running).toBe(false)
  })

  it('counts a tab with no chat id for its agent only, and never unread', () => {
    const live = applyLiveAttention(indexAttention([]), [tab('t1', 'a1', null)], {
      t1: summary({ awaitingInput: true, reading: false }),
    })

    expect(live.conversations).toEqual({})
    expect(live.agents['a1']).toEqual({ running: false, awaiting: true, unread: false })
  })
})
