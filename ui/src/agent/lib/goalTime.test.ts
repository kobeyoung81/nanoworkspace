import { describe, expect, it } from 'vitest'

import { minutesSince } from './goalTime'

describe('minutesSince', () => {
  const now = Date.parse('2026-11-24T10:00:00Z')

  it('counts whole minutes', () => {
    expect(minutesSince('2026-11-24T09:48:00Z', now)).toBe(12)
    expect(minutesSince('2026-11-24T09:59:40Z', now)).toBe(0)
  })

  it('never goes negative', () => {
    expect(minutesSince('2026-11-24T10:30:00Z', now)).toBe(0)
  })

  it('copes with a missing or broken timestamp', () => {
    expect(minutesSince(undefined, now)).toBe(0)
    expect(minutesSince('not a date', now)).toBe(0)
  })
})
