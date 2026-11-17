// Agent groups are a user-private, single-level organization of the sidebar.
// They live on the bus; this module is the browser's only entry point so the
// path and payload shapes stay in one place.

import { deleteJson, fetchJson, postJson, putJson, USER_API_BASE } from './api'

export type AgentGroup = {
  id: string
  name: string
  /** Display order; the reorder endpoint rewrites it. */
  position: number
  /** Agent ids in display order inside the group. */
  agents: string[]
}

/** The sidebar's whole order: groups with their agents, plus the ungrouped tail. */
export type AgentGroupsSnapshot = {
  groups: AgentGroup[]
  ungrouped: string[]
}

export async function listAgentGroups(): Promise<AgentGroupsSnapshot> {
  const body = await fetchJson<{
    groups?: (Omit<AgentGroup, 'agents'> & { agents?: string[] })[]
    ungrouped?: string[]
  }>('/agent-groups', USER_API_BASE)
  const groups = (body.groups ?? []).map((group) => ({ ...group, agents: group.agents ?? [] }))
  return { groups, ungrouped: body.ungrouped ?? [] }
}

export async function createAgentGroup(name: string): Promise<AgentGroup> {
  const group = await postJson<Omit<AgentGroup, 'agents'>>('/agent-groups', { name }, USER_API_BASE)
  return { ...group, agents: [] }
}

export async function renameAgentGroup(id: string, name: string): Promise<void> {
  await putJson(`/agent-groups/${encodeURIComponent(id)}`, { name }, USER_API_BASE)
}

export async function deleteAgentGroup(id: string): Promise<{ unassigned: number }> {
  const body = await deleteJson<{ unassigned?: number }>(
    `/agent-groups/${encodeURIComponent(id)}`,
    USER_API_BASE,
  )
  return { unassigned: body.unassigned ?? 0 }
}

export async function reorderAgentGroups(ids: string[]): Promise<void> {
  await postJson('/agent-groups/reorder', { ids }, USER_API_BASE)
}

/**
 * Writes the sidebar's order in one request: each group's agents in display
 * order, plus the ungrouped tail. A drag across groups is one call, not a move
 * followed by a reorder.
 */
export async function arrangeAgents(
  groups: { id: string; agents: string[] }[],
  ungrouped: string[],
): Promise<void> {
  await postJson('/agent-groups/arrange', { groups, ungrouped }, USER_API_BASE)
}
