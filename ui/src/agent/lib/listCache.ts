// A snapshot of the agent list and the per-agent conversation lists so a reload
// paints the sidebar before the network answers.
//
// The key is the signed-in account's own (see lib/clientState), so the snapshot
// of one account can never be read by another; the `userId` inside the payload
// is kept as a second check. localStorage rather than IndexedDB: the lists are a
// few dozen KB and the write is synchronous. The snapshot is never treated as
// fresh — it only seeds the first paint, and every bucket it restores is
// revalidated in the background.

import type { Agent } from './agentApi'
import type { AgentGroup } from './agentGroups'
import type { SessionLists } from '../conversations/sessionLists'
import { clearState, readState, writeState } from './clientState'

export type CachedLists = {
  schema: number
  userId: string
  savedAt: number
  agents: Agent[]
  groups: AgentGroup[]
  /** Agent ids in the ungrouped bucket, in display order. */
  ungrouped: string[]
  lists: SessionLists
}

// Bumping the schema drops every stored snapshot (list shape change).
//
// 2: the bucket gained `segments` (the ungrouped rows behind the chain
// fallback). A snapshot written before that restores an entry without the field,
// and reading a missing field is what made the session list fail permanently:
// the fetch threw before it could write the bucket back. Rejecting the old
// snapshots is what makes this self-healing — a client that had one just
// refetches instead of showing an error it cannot recover from.
//
// 3: the snapshot carries the agent groups as well, so the first paint can draw
// the real sections instead of showing every agent as ungrouped and then moving
// them. A schema-2 snapshot has no groups field; rejecting it is safer than
// defaulting, for the same reason as the 1→2 bump.
//
// 4: the ungrouped bucket gained an explicit order (and the groups carry theirs),
// so the first paint also keeps the user's arrangement.
export const LISTS_CACHE_SCHEMA = 4
const LISTS_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const LISTS_CACHE_MAX_BYTES = 256 * 1024

/**
 * Validates a stored snapshot and returns it typed, or null when it is unusable
 * (another user, older schema, expired, malformed).
 */
export function mayUseSnapshot(raw: unknown, input: { userId: string; now: number }): CachedLists | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const snapshot = raw as Partial<CachedLists>
  if (snapshot.schema !== LISTS_CACHE_SCHEMA || snapshot.userId !== input.userId) {
    return null
  }
  if (typeof snapshot.savedAt !== 'number' || input.now - snapshot.savedAt > LISTS_CACHE_TTL_MS) {
    return null
  }
  if (
    !Array.isArray(snapshot.agents) ||
    !Array.isArray(snapshot.groups) ||
    !Array.isArray(snapshot.ungrouped) ||
    !snapshot.lists ||
    typeof snapshot.lists !== 'object'
  ) {
    return null
  }
  return {
    schema: LISTS_CACHE_SCHEMA,
    userId: snapshot.userId,
    savedAt: snapshot.savedAt,
    agents: snapshot.agents,
    groups: snapshot.groups,
    ungrouped: snapshot.ungrouped,
    lists: snapshot.lists as SessionLists,
  }
}

export function readListCache(userId: string, now: number = Date.now()): CachedLists | null {
  return readState('lists', undefined, (raw) => mayUseSnapshot(raw, { userId, now }), null)
}

export function writeListCache(
  userId: string,
  agents: Agent[],
  groups: AgentGroup[],
  ungrouped: string[],
  lists: SessionLists,
  now: number = Date.now(),
): void {
  const payload = { schema: LISTS_CACHE_SCHEMA, userId, savedAt: now, agents, groups, ungrouped, lists }
  try {
    if (JSON.stringify(payload).length > LISTS_CACHE_MAX_BYTES) {
      return
    }
  } catch {
    return
  }
  writeState('lists', undefined, payload)
}

export function purgeListCache(): void {
  clearState('lists')
}
