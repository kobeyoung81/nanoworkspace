import { describe, expect, it, vi } from 'vitest'

import { describeProgress, getIntakeDraft, onIntakeDraftChange, setIntakeDraft } from './goalIntake'

describe('describeProgress', () => {
  const labels = (key: string) => ({ budget: '预算', constraints: '不许动' })[key] ?? key

  it('says what is missing', () => {
    expect(describeProgress({ filled: ['condition', 'proof', 'approach'], missing: ['budget', 'constraints'] }, labels)).toBe(
      '目标补全 3/6 · 还差：预算、不许动',
    )
  })

  it('drops the missing part when nothing is missing', () => {
    expect(describeProgress({ filled: ['a', 'b', 'c', 'd', 'e', 'permissions'], missing: [] }, labels)).toBe('目标补全 6/6')
  })

  it('copes with no view yet', () => {
    expect(describeProgress(undefined, labels)).toBe('目标补全 0/6')
  })
})

describe('the intake store', () => {
  it('notifies subscribers and clears', () => {
    const seen = vi.fn()
    const off = onIntakeDraftChange(seen)
    setIntakeDraft({ draftId: 'g_1', sessionKey: 'web:a' })
    expect(getIntakeDraft()?.draftId).toBe('g_1')
    setIntakeDraft(null)
    expect(getIntakeDraft()).toBeNull()
    expect(seen).toHaveBeenCalledTimes(2)
    off()
    setIntakeDraft({ draftId: 'g_2', sessionKey: 'web:a' })
    expect(seen).toHaveBeenCalledTimes(2)
    setIntakeDraft(null)
  })
})
