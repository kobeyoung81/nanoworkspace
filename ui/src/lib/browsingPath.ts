// Browsing paths, remembered per agent.
//
// The same key the shell writes (`nanosec.portal.u.<userId>.fileBrowser.pathByAgent`):
// the two may both be on screen while a release rolls out, and a panel that
// reopens on the user's last directory is the whole point. "" is a real entry.

import { getHost } from '../host'

export type PathArea = 'gitBrowser' | 'fileBrowser'

const PATH_SUFFIX = 'pathByAgent'

function storageKey(area: PathArea): string | null {
  const userId = getHost().userId
  return userId ? `nanosec.portal.u.${userId}.${area}.${PATH_SUFFIX}` : null
}

function readPathMap(area: PathArea): Record<string, string> {
  const key = storageKey(area)
  if (!key) {
    return {}
  }
  try {
    const raw = localStorage.getItem(key)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

/**
 * The directory this agent was last browsing, or null when it has none. An
 * explicit "" is a real entry — the data root in the git browser — which is why
 * "nothing remembered" and "remembered the root" are different answers.
 */
export function readAgentPath(area: PathArea, agentId: string | null): string | null {
  if (!agentId) {
    return null
  }
  return readPathMap(area)[agentId] ?? null
}

export function writeAgentPath(area: PathArea, agentId: string | null, path: string): void {
  const key = storageKey(area)
  if (!agentId || !key) {
    return
  }
  try {
    localStorage.setItem(key, JSON.stringify({ ...readPathMap(area), [agentId]: path }))
  } catch {
    // A full quota must not break browsing.
  }
}

/**
 * Which path survives when a remembered directory cannot be read. A missing
 * directory must not park the browser on a raw server error, but only a
 * reachable default root proves it is really gone: a restarting container or a
 * failing tunnel must keep the user's place rather than silently move it.
 */
export function fallbackTarget(remembered: string | null, defaultRootReadable: boolean): 'remembered' | 'default' {
  if (remembered === null) {
    return 'default'
  }
  return defaultRootReadable ? 'default' : 'remembered'
}
