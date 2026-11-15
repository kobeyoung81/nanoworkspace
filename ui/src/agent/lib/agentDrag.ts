// Pure helpers behind the sidebar's pointer drag. The pointer plumbing lives in
// usePointerDrag; what lands where is decided here so it can be tested without
// a DOM.

import type { AgentGroup } from './agentGroups'

export type GroupPlacement = 'before' | 'after'

/** Which side of a header the pointer is on. */
export function groupPlacement(pointerY: number, top: number, height: number): GroupPlacement {
  return pointerY < top + height / 2 ? 'before' : 'after'
}

/**
 * Moves `activeID` next to `overID` and renumbers positions.
 *
 * Returns null when nothing would change (same group, unknown id, or a drop
 * that leaves the order intact), so the caller does not issue a pointless
 * request.
 */
export function moveGroupOrder(
  groups: AgentGroup[],
  activeID: string,
  overID: string,
  placement: GroupPlacement,
): AgentGroup[] | null {
  if (activeID === overID) {
    return null
  }
  const active = groups.find((group) => group.id === activeID)
  if (!active) {
    return null
  }
  const rest = groups.filter((group) => group.id !== activeID)
  const target = rest.findIndex((group) => group.id === overID)
  if (target < 0) {
    return null
  }
  const insertAt = placement === 'before' ? target : target + 1
  const next = [...rest.slice(0, insertAt), active, ...rest.slice(insertAt)]
  if (next.every((group, index) => group.id === groups[index].id)) {
    return null
  }
  return next.map((group, position) => ({ ...group, position }))
}
