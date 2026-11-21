import { describe, expect, it } from 'vitest'
import type { AgentMessage } from './useAgent'
import { mergeAfterTurnEnd, persistedCoversStream } from './segmentMerge'

function userMessage(content: string, pending = false): AgentMessage {
  return { id: `u-${content}`, role: 'user', content, streaming: false, pending }
}

function answer(content: string, streaming = false): AgentMessage {
  return { id: `a-${content}`, role: 'assistant', kind: 'content', content, streaming }
}

function thought(content: string, streaming = false): AgentMessage {
  return { id: `t-${content}`, role: 'assistant', kind: 'thought', content, streaming, startedAt: 1000 }
}

function question(): AgentMessage {
  return { id: 'q-1', role: 'assistant', kind: 'question', args: '{}', result: '', streaming: true }
}

function pendingUser(content: string): AgentMessage {
  return userMessage(content, true)
}

describe('mergeAfterTurnEnd', () => {
  it('adopts the stored row and drops the leftovers when it covers the stream', () => {
    const transcript = [userMessage('hi'), thought('thinking…', true), answer('partial', true)]
    const persisted = [userMessage('hi'), thought('thinking…'), answer('partial and the rest of it')]

    const merged = mergeAfterTurnEnd(transcript, persisted, 0, 2000)

    expect(merged).toEqual(persisted)
    expect(merged.some((m) => m.role === 'assistant' && m.streaming)).toBe(false)
  })

  it('keeps the transcript when there is nothing stale to replace', () => {
    const transcript = [userMessage('hi'), answer('done')]
    const persisted = [userMessage('hi'), answer('done')]

    expect(mergeAfterTurnEnd(transcript, persisted, 0, 2000)).toEqual(persisted)
  })

  it('keeps what the reader saw when the row lags the stream, but stops it spinning', () => {
    // The agent died mid-turn: the stream got further than the row ever did.
    const transcript = [userMessage('hi'), answer('the first half', true)]
    const persisted = [userMessage('hi')]

    const merged = mergeAfterTurnEnd(transcript, persisted, 0, 2000)

    expect(merged[0]).toEqual(userMessage('hi'))
    const last = merged[merged.length - 1]
    expect(last.role === 'assistant' && last.kind === 'content' && last.content).toBe('the first half')
    expect(merged.some((m) => m.role === 'assistant' && m.streaming)).toBe(false)
  })

  it('leaves a question that is still awaiting an answer alone', () => {
    const transcript = [userMessage('hi'), question()]
    const persisted = [userMessage('hi'), question()]

    const merged = mergeAfterTurnEnd(transcript, persisted, 0, 2000)

    // A question block is streaming while it waits for the user; that is not a
    // leftover and the end of a turn must not turn it into "unanswered".
    const last = merged[merged.length - 1]
    expect(last.role === 'assistant' && last.kind === 'question' && last.streaming).toBe(true)
  })

  it('keeps an unconfirmed user bubble at the end', () => {
    const transcript = [userMessage('hi'), answer('old', true), pendingUser('next question')]
    const persisted = [userMessage('hi'), answer('old and more')]

    const merged = mergeAfterTurnEnd(transcript, persisted, 0, 2000)

    expect(merged[merged.length - 1]).toEqual(pendingUser('next question'))
  })

  it('never touches the earlier segments already on screen', () => {
    const older = [userMessage('older'), answer('older answer')]
    const transcript = [...older, userMessage('hi'), answer('half', true)]
    const persisted = [userMessage('hi'), answer('half, finished')]

    const merged = mergeAfterTurnEnd(transcript, persisted, older.length, 2000)

    expect(merged.slice(0, older.length)).toEqual(older)
    expect(merged.slice(older.length)).toEqual(persisted)
  })
})

describe('persistedCoversStream', () => {
  it('compares the answer text, not the shape of the tool blocks', () => {
    const live = [answer('abc')]
    expect(persistedCoversStream([answer('abcdef')], live)).toBe(true)
    expect(persistedCoversStream([answer('xyz')], live)).toBe(false)
    // Nothing streamed is trivially covered.
    expect(persistedCoversStream([answer('whatever')], [])).toBe(true)
  })
})
