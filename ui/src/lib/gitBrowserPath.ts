// The rules behind the git browser's root directory: which directory it opens
// for an agent, and which favourites that agent starts with. They live apart
// from the components — and import nothing that needs a DOM — so they can be
// unit-tested.

import { fallbackTarget } from './browsingPath'

export type GitBrowsingDeps = {
  /** The directory remembered for this agent, or null when there is none. */
  remembered: string | null
  /** Whether the hypervisor can list a directory (data-root relative). */
  readable: (path: string) => Promise<boolean>
  /** The agent's home, data-root relative ("agents/<home>"), or null when the
   *  container could not be reached. */
  agentHome: () => Promise<string | null>
}

/**
 * The directory the git browser opens for an agent: where the user was, or the
 * agent's home. A remembered directory that is gone falls back to the home —
 * but only when the container answers, so a restart or a failing tunnel keeps
 * the user's place instead of silently moving it somewhere else.
 */
export async function resolveGitBrowsingPath(deps: GitBrowsingDeps): Promise<string> {
  if (deps.remembered !== null && (await deps.readable(deps.remembered))) {
    return deps.remembered
  }
  const home = await deps.agentHome().catch(() => null)
  return fallbackTarget(deps.remembered, home !== null) === 'default' ? (home ?? '') : (deps.remembered ?? '')
}

/**
 * Whether the agent's home still needs to be starred by default. It is added
 * once: `alreadyHandled` (the local marker) is what makes a deliberate unstar
 * stick, and a home that is already a favourite never needs adding again.
 */
export function shouldAutoStarAgentHome(args: {
  home: string
  shortcuts: { path: string }[]
  alreadyHandled: boolean
}): boolean {
  if (args.home === '' || args.alreadyHandled) {
    return false
  }
  return !args.shortcuts.some((shortcut) => shortcut.path === args.home)
}

/** The paths of one agent's favourites, which is what the tree shows starred. */
export function starredPaths(agentId: string, shortcuts: { agent_id: string; path: string }[]): Set<string> {
  return new Set(
    shortcuts.filter((shortcut) => shortcut.agent_id === agentId).map((shortcut) => shortcut.path),
  )
}

/** The label a favourite for home is stored under: the folder name, the same
 *  label the manual starring of a directory writes. */
export function agentHomeLabel(home: string): string {
  return home.split('/').filter(Boolean).pop() ?? home
}
