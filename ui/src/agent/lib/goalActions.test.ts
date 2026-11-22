import { describe, expect, it } from 'vitest'

import { taskActions } from './goalActions'

// The panel's row matrix (user's call, 2026-11-21): the buttons must not depend
// on hover, and a queued goal must offer more than an "open" arrow.
describe('taskActions', () => {
  it('offers cancel, delete and open on a queued goal', () => {
    for (const status of ['draft', 'validating', 'ready']) {
      expect(taskActions(status)).toEqual(['cancel', 'delete', 'open'])
    }
  })

  it('offers pause, cancel, delete and open while it runs', () => {
    for (const status of ['running', 'verifying']) {
      expect(taskActions(status)).toEqual(['pause', 'cancel', 'delete', 'open'])
    }
  })

  it('offers resume rather than pause when parked', () => {
    expect(taskActions('paused')).toEqual(['resume', 'cancel', 'delete', 'open'])
  })

  it('offers only delete and open while it is already stopping', () => {
    expect(taskActions('cancelling')).toEqual(['delete', 'open'])
  })

  it('offers only delete and open in a terminal state', () => {
    for (const status of ['achieved', 'failed', 'cancelled']) {
      expect(taskActions(status)).toEqual(['delete', 'open'])
    }
  })

  it('never offers both pause and resume', () => {
    for (const status of ['draft', 'validating', 'ready', 'running', 'verifying', 'paused', 'cancelling', 'achieved', 'failed', 'cancelled']) {
      const actions = taskActions(status)
      expect(actions.includes('pause') && actions.includes('resume')).toBe(false)
      expect(actions.includes('delete')).toBe(true)
    }
  })
})
