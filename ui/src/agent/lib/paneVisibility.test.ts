import { describe, expect, it } from 'vitest'
import { isReadingConversation } from './paneVisibility'

describe('isReadingConversation', () => {
  it('requires all three: the active tab, a visible panel and a visible page', () => {
    expect(isReadingConversation({ tabActive: true, panelVisible: true, documentVisible: true })).toBe(true)
  })

  it('is false for a tab left open in the background', () => {
    expect(isReadingConversation({ tabActive: false, panelVisible: true, documentVisible: true })).toBe(false)
  })

  it('is false while another workbench panel (or mobile tab) covers the chat', () => {
    expect(isReadingConversation({ tabActive: true, panelVisible: false, documentVisible: true })).toBe(false)
  })

  it('is false while the browser tab or app is in the background', () => {
    expect(isReadingConversation({ tabActive: true, panelVisible: true, documentVisible: false })).toBe(false)
  })
})
