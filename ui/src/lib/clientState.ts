// The shell's per-account state slices, reached the same way.
//
// The git panel remembers its open dock, its heights and the directories it
// browsed. Those live under `nanosec.portal.u.<userId>.<area>.<suffix>` — the same
// keys the shell used, so a panel that was open before the move reopens on the
// same state.

import { getHost } from '../host'

export type StateArea = 'gitBrowser' | 'fileBrowser'

function key(area: StateArea, suffix?: string): string | null {
  const userId = getHost().userId
  return userId ? `nanosec.portal.u.${userId}.${area}.${suffix ?? ''}`.replace(/\.$/, '') : null
}

/** The signed-in account, or null when the page has none (never for a panel). */
export function currentUser(): string | null {
  return getHost().userId || null
}

export function readRawState(area: StateArea, suffix?: string): string | null {
  const k = key(area, suffix)
  if (!k) {
    return null
  }
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}

export function writeRawState(area: StateArea, suffix: string | undefined, value: string): void {
  const k = key(area, suffix)
  if (!k) {
    return
  }
  try {
    localStorage.setItem(k, value)
  } catch {
    // A full quota must not break the panel.
  }
}
