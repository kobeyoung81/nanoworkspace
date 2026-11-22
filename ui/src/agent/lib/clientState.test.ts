import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { setHost, type Host } from '../../host'
import { readState, stateKey, writeState } from './clientState'

// The plugin carries its own copy of the shell's state module, so the tasks
// split has to be covered here too: this is the copy the panel actually writes
// through, and writing a bare number over `agent.layout.v1` used to wipe the
// saved dock arrangement on every drag.

class MemoryStorage {
  private map = new Map<string, string>()
  get length() {
    return this.map.size
  }
  getItem(key: string) {
    return this.map.has(key) ? (this.map.get(key) as string) : null
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value))
  }
  removeItem(key: string) {
    this.map.delete(key)
  }
  clear() {
    this.map.clear()
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null
  }
}

beforeEach(() => {
  ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()
  // The plugin's copy takes the account from the host the shell installs.
  setHost({ userId: 'u1' } as unknown as Host)
})

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage
  setHost({ userId: '' } as unknown as Host)
})

describe('the tasks split', () => {
  it('has a key of its own', () => {
    expect(stateKey('layout', 'goalTasksSplit')).toBe('nanosec.portal.u.u1.agent.goalTasksSplit')
  })

  it('does not overwrite the dock layout when it is written', () => {
    const storage = globalThis.localStorage as MemoryStorage
    writeState('layout', undefined, { v: 1, slots: { left: { tabs: ['agents'], active: 'agents' } } })
    writeState('layout', 'goalTasksSplit', 312)
    const layout = readState<{ v?: number }>('layout', undefined, (raw) => (raw as { v?: number }) ?? null, {})
    expect(layout.v).toBe(1)
    expect(readState<number | null>('layout', 'goalTasksSplit', (raw) => (typeof raw === 'number' ? raw : null), null)).toBe(312)
    expect(storage.getItem('nanosec.portal.u.u1.agent.layout.v1')).toContain('slots')
  })
})
