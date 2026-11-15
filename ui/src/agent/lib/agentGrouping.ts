// Turns the flat agent list the gateway returns into the sidebar's buckets.
//
// The rules are deliberately forgiving: a group the browser knows but the list
// does not mention still renders (so an empty group can be dragged into), and an
// agent pointing at a group that no longer exists falls back to ungrouped
// instead of disappearing.

import type { Agent } from './agentApi'
import type { AgentGroup } from './agentGroups'

/** The synthetic bucket with no stored group behind it. */
export const UNGROUPED_ID = ''

export type AgentBucket = {
  /** Group id, or UNGROUPED_ID for the trailing bucket. */
  id: string
  /** Group name; empty for the ungrouped bucket (the UI translates it). */
  name: string
  agents: Agent[]
}

export function bucketAgents(
  agents: Agent[],
  groups: AgentGroup[],
  ungroupedOrder: string[] = [],
): AgentBucket[] {
  const ordered = [...groups].sort(
    (a, b) => a.position - b.position || a.name.localeCompare(b.name),
  )
  const knownGroups = new Set(ordered.map((group) => group.id))
  const byID = new Map(agents.map((agent) => [agent.id, agent]))

  // An agent's group_id decides which bucket it belongs to; a stale id (the
  // group was deleted) falls back to ungrouped. Within a bucket the saved order
  // wins, and agents created after it was written are appended.
  const placed = new Set<string>()
  const take = (ids: string[], groupID: string): Agent[] => {
    const out: Agent[] = []
    for (const id of ids) {
      const agent = byID.get(id)
      if (!agent || placed.has(id) || (agent.group_id ?? '') !== groupID) {
        continue
      }
      out.push(agent)
      placed.add(id)
    }
    return out
  }

  const buckets: AgentBucket[] = ordered.map((group) => {
    const members = take(group.agents, group.id)
    for (const agent of agents) {
      if (!placed.has(agent.id) && agent.group_id === group.id) {
        members.push(agent)
        placed.add(agent.id)
      }
    }
    return { id: group.id, name: group.name, agents: members }
  })

  const ungrouped = take(ungroupedOrder, '')
  for (const agent of agents) {
    const groupID = agent.group_id && knownGroups.has(agent.group_id) ? agent.group_id : ''
    if (groupID === UNGROUPED_ID && !placed.has(agent.id)) {
      ungrouped.push(agent)
      placed.add(agent.id)
    }
  }
  // The ungrouped bucket only exists while it has members: an empty trailing
  // section would be a target with nothing to explain it.
  if (ungrouped.length > 0) {
    buckets.push({ id: UNGROUPED_ID, name: '', agents: ungrouped })
  }
  return buckets
}

/** True when the bucket can be renamed or deleted (the synthetic one cannot). */
export function isRealGroup(bucket: AgentBucket): boolean {
  return bucket.id !== UNGROUPED_ID
}
