import { describe, expect, it } from 'vitest'

import { isStoredSessionID, storedSessionID } from './sessionMeta'

describe('storedSessionID', () => {
  it('prefers the segment id the tab was opened on', () => {
    expect(storedSessionID({ sessionId: 'web:a:v2', chatId: 'a' })).toBe('web:a:v2')
  })

  it('builds the first segment of a conversation started in this tab', () => {
    // The gateway names the chat; the first stored segment is `web:<chat>`.
    expect(storedSessionID({ sessionId: null, chatId: 'fa010c9a' })).toBe('web:fa010c9a')
  })

  it('has nothing to read before the first turn', () => {
    expect(storedSessionID({ sessionId: null, chatId: null })).toBeNull()
  })

  it('only produces an id the server would recognise', () => {
    expect(isStoredSessionID(storedSessionID({ sessionId: null, chatId: 'c1' }) ?? '')).toBe(true)
    expect(isStoredSessionID('conv-1-abc')).toBe(false)
  })
})
