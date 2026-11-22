import { describe, expect, it } from 'vitest'

import { goalsRequestPath, pickGoalForSession, type Goal } from './goalApi'

// A brand-new conversation has no session key yet. Asking for "this
// conversation's goals" with `session_key=` made the server answer with every
// goal the account owns, so the new conversation showed another one's progress
// and the composer lost its build/plan switch.
describe('goalsRequestPath', () => {
  it('asks for nothing when the conversation has no key', () => {
    expect(goalsRequestPath('')).toBeNull()
    expect(goalsRequestPath('   ')).toBeNull()
  })

  it('queries the one conversation when there is a key', () => {
    expect(goalsRequestPath('web:abc')).toBe('/goals?session_key=web%3Aabc')
  })
})

describe('pickGoalForSession', () => {
  const running: Goal = { id: 'g_1', status: 'running' } as Goal
  const finished: Goal = { id: 'g_2', status: 'achieved' } as Goal

  it('picks nothing without a key, even when goals exist', () => {
    expect(pickGoalForSession([running], '')).toBeNull()
  })

  it('prefers a goal that is still moving', () => {
    expect(pickGoalForSession([finished, running], 'web:abc')?.id).toBe('g_1')
  })
})
