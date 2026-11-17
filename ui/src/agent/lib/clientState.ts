// Browser-side state for the portal. This module owns the key names, the
// per-user namespace, the quota behaviour and the merge-before-write rule, so no
// other module has to spell out a `nanosec.portal.*` key.
//
// User state lives under `nanosec.portal.u.<userId>.<tail>`, which is what keeps
// two accounts on one browser apart: signing out keeps the state (it is already
// unreachable for anyone else), and signing back in restores it. Device-level
// state — the session token, theme, language and the debug switch — stays global
// on purpose: it belongs to the browser rather than to an account.
//
// Keys written before the namespace existed are adopted by the first account
// that starts up after the upgrade (adoptLegacyState), so nobody loses their
// layout, tab group or browsing path to this change.

import { createChannelLogger } from './debug'
import { getHost } from '../../host'

const log = createChannelLogger('clientState')

/** The slices of user state the app persists. */
export type StateArea =
  | 'layout'
  | 'tabs'
  | 'lists'
  | 'session'
  | 'contextUsage'
  | 'gitBrowser'
  | 'fileBrowser'
  | 'mobile'
  | 'directory'
  | 'agentsPane'
  | 'agentGroups'
  | 'agentRead'
  | 'mic'
  | 'voiceShortcut'

const NAMESPACE = 'nanosec.portal.u.'
/** Prefix of the pre-namespace keys, written by earlier versions. */
const LEGACY = 'nanosec.portal.'
/** Legacy keys with a fixed name (the per-agent ones are found by scanning). */
const LEGACY_FIXED: [string, StateArea, string | undefined][] = [
  [`${LEGACY}agent.layout.v1`, 'layout', undefined],
  [`${LEGACY}agent.leftVert`, 'layout', 'leftVert'],
  [`${LEGACY}agent.conversations.v1`, 'tabs', undefined],
  [`${LEGACY}agent.lists.v1`, 'lists', undefined],
]
/** The pre-namespace right-dock seed: the layout carries it now. */
const LEGACY_FILES_VISIBLE = `${LEGACY}agent.filesVisible`

let warnedAboutQuota = false

/**
 * Whose state this is: the shell owns the session, so the account comes from the
 * host it installs rather than from a sign-in hook this module cannot run.
 */
function currentUserId(): string | null {
  try {
    return getHost().userId || null
  } catch {
    return null
  }
}

/** Kept for the moved call sites; the host answers this now. */
export function setCurrentUser(_userId: string | null): void {}

export function currentUser(): string | null {
  return currentUserId()
}

/** The tail of a key, i.e. everything after the user namespace. */
function tailFor(area: StateArea, suffix?: string): string {
  switch (area) {
    case 'layout':
      return suffix === 'leftVert' ? 'agent.leftVert' : 'agent.layout.v1'
    case 'tabs':
      return 'agent.tabs.v1'
    case 'lists':
      return 'agent.lists.v1'
    case 'session':
      return `agent.session.${suffix}`
    case 'contextUsage':
      return `agent.contextUsage.${suffix}`
    case 'gitBrowser':
      return `gitBrowser.${suffix}`
    case 'fileBrowser':
      return `fileBrowser.${suffix}`
    case 'mobile':
      return `mobile.${suffix}`
    case 'mic':
      return 'mic'
    case 'voiceShortcut':
      return 'agent.voiceShortcut'
    case 'directory':
      return `directory.${suffix}`
    case 'agentsPane':
      return `agentsPane.${suffix}`
    case 'agentGroups':
      return `agentGroups.${suffix}`
    case 'agentRead':
      return `agentRead.${suffix}`
  }
}

/**
 * The key this slice is stored under, or null when nobody is signed in — a
 * signed-out tab must never read or write user state, and never fall back to a
 * global key (that is how one account's tabs used to reach another).
 */
export function stateKey(area: StateArea, suffix?: string): string | null {
  const userId = currentUserId()
  return userId ? `${NAMESPACE}${userId}.${tailFor(area, suffix)}` : null
}

function warnOnce(message: string): void {
  if (warnedAboutQuota) {
    return
  }
  warnedAboutQuota = true
  log.warn(message)
}

/** Reads a plain string slice (the git panel heights, a session id, a level). */
export function readRawState(area: StateArea, suffix?: string): string | null {
  const key = stateKey(area, suffix)
  if (!key) {
    return null
  }
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeRawState(area: StateArea, suffix: string | undefined, value: string): void {
  const key = stateKey(area, suffix)
  if (!key) {
    return
  }
  try {
    localStorage.setItem(key, value)
  } catch {
    // A full or unavailable storage must not break the interaction it came
    // from; the state simply does not survive the reload.
    warnOnce('localStorage refused a write (quota or private mode)')
  }
}

/** Deletes one slice of the current user's state. */
export function clearState(area: StateArea, suffix?: string): void {
  const key = stateKey(area, suffix)
  if (!key) {
    return
  }
  try {
    localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

/** Reads a JSON slice, falling back when it is absent or unusable. */
export function readState<T>(
  area: StateArea,
  suffix: string | undefined,
  parse: (raw: unknown) => T | null,
  fallback: T,
): T {
  const key = stateKey(area, suffix)
  if (!key) {
    return fallback
  }
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) {
      return fallback
    }
    return parse(JSON.parse(raw)) ?? fallback
  } catch {
    return fallback
  }
}

export function writeState(area: StateArea, suffix: string | undefined, value: unknown): void {
  const key = stateKey(area, suffix)
  if (!key) {
    return
  }
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    warnOnce('localStorage refused a write (quota or private mode)')
  }
}

/**
 * Writes a JSON slice after merging it with whatever is stored right now.
 *
 * Two portal tabs in one browser share this state, and writing a whole snapshot
 * means the slower tab silently reverts what the other one changed. The merge
 * gets the freshly stored value, this tab's next value and the value it last
 * read, which is what lets a merge function apply only *this* tab's changes.
 * Returns the value that was stored.
 */
export function writeStateMerged<T>(
  area: StateArea,
  suffix: string | undefined,
  next: T,
  previous: T | null,
  merge: (fresh: T | null, next: T, previous: T | null) => T,
  parse: (raw: unknown) => T | null,
): T {
  const key = stateKey(area, suffix)
  if (!key) {
    return next
  }
  let fresh: T | null = null
  try {
    const raw = localStorage.getItem(key)
    if (raw !== null) {
      fresh = parse(JSON.parse(raw))
    }
  } catch {
    fresh = null
  }
  const merged = merge(fresh, next, previous)
  try {
    localStorage.setItem(key, JSON.stringify(merged))
  } catch {
    warnOnce('localStorage refused a write (quota or private mode)')
  }
  return merged
}

/** Every key this module owns for one account. */
export function userStateKeys(userId: string): string[] {
  if (typeof localStorage === 'undefined') {
    return []
  }
  const prefix = `${NAMESPACE}${userId}.`
  const keys: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (key && key.startsWith(prefix)) {
        keys.push(key)
      }
    }
  } catch {
    return []
  }
  return keys
}

/** Drops one account's state (defaults to the signed-in one). */
export function clearUserState(userId: string | null = currentUserId()): void {
  if (!userId) {
    return
  }
  for (const key of userStateKeys(userId)) {
    try {
      localStorage.removeItem(key)
    } catch {
      // ignore
    }
  }
}

/**
 * Moves the pre-namespace keys into one account's namespace, once.
 *
 * The first account to start up after the upgrade adopts whatever the browser
 * already held (nobody loses their layout to a storage refactor), then the
 * legacy keys are deleted so a second account cannot adopt them too. Returns the
 * legacy keys that were moved, for logging and tests.
 */
export function adoptLegacyState(userId: string): string[] {
  if (typeof localStorage === 'undefined') {
    return []
  }
  const targets: [string, StateArea, string | undefined][] = [...LEGACY_FIXED]
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(LEGACY) || key.startsWith(NAMESPACE)) {
        continue
      }
      const tail = key.slice(LEGACY.length)
      if (tail.startsWith('agent.session.')) {
        targets.push([key, 'session', tail.slice('agent.session.'.length)])
      } else if (tail.startsWith('contextUsage.')) {
        targets.push([key, 'contextUsage', tail.slice('contextUsage.'.length)])
      } else if (tail.startsWith('gitBrowser.')) {
        targets.push([key, 'gitBrowser', tail.slice('gitBrowser.'.length)])
      }
    }
  } catch {
    return []
  }

  const moved: string[] = []
  for (const [legacyKey, area, suffix] of targets) {
    try {
      const value = localStorage.getItem(legacyKey)
      if (value === null) {
        continue
      }
      const nextKey = `${NAMESPACE}${userId}.${tailFor(area, suffix)}`
      if (localStorage.getItem(nextKey) === null) {
        localStorage.setItem(nextKey, value)
        moved.push(legacyKey)
      }
      localStorage.removeItem(legacyKey)
    } catch {
      // A failed move leaves the legacy key for the next attempt.
    }
  }
  try {
    localStorage.removeItem(LEGACY_FILES_VISIBLE)
  } catch {
    // ignore
  }
  if (moved.length > 0) {
    log.info(`adopted ${moved.length} pre-namespace key(s) for this account`)
  }
  return moved
}
